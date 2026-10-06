// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const reports = require('../server/services/reports');
const results = require('../server/services/results');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const goals = require('../server/services/goals');
const tasks = require('../server/services/tasks');
const services = require('../server/services/services');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

const FROM = '2026-09-01';
const TO = '2026-09-30';

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: '2026-10-05' };
  const seo = services.createService(f.db, f.josh, { name: 'SEO' });
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental', serviceIds: [seo.id] });
  f.g1 = goals.createGoal(f.db, f.mark, f.client.id, { title: 'Increase qualified organic leads', target: '50 leads a month', dueDate: '2027-03-01' });
  f.g2 = goals.createGoal(f.db, f.mark, f.client.id, { title: 'Launch the new site', dueDate: '2026-09-15' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Local SEO', goalId: f.g1.id });
  const mk = (title, over) => tasks.createTask(f.db, f.mark, { projectId: f.project.id, title, ...over });
  const done = (t, when) => { tasks.updateTask(f.db, f.mark, t.id, { status: 'done' }); f.db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run(`${when}T10:00:00.000Z`, t.id); };
  done(mk('Claim profile', { assigneeId: f.ids.sarah }), '2026-09-10');
  done(mk('Citation clean-up', { assigneeId: f.ids.sarah }), '2026-09-25');
  done(mk('Old task'), '2026-08-20');
  mk('Keyword research', { assigneeId: f.ids.sarah, dueDate: '2026-09-20' });
  mk('Write service pages', { assigneeId: f.ids.mark, dueDate: '2026-10-08' });
  mk('Backlink outreach', { assigneeId: f.ids.sarah, status: 'in_progress' });
  mk('Far future', { dueDate: '2026-12-01' });
  const rec = (metric, value, recordedOn, unit = '') => results.recordResult(f.db, f.sarah, f.client.id, { metric, value, recordedOn, unit });
  rec('Organic leads', 40, '2026-08-31', 'leads');
  rec('Organic leads', 55, '2026-09-30', 'leads');
  rec('Calls', 9, '2026-08-01');
  rec('Top keywords', 12, '2026-09-15');
  return f;
}

test('the facts for a period come from goals, completed work, results and open work', async () => {
  const f = await setup();
  const d = reports.reportData(f.db, f.mark, f.client.id, { from: FROM, to: TO });
  assert.deepEqual([d.client.name, d.client.services, d.period], ['Acme Dental', ['SEO'], { from: FROM, to: TO }]);
  assert.deepEqual(d.completedTasks.map((t) => [t.title, t.completedOn, t.assigneeName, t.projectName]), [['Claim profile', '2026-09-10', 'Sarah', 'Local SEO'], ['Citation clean-up', '2026-09-25', 'Sarah', 'Local SEO']]);
  const leads = d.results.find((r) => r.metric === 'Organic leads');
  assert.deepEqual([leads.latest.value, leads.baseline.value, leads.change], [55, 40, 15]);
  assert.deepEqual(d.results.find((r) => r.metric === 'Top keywords').baseline, null);
  assert.ok(!d.results.some((r) => r.metric === 'Calls')); // nothing recorded in the period
  assert.deepEqual(d.overdue.map((t) => t.title), ['Keyword research']);
  assert.deepEqual(d.upcoming.map((t) => t.title), ['Write service pages']);
  assert.deepEqual(d.inProgress.map((t) => t.title), ['Backlink outreach']);
  assert.deepEqual(d.goalsPastDue.map((g) => g.title), ['Launch the new site']);
  assert.equal(d.goals.length, 2);
  assert.deepEqual(d.goals.find((g) => g.title.startsWith('Increase')).progress, { tasksTotal: 7, tasksDone: 3, projects: 1 });
});

test('generating a report fills the factual sections and leaves the narrative for a person or an AI', async () => {
  const f = await setup();
  const r = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: FROM, periodEnd: TO });
  assert.deepEqual([r.status, r.clientName, r.periodStart, r.periodEnd], ['draft', 'Acme Dental', FROM, TO]);
  assert.match(r.title, /Acme Dental/);
  const s = r.sections;
  assert.match(s.workCompleted, /Local SEO\n- Claim profile \(Sarah, Sep 10\)\n- Citation clean-up \(Sarah, Sep 25\)/);
  assert.doesNotMatch(s.workCompleted, /Old task/);
  assert.match(s.keyResults, /- Organic leads: 55 leads \(up 15 from 40\)/);
  assert.match(s.keyResults, /- Top keywords: 12 \(first reading\)/);
  assert.doesNotMatch(s.keyResults, /Calls/);
  assert.match(s.keyResults, /Goals\n/);
  assert.match(s.keyResults, /- Increase qualified organic leads: 3 of 7 tasks done\. Target: 50 leads a month/);
  assert.match(s.keyResults, /- Launch the new site: no work linked yet\./);
  assert.match(s.problemsRisks, /Overdue work\n- Keyword research \(due Sep 20, Sarah\)/);
  assert.match(s.problemsRisks, /Goals past their date\n- Launch the new site \(target date Sep 15\)/);
  assert.match(s.nextPriorities, /Due soon\n- Write service pages \(due Oct 8, Mark\)/);
  assert.match(s.nextPriorities, /In progress\n- Backlink outreach \(Sarah\)/);
  assert.doesNotMatch(s.nextPriorities, /Far future/);
  assert.deepEqual([s.executiveSummary, s.importantChanges, s.recommendations], ['', '', '']);
  assert.ok(listActivity(f.db, f.josh).some((a) => a.action === 'report.generate'));
});

