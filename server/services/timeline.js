// Joshua Nunez
// Traceability. clientTimeline answers "what happened for this client lately" and traceTask answers "where did this
// task come from". Neither reads a table that a service already guards without going through that service, so every
// visibility rule holds as it does on the record's own page: a Contractor gets no client timeline at all, staff see
// what they can already open, and approved time is shown as hours only to people who review the team's time.
const { ServiceError } = require('./errors');
const perms = require('./permissions');
const clients = require('./clients');
const projects = require('./projects');
const tasks = require('./tasks');
const events = require('./events');
const meetingnotes = require('./meetingnotes');
const decisions = require('./decisions');
const requests = require('./requests');
const followups = require('./followups');
const timeentries = require('./timeentries');
const results = require('./results');
const reports = require('./reports');
const { today } = require('./dates');

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;
const DAY_MS = 86400000;

const REQUEST_STATUS = { new: 'New', reviewing: 'Reviewing', approved: 'Approved', in_progress: 'In progress', waiting: 'Waiting', completed: 'Completed', rejected: 'Rejected' };
const GROUPS = [
  ['event', 'Meetings and events'], ['note', 'Meeting notes'], ['decision', 'Decisions'], ['request', 'Requests'], ['follow_up', 'Follow-ups'],
  ['task', 'Tasks'], ['time', 'Approved time'], ['result', 'Results'], ['report', 'Reports'],
];

const allowed = (ctx, action) => perms.can(ctx.actor.role, action);
const need = (ctx, action) => { if (!allowed(ctx, action)) throw new ServiceError(403, 'Not allowed'); };
const nowOf = (ctx) => (ctx.now ? new Date(ctx.now) : new Date());
const iso = (d) => d.toISOString().slice(0, 19) + 'Z';
// Dates (YYYY-MM-DD) become midnight UTC so every item sorts on one scale.
const at = (value) => (value && value.length === 10 ? `${value}T00:00:00Z` : value);
const cleanDays = (value) => {
  if (value === undefined || value === null || value === '') return DEFAULT_DAYS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) throw new ServiceError(400, `Days must be a whole number from 1 to ${MAX_DAYS}`);
  return n;
};

