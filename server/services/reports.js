// Joshua Nunez
// Reports: a document for a client and a period, with the blueprint's seven sections. The facts (completed work,
// results, goals, what is overdue and coming) come from AgencyOS and are written into the draft as a snapshot. The
// narrative is for a person or an AI. Only a person approves. Every query is scoped by the organization.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, diff } = require('./validate');
const { addDays } = require('./dates');
const goals = require('./goals');
const results = require('./results');
const perms = require('./permissions');

const STATUSES = ['draft', 'approved'];
const SECTIONS = [
  ['executiveSummary', 'executive_summary', 'Executive summary'],
  ['workCompleted', 'work_completed', 'Work completed'],
  ['keyResults', 'key_results', 'Key results'],
  ['importantChanges', 'important_changes', 'Important changes'],
  ['problemsRisks', 'problems_risks', 'Problems and risks'],
  ['nextPriorities', 'next_priorities', 'Next priorities'],
  ['recommendations', 'recommendations', 'Recommendations'],
];
const FIELDS = ['title', 'periodStart', 'periodEnd', 'status', ...SECTIONS.map((s) => s[0])];
const UPCOMING_DAYS = 14;

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT r.*, c.name AS clientName, cu.display_name AS createdByName, au.display_name AS approvedByName
    FROM reports r
    JOIN clients c ON c.id = r.client_id AND c.organization_id = r.organization_id
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users au ON au.id = r.approved_by
   WHERE r.organization_id = ?`;

function shape(r, withSections) {
  const out = {
    id: r.id, clientId: r.client_id, clientName: r.clientName, title: r.title, periodStart: r.period_start, periodEnd: r.period_end, status: r.status,
    createdByName: r.createdByName, approvedByName: r.approvedByName, approvedAt: r.approved_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if (withSections) out.sections = Object.fromEntries(SECTIONS.map(([key, column]) => [key, r[column]]));
  return out;
}

function find(db, organizationId, id) {
  const row = db.prepare(`${SELECT} AND r.id = ?`).get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Report not found');
  return row;
}

function findClient(db, organizationId, clientId) {
  const row = db.prepare('SELECT id, name, status FROM clients WHERE organization_id = ? AND id = ?').get(organizationId, Number(clientId));
  if (!row) throw new ServiceError(404, 'Client not found');
  return row;
}

function listReports(db, ctx, { clientId, status } = {}) {
  need(ctx, 'reports.view');
  const where = [];
  const params = [ctx.organizationId];
  if (clientId) { where.push('r.client_id = ?'); params.push(Number(clientId)); }
  if (status) { where.push('r.status = ?'); params.push(cleanEnum(status, STATUSES, 'status')); }
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY r.period_end DESC, r.id DESC LIMIT 500`).all(...params).map((r) => shape(r, false));
}

function getReport(db, ctx, id) {
  need(ctx, 'reports.view');
  return shape(find(db, ctx.organizationId, id), true);
}

function cleanPeriod(start, end) {
  const s = cleanDate(start, 'Period start');
  const e = cleanDate(end, 'Period end');
  if (!s || !e) throw new ServiceError(400, 'The period needs a start date and an end date');
  if (e < s) throw new ServiceError(400, 'The period must end on or after its start');
  return [s, e];
}

// ---- the facts ----