test('a quiet period says so instead of printing empty lists', async () => {
  const f = await setup();
  const r = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: '2025-01-01', periodEnd: '2025-01-31', title: 'Quiet month' });
  assert.equal(r.title, 'Quiet month');
  assert.match(r.sections.workCompleted, /No tasks were completed in this period/);
  assert.match(r.sections.keyResults, /No results were recorded in this period/);
  assert.match(r.sections.problemsRisks, /Nothing is overdue/);
});

test('who may read, write, approve and delete reports', async () => {
  const f = await setup();
  const r = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: FROM, periodEnd: TO });
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) {
    assert.equal(reports.listReports(f.db, ctx).length, 1);
    assert.equal(reports.getReport(f.db, ctx, r.id).title, r.title);
  }
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => reports.createReport(f.db, ctx, { clientId: f.client.id, title: 'x', periodStart: FROM, periodEnd: TO }), /not allowed/i);
    assert.throws(() => reports.generateReport(f.db, ctx, f.client.id, { periodStart: FROM, periodEnd: TO }), /not allowed/i);
    assert.throws(() => reports.updateReport(f.db, ctx, r.id, { title: 'x' }), /not allowed/i);
    assert.throws(() => reports.approveReport(f.db, ctx, r.id), /not allowed/i);
    assert.throws(() => reports.deleteReport(f.db, ctx, r.id), /not allowed/i);
  }
  for (const ctx of [f.cole]) {
    assert.throws(() => reports.listReports(f.db, ctx), /not allowed/i);
    assert.throws(() => reports.getReport(f.db, ctx, r.id), /not allowed/i);
    assert.throws(() => reports.reportData(f.db, ctx, f.client.id, { from: FROM, to: TO }), /not allowed/i);
  }
});

test('a report needs a client, a title and a real period', async () => {
  const f = await setup();
  const make = (over) => reports.createReport(f.db, f.mark, { clientId: f.client.id, title: 'March report', periodStart: FROM, periodEnd: TO, ...over });
  const r = make({ executiveSummary: 'A strong month.' });
  assert.deepEqual([r.title, r.sections.executiveSummary, r.status], ['March report', 'A strong month.', 'draft']);
  assert.throws(() => make({ title: ' ' }), /title/i);
  assert.throws(() => make({ periodStart: '2026-10-01', periodEnd: '2026-09-01' }), /end on or after/i);
  assert.throws(() => make({ periodStart: 'x' }), /date/i);
  assert.throws(() => make({ periodEnd: undefined }), /date/i);
  assert.throws(() => make({ clientId: 99999 }), /not found/i);
  assert.throws(() => make({ recommendations: 'x'.repeat(10001) }), /recommendations/i);
  assert.throws(() => reports.generateReport(f.db, f.mark, f.client.id, { periodStart: TO, periodEnd: FROM }), /end on or after/i);
});