// What happened for one client in the last `days` days, newest first, in groups.
function clientTimeline(db, ctx, clientId, { days } = {}) {
  need(ctx, 'clients.view');
  const client = clients.find(db, ctx.organizationId, clientId);
  const span = cleanDays(days);
  const now = nowOf(ctx);
  const to = iso(now);
  const from = iso(new Date(now.getTime() - span * DAY_MS));
  // Dates are calendar days in the agency's timezone, which can be a day ahead of UTC.
  const fromDay = from.slice(0, 10); const agencyDay = today(db, ctx); const toDay = agencyDay > to.slice(0, 10) ? agencyDay : to.slice(0, 10);
  // A plain date counts when its day is inside the window, a moment when it is.
  const inside = (value) => !!value && (value.length === 10 ? value >= fromDay && value <= toDay : value >= from && value <= to);
  const items = [];
  const push = (type, id, title, when, hash, extra = {}) => { items.push({ type, id, title, at: at(when), hash, ...extra }); };

  // Events that took place (the calendar already hides what this person may not see).
  for (const e of events.calendar(db, ctx, { from: fromDay, to: toDay, clientId: client.id }).events) {
    if (inside(e.startsAt)) push('event', e.id, e.title, e.startsAt, `#/calendar/${e.id}`);
  }
  if (allowed(ctx, 'notes.view')) {
    for (const n of meetingnotes.listNotes(db, ctx, { clientId: client.id, from: fromDay, to: toDay, limit: 200 })) push('note', n.id, n.title, n.meetingDate, `#/meetings/${n.id}`, { status: n.status });
  }
  if (allowed(ctx, 'decisions.view')) {
    for (const d of decisions.listDecisions(db, ctx, { clientId: client.id, limit: 200 })) if (inside(d.decidedOn)) push('decision', d.id, d.title, d.decidedOn, '#/meetings/decisions', { status: d.status });
  }
  if (allowed(ctx, 'requests.view')) {
    const list = requests.listRequests(db, ctx, { clientId: client.id, limit: 200 });
    for (const r of list) if (inside(r.createdAt)) push('request', r.id, r.title, r.createdAt, `#/requests/${r.id}`, { status: r.status, event: 'created' });
    // Status changes come from the log of those requests, and say only what the request page already says.
    const byId = new Map(list.map((r) => [r.id, r]));
    if (byId.size) {
      const rows = db.prepare(`SELECT object_id AS id, action, after_json AS after, created_at AS at FROM activity_logs WHERE organization_id = ? AND object_type = 'client_request' AND action IN ('request.update', 'request.convert') AND created_at >= ? AND created_at <= ? AND object_id IN (${[...byId.keys()].map(() => '?').join(',')}) ORDER BY id DESC LIMIT 200`)
        .all(ctx.organizationId, from, to, ...byId.keys());
      for (const row of rows) {
        let after = null;
        try { after = JSON.parse(row.after); } catch { /* unreadable entry */ }
        if (!after || !after.status) continue;
        push('request', row.id, `${byId.get(row.id).title}: ${REQUEST_STATUS[after.status] || after.status}`, row.at, `#/requests/${row.id}`, { status: after.status, event: 'status' });
      }
    }
  }
  if (allowed(ctx, 'followups.view')) {
    for (const f of followups.listFollowUps(db, ctx, { clientId: client.id, limit: 200 })) {
      if (inside(f.createdAt)) push('follow_up', f.id, f.title, f.createdAt, '#/meetings/follow-ups', { status: f.status, event: 'created' });
      if (f.completedAt && inside(f.completedAt)) push('follow_up', f.id, `${f.title}: done`, f.completedAt, '#/meetings/follow-ups', { status: 'done', event: 'completed' });
    }
  }
  if (allowed(ctx, 'tasks.view') && allowed(ctx, 'projects.view')) {
    for (const p of projects.listProjects(db, ctx, { clientId: client.id })) {
      for (const t of tasks.listTasks(db, ctx, { projectId: p.id, limit: 200 })) {
        if (inside(t.createdAt)) push('task', t.id, t.title, t.createdAt, `#/tasks/${t.id}`, { status: t.status, event: 'created' });
        if (t.completedAt && inside(t.completedAt)) push('task', t.id, `${t.title}: done`, t.completedAt, `#/tasks/${t.id}`, { status: 'done', event: 'completed' });
      }
    }
  }
  // Approved time: hours per day, with no names and no descriptions. Only people who review the team's time see it.
  if (allowed(ctx, 'time.view_team')) {
    const since = iso(new Date(now.getTime() - (span + 31) * DAY_MS)).slice(0, 10);
    const perDay = new Map();
    for (const e of timeentries.listEntries(db, ctx, { clientId: client.id, from: since, limit: 200 })) {
      if (!['approved', 'locked'].includes(e.status) || !inside(e.reviewedAt)) continue;
      const day = e.reviewedAt.slice(0, 10);
      perDay.set(day, (perDay.get(day) || 0) + e.minutes);
    }
    for (const [day, minutes] of perDay) { const hours = Math.round((minutes / 60) * 100) / 100; push('time', null, `${hours} ${hours === 1 ? 'hour' : 'hours'} approved`, day, '#/time', { hours }); }
  }
  if (allowed(ctx, 'results.view')) {
    for (const r of results.listResults(db, ctx, client.id, { from: fromDay, to: toDay })) push('result', r.id, `${r.metric}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`, r.recordedOn, `#/clients/${client.id}`);
  }
  if (allowed(ctx, 'reports.view')) {
    for (const r of reports.listReports(db, ctx, { clientId: client.id })) {
      if (inside(r.createdAt)) push('report', r.id, r.title, r.createdAt, `#/reports/${r.id}`, { status: r.status, event: 'created' });
      if (r.approvedAt && inside(r.approvedAt)) push('report', r.id, `${r.title}: approved`, r.approvedAt, `#/reports/${r.id}`, { status: 'approved', event: 'approved' });
    }
  }
  // The hash and the id stay on every item so a screen or an AI can open the record.
  const byTime = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  items.sort(byTime);
  const groups = GROUPS.map(([type, label]) => ({ type, label, items: items.filter((i) => i.type === type) })).filter((g) => g.items.length);
  return { clientId: client.id, clientName: client.name, days: span, from, to, total: items.length, items, groups };
}

