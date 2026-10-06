// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const { updateMember } = require('../server/services/members');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'New website' });
  f.zedProject = projects.createProject(f.db, f.zed, { clientId: clients.createClient(f.db, f.zed, { name: 'Z' }).id, name: 'Zed project' });
  return f;
}
const make = (f, ctx = f.mark, over = {}) => tasks.createTask(f.db, ctx, { projectId: f.project.id, title: 'Write homepage copy', ...over });

test('a Manager can add a task; it starts as to do, normal priority, unassigned', async () => {
  const f = await setup();
  const t = make(f);
  assert.deepEqual([t.title, t.status, t.priority, t.assigneeId, t.projectName, t.clientName], ['Write homepage copy', 'todo', 'normal', null, 'New website', 'Acme Dental']);
});

test('only Owner, Admin and Manager add, edit, assign or delete tasks', async () => {
  const f = await setup();
  const t = make(f, f.mark, { assigneeId: f.ids.sarah });
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => make(f, ctx), /not allowed/i);
    assert.throws(() => tasks.updateTask(f.db, ctx, t.id, { title: 'x' }), /not allowed/i);
    assert.throws(() => tasks.deleteTask(f.db, ctx, t.id), /not allowed/i);
  }
  for (const ctx of [f.josh, f.rayne, f.mark]) assert.ok(make(f, ctx).id);
  assert.equal(tasks.updateTask(f.db, f.rayne, t.id, { assigneeId: f.ids.mark }).assigneeId, f.ids.mark);
});

test('validation: title, status, priority, dates, estimate', async () => {
  const f = await setup();
  assert.throws(() => make(f, f.mark, { title: ' ' }), /title/i);
  assert.throws(() => make(f, f.mark, { status: 'x' }), /status/i);
  assert.throws(() => make(f, f.mark, { priority: 'x' }), /priority/i);
  assert.throws(() => make(f, f.mark, { dueDate: '2026-13-01' }), /date/i);
  assert.throws(() => make(f, f.mark, { estimateHours: -1 }), /estimate/i);
  assert.throws(() => make(f, f.mark, { estimateHours: 'lots' }), /estimate/i);
  assert.equal(make(f, f.mark, { estimateHours: 2.5 }).estimateHours, 2.5);
});

test('a task needs a project of this agency, not archived', async () => {
  const f = await setup();
  assert.throws(() => make(f, f.mark, { projectId: f.zedProject.id }), /not found|project/i);
  assert.throws(() => make(f, f.mark, { projectId: 99999 }), /not found|project/i);
  projects.updateProject(f.db, f.mark, f.project.id, { status: 'archived' });
  assert.throws(() => make(f), /archived/i);
});

test('the assignee must be an active member of this agency', async () => {
  const f = await setup();
  assert.throws(() => make(f, f.mark, { assigneeId: f.ids.zed }), /team member/i);
  updateMember(f.db, f.josh, f.ids.sarah, { isActive: false });
  assert.throws(() => make(f, f.mark, { assigneeId: f.ids.sarah }), /team member/i);
});

test('a Contractor sees only tasks assigned to them; everything else is not found', async () => {
  const f = await setup();
  const mine = make(f, f.mark, { title: 'Mine', assigneeId: f.ids.cole });
  const other = make(f, f.mark, { title: 'Not mine', assigneeId: f.ids.sarah });
  make(f, f.mark, { title: 'Nobody' });
  assert.deepEqual(tasks.listTasks(f.db, f.cole).map((t) => t.title), ['Mine']);
  assert.equal(tasks.getTask(f.db, f.cole, mine.id).title, 'Mine');
  assert.throws(() => tasks.getTask(f.db, f.cole, other.id), /not found/i);
  assert.throws(() => tasks.listComments(f.db, f.cole, other.id), /not found/i);
  assert.throws(() => tasks.addComment(f.db, f.cole, other.id, { body: 'hi' }), /not found/i);
  assert.throws(() => tasks.updateTask(f.db, f.cole, other.id, { status: 'done' }), /not found/i);
  assert.equal(tasks.listTasks(f.db, f.cole, { assigneeId: f.ids.sarah }).length, 0);
  assert.equal(tasks.listTasks(f.db, f.sarah).length, 3);
});

test('an Employee or Contractor may change only the status of their own task', async () => {
  const f = await setup();
  const t = make(f, f.mark, { assigneeId: f.ids.sarah });
  assert.equal(tasks.updateTask(f.db, f.sarah, t.id, { status: 'in_progress' }).status, 'in_progress');
  assert.throws(() => tasks.updateTask(f.db, f.sarah, t.id, { title: 'x' }), /not allowed/i);
  assert.throws(() => tasks.updateTask(f.db, f.sarah, t.id, { status: 'done', assigneeId: f.ids.sarah }), /not allowed/i);
  const notHers = make(f, f.mark, { title: 'other', assigneeId: f.ids.mark });
  assert.throws(() => tasks.updateTask(f.db, f.sarah, notHers.id, { status: 'done' }), /not allowed/i);
  const c = make(f, f.mark, { title: 'contractor job', assigneeId: f.ids.cole });
  assert.equal(tasks.updateTask(f.db, f.cole, c.id, { status: 'review' }).status, 'review');
});

