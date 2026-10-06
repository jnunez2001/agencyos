// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.zedClient = clients.createClient(f.db, f.zed, { name: 'Zed Client' });
  return f;
}
const make = (f, ctx = f.mark, over = {}) => projects.createProject(f.db, ctx, { clientId: f.client.id, name: 'New website', ...over });

test('a Manager can add a project; it starts in planning and names its client', async () => {
  const f = await setup();
  const p = make(f, f.mark, { managerId: f.ids.mark, startDate: '2026-10-01', dueDate: '2026-12-15' });
  assert.deepEqual([p.name, p.status, p.clientName, p.managerName, p.startDate, p.dueDate], ['New website', 'planning', 'Acme Dental', 'Mark', '2026-10-01', '2026-12-15']);
});

test('who may see and manage projects', async () => {
  const f = await setup();
  const p = make(f, f.josh);
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) assert.equal(projects.listProjects(f.db, ctx).length, 1);
  assert.throws(() => projects.listProjects(f.db, f.cole), /not allowed/i);
  assert.throws(() => projects.getProject(f.db, f.cole, p.id), /not allowed/i);
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => make(f, ctx), /not allowed/i);
    assert.throws(() => projects.updateProject(f.db, ctx, p.id, { name: 'x' }), /not allowed/i);
  }
});

test('a project needs a client of the same agency, a name, a real status and sensible dates', async () => {
  const f = await setup();
  assert.throws(() => make(f, f.mark, { name: '' }), /name/i);
  assert.throws(() => make(f, f.mark, { clientId: f.zedClient.id }), /not found|client/i);
  assert.throws(() => make(f, f.mark, { clientId: 99999 }), /not found|client/i);
  assert.throws(() => make(f, f.mark, { status: 'bogus' }), /status/i);
  assert.throws(() => make(f, f.mark, { dueDate: '2026-02-30' }), /date/i);
  assert.throws(() => make(f, f.mark, { dueDate: 'tomorrow' }), /date/i);
  assert.throws(() => make(f, f.mark, { startDate: '2026-12-01', dueDate: '2026-11-01' }), /before/i);
});

test('the manager must be an active member of this agency', async () => {
  const f = await setup();
  assert.throws(() => make(f, f.mark, { managerId: f.ids.zed }), /team member/i);
  assert.throws(() => make(f, f.mark, { managerId: 99999 }), /team member/i);
  const { updateMember } = require('../server/services/members');
  updateMember(f.db, f.josh, f.ids.sarah, { isActive: false });
  assert.throws(() => make(f, f.mark, { managerId: f.ids.sarah }), /team member/i);
});

test('no new project on an archived client', async () => {
  const f = await setup();
  clients.updateClient(f.db, f.mark, f.client.id, { status: 'archived' });
  assert.throws(() => make(f), /archived/i);
});

test('another agency cannot see or change a project', async () => {
  const f = await setup();
  const p = make(f);
  assert.deepEqual(projects.listProjects(f.db, f.zed), []);
  assert.throws(() => projects.getProject(f.db, f.zed, p.id), /not found/i);
  assert.throws(() => projects.updateProject(f.db, f.zed, p.id, { name: 'hack' }), /not found/i);
});

test('list filters by client and status, and shows task counts', async () => {
  const f = await setup();
  const other = clients.createClient(f.db, f.mark, { name: 'Beta' });
  make(f, f.mark, { name: 'One' });
  const two = make(f, f.mark, { name: 'Two', clientId: other.id });
  projects.updateProject(f.db, f.mark, two.id, { status: 'active' });
  assert.deepEqual(projects.listProjects(f.db, f.mark, { clientId: other.id }).map((p) => p.name), ['Two']);
  assert.deepEqual(projects.listProjects(f.db, f.mark, { status: 'active' }).map((p) => p.name), ['Two']);
  assert.equal(projects.listProjects(f.db, f.mark)[0].openTasks, 0);
  assert.throws(() => projects.listProjects(f.db, f.mark, { status: 'x' }), /status/i);
});

test('the client page lists its projects', async () => {
  const f = await setup();
  make(f);
  assert.deepEqual(clients.getClient(f.db, f.sarah, f.client.id).projects.map((p) => p.name), ['New website']);
});

test('project changes write activity rows with only the changed fields', async () => {
  const f = await setup();
  const p = make(f);
  projects.updateProject(f.db, f.mark, p.id, { status: 'active', name: 'New website' });
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'project');
  assert.deepEqual(rows.map((r) => r.action), ['project.update', 'project.create']);
  assert.deepEqual([rows[0].before, rows[0].after], [{ status: 'planning' }, { status: 'active' }]);
});