test('approving is a person\'s decision; editing an approved report returns it to draft; only drafts are deleted', async () => {
  const f = await setup();
  const r = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: FROM, periodEnd: TO });
  assert.throws(() => reports.approveReport(f.db, { ...f.josh, source: 'ai' }, r.id), /person/i);
  const ok = reports.approveReport(f.db, f.rayne, r.id);
  assert.deepEqual([ok.status, ok.approvedByName], ['approved', 'Rayne']);
  assert.ok(ok.approvedAt);
  assert.throws(() => reports.approveReport(f.db, f.rayne, r.id), /already/i);
  assert.throws(() => reports.deleteReport(f.db, f.josh, r.id), /draft/i);
  const edited = reports.updateReport(f.db, f.mark, r.id, { executiveSummary: 'Changed after approval' });
  assert.deepEqual([edited.status, edited.approvedByName, edited.approvedAt], ['draft', null, null]);
  const log = listActivity(f.db, f.josh).filter((a) => a.action === 'report.update')[0];
  assert.deepEqual([log.before.status, log.after.status], ['approved', 'draft']);
  reports.deleteReport(f.db, f.mark, r.id);
  assert.equal(reports.listReports(f.db, f.josh).length, 0);
  assert.throws(() => reports.getReport(f.db, f.josh, r.id), /not found/i);
});

test('updating changes only what was sent and logs only what changed', async () => {
  const f = await setup();
  const r = reports.createReport(f.db, f.mark, { clientId: f.client.id, title: 'T', periodStart: FROM, periodEnd: TO, recommendations: 'Keep going' });
  const u = reports.updateReport(f.db, f.mark, r.id, { executiveSummary: 'Good month', title: 'T' });
  assert.deepEqual([u.sections.executiveSummary, u.sections.recommendations, u.title], ['Good month', 'Keep going', 'T']);
  reports.updateReport(f.db, f.mark, r.id, { executiveSummary: 'Good month' }); // nothing changed
  const rows = listActivity(f.db, f.josh).filter((a) => a.objectType === 'report');
  assert.deepEqual(rows.map((a) => a.action), ['report.update', 'report.create']);
  assert.deepEqual(Object.keys(rows[0].after), ['executiveSummary']);
  assert.throws(() => reports.updateReport(f.db, f.mark, r.id, { periodEnd: '2026-08-01' }), /end on or after/i);
});

test('listing filters by client and status', async () => {
  const f = await setup();
  const other = clients.createClient(f.db, f.mark, { name: 'Beta' });
  const a = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: FROM, periodEnd: TO });
  reports.createReport(f.db, f.mark, { clientId: other.id, title: 'Beta report', periodStart: FROM, periodEnd: TO });
  reports.approveReport(f.db, f.mark, a.id);
  assert.deepEqual(reports.listReports(f.db, f.mark, { clientId: other.id }).map((r) => r.title), ['Beta report']);
  assert.deepEqual(reports.listReports(f.db, f.mark, { status: 'approved' }).map((r) => r.id), [a.id]);
  assert.equal(reports.listReports(f.db, f.mark).length, 2);
  assert.throws(() => reports.listReports(f.db, f.mark, { status: 'x' }), /status/i);
  assert.ok(!('sections' in reports.listReports(f.db, f.mark)[0])); // lists stay light
});

test('another agency cannot see, generate or change a report', async () => {
  const f = await setup();
  const r = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: FROM, periodEnd: TO });
  assert.deepEqual(reports.listReports(f.db, f.zed), []);
  assert.throws(() => reports.getReport(f.db, f.zed, r.id), /not found/i);
  assert.throws(() => reports.updateReport(f.db, f.zed, r.id, { title: 'hack' }), /not found/i);
  assert.throws(() => reports.approveReport(f.db, f.zed, r.id), /not found/i);
  assert.throws(() => reports.deleteReport(f.db, f.zed, r.id), /not found/i);
  assert.throws(() => reports.generateReport(f.db, f.zed, f.client.id, { periodStart: FROM, periodEnd: TO }), /not found/i);
  assert.throws(() => reports.reportData(f.db, f.zed, f.client.id, { from: FROM, to: TO }), /not found/i);
});
