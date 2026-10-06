// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const dashboard = require('../server/services/dashboard');
const { fixture } = require('./fixture');

const TODAY = '2026-10-10';

async function setup() {
  const f = await fixture();
  const at = (ctx) => ({ ...ctx, today: TODAY });
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = at(f[k]);
  const c = clients.createClient(f.db, f.mark, { name: 'Acme' });
  const p = projects.createProject(f.db, f.mark, { clientId: c.id, name: 'Site', status: 'active' });
  const mk = (title, over) => tasks.createTask(f.db, f.mark, { projectId: p.id, title, ...over });
  mk('overdue sarah', { assigneeId: f.ids.sarah, dueDate: '2026-10-05', estimateHours: 4 });
  mk('soon sarah', { assigneeId: f.ids.sarah, dueDate: '2026-10-12', estimateHours: 6 });
  mk('far sarah', { assigneeId: f.ids.sarah, dueDate: '2026-11-30' });
  const done = mk('done sarah', { assigneeId: f.ids.sarah, dueDate: '2026-10-01' });
  tasks.updateTask(f.db, f.mark, done.id, { status: 'done' });
  mk('cole job', { assigneeId: f.ids.cole, dueDate: '2026-10-11' });
  mk('nobody', {});
  // another agency's work must never count
  const zc = clients.createClient(f.db, f.zed, { name: 'Z' });
  const zp = projects.createProject(f.db, f.zed, { clientId: zc.id, name: 'Zp' });
  tasks.createTask(f.db, f.zed, { projectId: zp.id, title: 'zed overdue', assigneeId: f.ids.zed, dueDate: '2020-01-01' });
  return f;
}

test('my work: open, overdue and due in the next 7 days, most urgent first', async () => {
  const f = await setup();
  const d = dashboard.getDashboard(f.db, f.sarah);
  assert.deepEqual([d.work.open, d.work.overdue, d.work.dueSoon], [3, 1, 1]);
  assert.deepEqual(d.work.items.map((t) => t.title), ['overdue sarah', 'soon sarah', 'far sarah']);
});

test('a Contractor sees only their own work and no agency totals', async () => {
  const f = await setup();
  const d = dashboard.getDashboard(f.db, f.cole);
  assert.deepEqual([d.work.open, d.work.overdue, d.work.dueSoon], [1, 0, 1]);
  assert.equal(d.agency, null);
  assert.equal(d.workload, null);
});

test('agency totals for roles that see clients, never counting another agency', async () => {
  const f = await setup();
  for (const ctx of [f.josh, f.mark, f.sarah]) {
    const d = dashboard.getDashboard(f.db, ctx);
    assert.deepEqual(d.agency, { activeClients: 1, activeProjects: 1, openTasks: 5, overdueTasks: 1 });
  }
  assert.deepEqual(dashboard.getDashboard(f.db, f.zed).agency, { activeClients: 1, activeProjects: 0, openTasks: 1, overdueTasks: 1 });
});

test('workload per active person against weekly capacity, for Managers and above only', async () => {
  const f = await setup();
  assert.equal(dashboard.getDashboard(f.db, f.sarah).workload, null);
  const w = dashboard.getDashboard(f.db, f.mark).workload;
  const sarah = w.find((x) => x.displayName === 'Sarah');
  assert.deepEqual([sarah.openTasks, sarah.overdue, sarah.openHours, sarah.capacityHours], [3, 1, 10, 40]);
  assert.ok(!w.some((x) => x.displayName === 'Zed'));
  assert.equal(w.length, 5);
});