// Everything a report (or an AI drafting one) needs, from what AgencyOS knows. `from` and `to` are dates.
function reportData(db, ctx, clientId, { from, to } = {}) {
  need(ctx, 'reports.view');
  const client = findClient(db, ctx.organizationId, clientId);
  const [start, end] = cleanPeriod(from, to);
  const org = ctx.organizationId;
  const services = db.prepare('SELECT s.name FROM client_services cs JOIN services s ON s.id = cs.service_id WHERE cs.client_id = ? ORDER BY s.name COLLATE NOCASE').all(client.id).map((r) => r.name);
  const taskRows = (where, params, order) => db.prepare(
    `SELECT t.id, t.title, t.status, t.due_date AS dueDate, substr(t.completed_at, 1, 10) AS completedOn, p.name AS projectName, au.display_name AS assigneeName
       FROM tasks t JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
       LEFT JOIN users au ON au.id = t.assignee_id
      WHERE t.organization_id = ? AND p.client_id = ? AND ${where} ORDER BY ${order}`
  ).all(org, client.id, ...params);

  const completedTasks = taskRows("t.status = 'done' AND substr(t.completed_at, 1, 10) BETWEEN ? AND ?", [start, end], 'p.name, t.completed_at, t.id');
  const overdue = taskRows("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date <= ?", [end], 't.due_date, t.id');
  const upcoming = taskRows("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date > ? AND t.due_date <= ?", [end, addDays(end, UPCOMING_DAYS)], 't.due_date, t.id');
  const inProgress = taskRows("t.status IN ('in_progress','review','changes') AND NOT (t.due_date IS NOT NULL AND t.due_date <= ?) AND NOT (t.due_date IS NOT NULL AND t.due_date > ? AND t.due_date <= ?)", [end, end, addDays(end, UPCOMING_DAYS)], 't.id');

  // Results: each metric recorded in the period, its last value, and where it stood just before the period began.
  const rows = db.prepare('SELECT metric, value, unit, recorded_on AS recordedOn, id FROM client_results WHERE organization_id = ? AND client_id = ? ORDER BY recorded_on, id').all(org, client.id);
  const byMetric = new Map();
  for (const r of rows) {
    const key = r.metric.toLowerCase();
    if (!byMetric.has(key)) byMetric.set(key, []);
    byMetric.get(key).push(r);
  }
  const resultsOut = [];
  for (const list of byMetric.values()) {
    const inPeriod = list.filter((r) => r.recordedOn >= start && r.recordedOn <= end);
    if (inPeriod.length === 0) continue;
    const latest = inPeriod[inPeriod.length - 1];
    const before = list.filter((r) => r.recordedOn < start);
    const baseline = before.length ? before[before.length - 1] : null;
    const change = baseline ? Math.round((latest.value - baseline.value) * 1e6) / 1e6 : null;
    const changePct = baseline && baseline.value !== 0 ? Math.round(((latest.value - baseline.value) / Math.abs(baseline.value)) * 1000) / 10 : null;
    resultsOut.push({ metric: latest.metric, unit: latest.unit, entries: inPeriod.length, latest: { value: latest.value, recordedOn: latest.recordedOn }, baseline: baseline ? { value: baseline.value, recordedOn: baseline.recordedOn } : null, change, changePct });
  }
  resultsOut.sort((a, b) => a.metric.localeCompare(b.metric));

  const goalList = goals.forClient(db, org, client.id);
  const goalsPastDue = goalList.filter((g) => g.status === 'active' && g.dueDate && g.dueDate <= end).map((g) => ({ id: g.id, title: g.title, dueDate: g.dueDate }));
  return {
    client: { id: client.id, name: client.name, status: client.status, services },
    period: { from: start, to: end },
    goals: goalList.map((g) => ({ id: g.id, title: g.title, status: g.status, target: g.target, dueDate: g.dueDate, serviceName: g.serviceName, progress: g.progress })),
    completedTasks, results: resultsOut, overdue, upcoming, inProgress, goalsPastDue,
  };
}

// ---- turning the facts into text ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (date, refYear) => { const [y, m, d] = date.split('-').map(Number); return `${MONTHS[m - 1]} ${d}${String(y) === String(refYear) ? '' : `, ${y}`}`; };
const longDay = (date) => dayText(date, 0);
const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