// Tries a read that may be refused or find nothing for this person. The chain simply leaves that link out.
function seen(read) {
  try { return read(); } catch (err) { if (err instanceof ServiceError && [403, 404].includes(err.status)) return null; throw err; }
}

// Where a task came from: the client request it was made from, that request's meeting note and event, the decisions
// and follow-ups from the same note, the SOP it follows and a summary of the time on it. Only links this person may see.
function traceTask(db, ctx, taskId) {
  need(ctx, 'tasks.view');
  const task = tasks.getTask(db, ctx, taskId);
  const org = ctx.organizationId;
  const reqRow = allowed(ctx, 'requests.view') ? db.prepare('SELECT id FROM client_requests WHERE organization_id = ? AND task_id = ? ORDER BY id LIMIT 1').get(org, task.id) : null;
  const request = reqRow ? seen(() => requests.getRequest(db, ctx, reqRow.id)) : null;
  const note = request && request.sourceNoteId && allowed(ctx, 'notes.view') ? seen(() => meetingnotes.getNote(db, ctx, request.sourceNoteId)) : null;
  const event = note && note.eventId ? seen(() => events.getEvent(db, ctx, note.eventId)) : null;
  const fromNote = (table) => (note ? db.prepare(`SELECT id FROM ${table} WHERE organization_id = ? AND source_note_id = ? ORDER BY id`).all(org, note.id).map((r) => r.id) : []);
  const decisionList = allowed(ctx, 'decisions.view') ? fromNote('decisions').map((id) => seen(() => decisions.getDecision(db, ctx, id))).filter(Boolean) : [];
  const followUpList = allowed(ctx, 'followups.view') ? fromNote('follow_ups').map((id) => seen(() => followups.getFollowUp(db, ctx, id))).filter(Boolean) : [];
  const entries = allowed(ctx, 'time.log') ? timeentries.listEntries(db, ctx, { taskId: task.id, limit: 200 }) : [];
  const minutes = (list) => list.reduce((sum, e) => sum + e.minutes, 0);
  const hours = (m) => Math.round((m / 60) * 100) / 100;
  return {
    taskId: task.id,
    request: request ? { id: request.id, title: request.title, status: request.status, hash: `#/requests/${request.id}` } : null,
    meetingNote: note ? { id: note.id, title: note.title, date: note.meetingDate, hash: `#/meetings/${note.id}` } : null,
    event: event ? { id: event.id, title: event.title, startsAt: event.startsAt, hash: `#/calendar/${event.id}` } : null,
    decisions: decisionList.map((d) => ({ id: d.id, title: d.title, decidedOn: d.decidedOn, status: d.status, hash: '#/meetings/decisions' })),
    followUps: followUpList.map((f) => ({ id: f.id, title: f.title, dueDate: f.dueDate, status: f.status, hash: '#/meetings/follow-ups' })),
    // The task page already shows this SOP to whoever may open the task. The link is given only to those who may open SOPs.
    sop: task.sop ? { id: task.sop.id, title: task.sop.title, version: task.sop.version, hash: allowed(ctx, 'sops.view') ? `#/sops/${task.sop.id}` : null } : null,
    timeEntries: { scope: allowed(ctx, 'time.view_team') ? 'team' : 'mine', count: entries.length, hours: hours(minutes(entries)), approvedHours: hours(minutes(entries.filter((e) => ['approved', 'locked'].includes(e.status)))) },
  };
}

module.exports = { DEFAULT_DAYS, MAX_DAYS, clientTimeline, traceTask };