test('moving to done stamps the completion time and moving out clears it', async () => {
  const f = await setup();
  const t = make(f);
  assert.equal(t.completedAt, null);
  const done = tasks.updateTask(f.db, f.mark, t.id, { status: 'done' });
  assert.ok(done.completedAt);
  assert.equal(tasks.updateTask(f.db, f.mark, t.id, { status: 'review' }).completedAt, null);
});

test('another agency cannot see, change, delete or comment on a task', async () => {
  const f = await setup();
  const t = make(f);
  assert.deepEqual(tasks.listTasks(f.db, f.zed), []);
  assert.throws(() => tasks.getTask(f.db, f.zed, t.id), /not found/i);
  assert.throws(() => tasks.updateTask(f.db, f.zed, t.id, { title: 'hack' }), /not found/i);
  assert.throws(() => tasks.deleteTask(f.db, f.zed, t.id), /not found/i);
  assert.throws(() => tasks.addComment(f.db, f.zed, t.id, { body: 'x' }), /not found/i);
  assert.equal(tasks.getTask(f.db, f.mark, t.id).title, 'Write homepage copy');
});

test('filters: project, assignee, status, mine, overdue, search', async () => {
  const f = await setup();
  const today = '2026-10-10';
  const ctx = { ...f.mark, today };
  make(f, ctx, { title: 'Late logo', assigneeId: f.ids.mark, dueDate: '2026-10-01' });
  make(f, ctx, { title: 'On time', assigneeId: f.ids.sarah, dueDate: '2026-10-20' });
  const done = make(f, ctx, { title: 'Finished late', assigneeId: f.ids.mark, dueDate: '2026-09-01' });
  tasks.updateTask(f.db, ctx, done.id, { status: 'done' });
  const titles = (q, c = ctx) => tasks.listTasks(f.db, c, q).map((t) => t.title).sort();
  assert.deepEqual(titles({ overdue: '1' }), ['Late logo']); // done tasks are never overdue
  assert.deepEqual(titles({ mine: '1' }), ['Finished late', 'Late logo']);
  assert.deepEqual(titles({ assigneeId: f.ids.sarah }), ['On time']);
  assert.deepEqual(titles({ status: 'done' }), ['Finished late']);
  assert.deepEqual(titles({ q: 'logo' }), ['Late logo']);
  assert.deepEqual(titles({ projectId: f.project.id }).length, 3);
  assert.deepEqual(titles({ projectId: f.zedProject.id }), []);
  assert.throws(() => tasks.listTasks(f.db, ctx, { status: 'x' }), /status/i);
});

test('the list puts overdue and urgent work first and marks overdue tasks', async () => {
  const f = await setup();
  const ctx = { ...f.mark, today: '2026-10-10' };
  make(f, ctx, { title: 'later', dueDate: '2026-11-01' });
  make(f, ctx, { title: 'no date' });
  make(f, ctx, { title: 'overdue', dueDate: '2026-10-01' });
  make(f, ctx, { title: 'urgent soon', dueDate: '2026-10-12', priority: 'urgent' });
  const list = tasks.listTasks(f.db, ctx);
  assert.deepEqual(list.map((t) => t.title), ['overdue', 'urgent soon', 'later', 'no date']);
  assert.deepEqual(list.map((t) => t.isOverdue), [true, false, false, false]);
});

test('comments: add, list in order, and the activity log records them', async () => {
  const f = await setup();
  const t = make(f, f.mark, { assigneeId: f.ids.sarah });
  tasks.addComment(f.db, f.sarah, t.id, { body: 'Started on this' });
  tasks.addComment(f.db, f.mark, t.id, { body: 'Thanks' });
  const list = tasks.listComments(f.db, f.sarah, t.id);
  assert.deepEqual(list.map((c) => [c.authorName, c.body]), [['Sarah', 'Started on this'], ['Mark', 'Thanks']]);
  assert.throws(() => tasks.addComment(f.db, f.mark, t.id, { body: '  ' }), /comment/i);
  const row = listActivity(f.db, f.josh).find((r) => r.action === 'task.comment');
  assert.ok(row);
  assert.equal(row.objectId, t.id);
});

test('task changes write activity rows with only the changed fields; delete keeps what it was', async () => {
  const f = await setup();
  const t = make(f);
  tasks.updateTask(f.db, f.mark, t.id, { priority: 'high', title: 'Write homepage copy' });
  tasks.deleteTask(f.db, f.mark, t.id);
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'task');
  assert.deepEqual(rows.map((r) => r.action), ['task.delete', 'task.update', 'task.create']);
  assert.deepEqual([rows[1].before, rows[1].after], [{ priority: 'normal' }, { priority: 'high' }]);
  assert.equal(rows[0].before.title, 'Write homepage copy');
  assert.equal(tasks.listTasks(f.db, f.mark).length, 0);
});

test('project pages count their open tasks', async () => {
  const f = await setup();
  make(f);
  const b = make(f, f.mark, { title: 'b' });
  tasks.updateTask(f.db, f.mark, b.id, { status: 'done' });
  const p = projects.getProject(f.db, f.mark, f.project.id);
  assert.deepEqual([p.openTasks, p.doneTasks], [1, 1]);
});