function buildSections(d) {
  const year = d.period.to.slice(0, 4);
  const who = (t, ...more) => [t.assigneeName, ...more].filter(Boolean).join(', ');

  let workCompleted;
  if (d.completedTasks.length === 0) workCompleted = 'No tasks were completed in this period.';
  else {
    const byProject = new Map();
    for (const t of d.completedTasks) { if (!byProject.has(t.projectName)) byProject.set(t.projectName, []); byProject.get(t.projectName).push(t); }
    workCompleted = [...byProject].map(([project, list]) => [project, ...list.map((t) => `- ${t.title} (${who(t, dayText(t.completedOn, year))})`)].join('\n')).join('\n\n');
  }

  const resultLines = d.results.map((r) => {
    const unit = r.unit ? ` ${r.unit}` : '';
    let change;
    if (!r.baseline) change = 'first reading';
    else if (r.change === 0) change = 'no change';
    else change = `${r.change > 0 ? 'up' : 'down'} ${num(Math.abs(r.change))} from ${num(r.baseline.value)}`;
    return `- ${r.metric}: ${num(r.latest.value)}${unit} (${change})`;
  });
  const goalLines = d.goals.filter((g) => g.status === 'active').map((g) => `- ${g.title}: ${g.progress.tasksTotal ? `${g.progress.tasksDone} of ${g.progress.tasksTotal} tasks done.` : 'no work linked yet.'}${g.target ? ` Target: ${g.target}` : ''}`);
  const keyResults = [resultLines.length ? resultLines.join('\n') : 'No results were recorded in this period.', goalLines.length ? `Goals\n${goalLines.join('\n')}` : null].filter(Boolean).join('\n\n');

  const problems = [];
  if (d.overdue.length) problems.push(['Overdue work', ...d.overdue.map((t) => `- ${t.title} (${who(t) ? `due ${dayText(t.dueDate, year)}, ${who(t)}` : `due ${dayText(t.dueDate, year)}`})`)].join('\n'));
  if (d.goalsPastDue.length) problems.push(['Goals past their date', ...d.goalsPastDue.map((g) => `- ${g.title} (target date ${dayText(g.dueDate, year)})`)].join('\n'));
  const problemsRisks = problems.length ? problems.join('\n\n') : 'Nothing is overdue.';

  const next = [];
  if (d.upcoming.length) next.push(['Due soon', ...d.upcoming.map((t) => `- ${t.title} (due ${dayText(t.dueDate, year)}${t.assigneeName ? `, ${t.assigneeName}` : ''})`)].join('\n'));
  if (d.inProgress.length) next.push(['In progress', ...d.inProgress.map((t) => `- ${t.title}${t.assigneeName ? ` (${t.assigneeName})` : ''}`)].join('\n'));
  const nextPriorities = next.length ? next.join('\n\n') : 'No upcoming work is planned yet.';

  return { executiveSummary: '', workCompleted, keyResults, importantChanges: '', problemsRisks, nextPriorities, recommendations: '' };
}

// ---- writing ----

function cleanSections(input, base = {}) {
  const out = {};
  for (const [key, , label] of SECTIONS) out[key] = input[key] === undefined ? (base[key] || '') : cleanOptional(input[key], label, 10000);
  return out;
}

function insert(db, ctx, client, { title, periodStart, periodEnd, sections }) {
  const id = Number(db.prepare(
    `INSERT INTO reports (organization_id, client_id, title, period_start, period_end, executive_summary, work_completed, key_results, important_changes, problems_risks, next_priorities, recommendations, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ctx.organizationId, client.id, title, periodStart, periodEnd, sections.executiveSummary, sections.workCompleted, sections.keyResults, sections.importantChanges, sections.problemsRisks, sections.nextPriorities, sections.recommendations, ctx.actor.id).lastInsertRowid);
  return id;
}

function createReport(db, ctx, input = {}) {
  need(ctx, 'reports.manage');
  return db.transaction(() => {
    const client = findClient(db, ctx.organizationId, input.clientId);
    const [periodStart, periodEnd] = cleanPeriod(input.periodStart, input.periodEnd);
    const title = cleanText(input.title, 'Title', 1, 160);
    const sections = cleanSections(input);
    const id = insert(db, ctx, client, { title, periodStart, periodEnd, sections });
    logActivity(db, { ...logCtx(ctx), action: 'report.create', objectType: 'report', objectId: id, after: { title, clientId: client.id, periodStart, periodEnd } });
    return shape(find(db, ctx.organizationId, id), true);
  })();
}

function generateReport(db, ctx, clientId, input = {}) {
  need(ctx, 'reports.manage');
  return db.transaction(() => {
    const client = findClient(db, ctx.organizationId, clientId);
    const [periodStart, periodEnd] = cleanPeriod(input.periodStart, input.periodEnd);
    const title = input.title === undefined ? `${client.name} report, ${longDay(periodStart)} to ${longDay(periodEnd)}` : cleanText(input.title, 'Title', 1, 160);
    const sections = buildSections(reportData(db, ctx, client.id, { from: periodStart, to: periodEnd }));
    const id = insert(db, ctx, client, { title, periodStart, periodEnd, sections });
    logActivity(db, { ...logCtx(ctx), action: 'report.generate', objectType: 'report', objectId: id, after: { title, clientId: client.id, periodStart, periodEnd } });
    return shape(find(db, ctx.organizationId, id), true);
  })();
}

function updateReport(db, ctx, id, patch = {}) {
  need(ctx, 'reports.manage');
  return db.transaction(() => {
    const row = find(db, ctx.organizationId, id);
    const current = { title: row.title, periodStart: row.period_start, periodEnd: row.period_end, status: row.status, ...Object.fromEntries(SECTIONS.map(([key, column]) => [key, row[column]])) };
    const next = { ...current };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 160);
    if (patch.periodStart !== undefined) next.periodStart = cleanDate(patch.periodStart, 'Period start') || current.periodStart;
    if (patch.periodEnd !== undefined) next.periodEnd = cleanDate(patch.periodEnd, 'Period end') || current.periodEnd;
    cleanPeriod(next.periodStart, next.periodEnd);
    Object.assign(next, cleanSections(patch, current));
    const d = diff(current, next, FIELDS.filter((f) => f !== 'status'));
    if (!d.changed) return shape(row, true);
    // Changing an approved report means it needs a person's approval again.
    const reopen = row.status === 'approved';
    if (reopen) { d.before.status = 'approved'; d.after.status = 'draft'; }
    db.prepare(`UPDATE reports SET title = ?, period_start = ?, period_end = ?, ${SECTIONS.map(([, c]) => `${c} = ?`).join(', ')}, status = ?, approved_by = ${reopen ? 'NULL' : 'approved_by'}, approved_at = ${reopen ? 'NULL' : 'approved_at'}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(next.title, next.periodStart, next.periodEnd, ...SECTIONS.map(([key]) => next[key]), reopen ? 'draft' : row.status, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'report.update', objectType: 'report', objectId: row.id, before: d.before, after: d.after });
    return shape(find(db, ctx.organizationId, id), true);
  })();
}

function approveReport(db, ctx, id) {
  need(ctx, 'reports.approve');
  if (ctx.source === 'ai') throw new ServiceError(403, 'Only a person can approve a report');
  return db.transaction(() => {
    const row = find(db, ctx.organizationId, id);
    if (row.status === 'approved') throw new ServiceError(409, 'This report is already approved');
    db.prepare("UPDATE reports SET status = 'approved', approved_by = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(ctx.actor.id, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'report.approve', objectType: 'report', objectId: row.id, before: { status: 'draft' }, after: { status: 'approved' } });
    return shape(find(db, ctx.organizationId, id), true);
  })();
}

function deleteReport(db, ctx, id) {
  need(ctx, 'reports.manage');
  db.transaction(() => {
    const row = find(db, ctx.organizationId, id);
    if (row.status !== 'draft') throw new ServiceError(400, 'Only a draft can be deleted');
    db.prepare('DELETE FROM reports WHERE organization_id = ? AND id = ?').run(ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'report.delete', objectType: 'report', objectId: row.id, before: { title: row.title, clientId: row.client_id } });
  })();
  return { ok: true };
}

module.exports = { STATUSES, SECTIONS, reportData, listReports, getReport, createReport, generateReport, updateReport, approveReport, deleteReport };
