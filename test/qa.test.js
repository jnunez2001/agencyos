// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const sops = require('../server/services/sops');
const qa = require('../server/services/qa');
const dashboard = require('../server/services/dashboard');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Site' });
  f.sop = sops.createSop(f.db, f.mark, { title: 'Page Optimization', service: 'SEO', status: 'approved', requiresQa: true, steps: ['Research', 'Write', 'Publish'], checklist: ['Title ok', 'Links ok'] });
  f.mk = (over = {}, ctx = f.mark) => tasks.createTask(f.db, ctx, { projectId: f.project.id, title: 'Optimize homepage', assigneeId: f.ids.sarah, sopId: f.sop.id, ...over });
  return f;
}
const set = (f, ctx, id, status) => tasks.updateTask(f.db, ctx, id, { status });

test('attaching an SOP pins its version and copies its QA flag; only testing and approved SOPs attach', async () => {
  const f = await setup();
  const t = f.mk();
  assert.deepEqual([t.sopId, t.sopTitle, t.sopVersion, t.qaRequired], [f.sop.id, 'Page Optimization', '1.0', true]);
  const full = tasks.getTask(f.db, f.sarah, t.id);
  assert.deepEqual([full.sop.version, full.sop.latestVersion, full.sop.isLatest, full.sop.content.steps, full.sop.content.checklist], ['1.0', '1.0', true, ['Research', 'Write', 'Publish'], ['Title ok', 'Links ok']]);
  const draft = sops.createSop(f.db, f.mark, { title: 'Draft one' });
  assert.throws(() => f.mk({ sopId: draft.id }), /testing or approved/i);
  sops.updateSop(f.db, f.mark, f.sop.id, { status: 'deprecated' });
  assert.throws(() => f.mk({ sopId: f.sop.id }), /testing or approved/i);
  sops.updateSop(f.db, f.mark, f.sop.id, { status: 'approved' });
  assert.throws(() => f.mk({ sopId: 99999 }), /not found/i);
  const zedSop = sops.createSop(f.db, f.zed, { title: 'Zed SOP', status: 'approved' });
  assert.throws(() => f.mk({ sopId: zedSop.id }), /not found/i);
  // a task can say no to the SOP's QA flag
  assert.equal(f.mk({ qaRequired: false }).qaRequired, false);
});

test('a task stays on its version when the SOP changes, and can move to the newest one', async () => {
  const f = await setup();
  const t = f.mk();
  sops.addVersion(f.db, f.mark, f.sop.id, { steps: ['Research', 'Write', 'Publish', 'Report'], changeNote: 'Added a report step' });
  const before = tasks.getTask(f.db, f.sarah, t.id);
  assert.deepEqual([before.sop.version, before.sop.latestVersion, before.sop.isLatest, before.sop.content.steps.length], ['1.0', '1.1', false, 3]);
  tasks.updateTask(f.db, f.mark, t.id, { sopLatest: true });
  const after = tasks.getTask(f.db, f.sarah, t.id);
  assert.deepEqual([after.sop.version, after.sop.isLatest, after.sop.content.steps.length], ['1.1', true, 4]);
  tasks.updateTask(f.db, f.mark, t.id, { sopId: null });
  const none = tasks.getTask(f.db, f.sarah, t.id);
  assert.deepEqual([none.sopId, none.sop], [null, null]);
});

test('a Contractor sees the SOP on their own task, but cannot list SOPs', async () => {
  const f = await setup();
  const t = f.mk({ assigneeId: f.ids.cole });
  assert.deepEqual(tasks.getTask(f.db, f.cole, t.id).sop.content.checklist, ['Title ok', 'Links ok']);
  assert.throws(() => sops.listSops(f.db, f.cole), /not allowed/i);
});

test('work that needs QA cannot be marked done by hand, and nobody can set changes requested by hand', async () => {
  const f = await setup();
  const t = f.mk();
  assert.equal(set(f, f.sarah, t.id, 'in_progress').status, 'in_progress');
  assert.throws(() => set(f, f.sarah, t.id, 'done'), /needs QA/i);
  assert.throws(() => set(f, f.mark, t.id, 'done'), /needs QA/i);
  assert.throws(() => set(f, f.sarah, t.id, 'changes'), /reviewer/i);
  assert.throws(() => set(f, f.josh, t.id, 'changes'), /reviewer/i);
  // work that does not need QA can still be finished directly
  const plain = f.mk({ sopId: null, qaRequired: false, title: 'Plain' });
  assert.equal(set(f, f.sarah, plain.id, 'done').status, 'done');
});

test('submitting for QA records the checklist and puts the task in the queue; leaving withdraws it', async () => {
  const f = await setup();
  const t = f.mk();
  const sub = set(f, f.sarah, t.id, 'review');
  assert.equal(sub.status, 'review');
  const q = qa.listQueue(f.db, f.mark);
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].taskId, q[0].title, q[0].projectName, q[0].assigneeName, q[0].submittedByName, q[0].sopTitle, q[0].checklistTotal], [t.id, 'Optimize homepage', 'Site', 'Sarah', 'Sarah', 'Page Optimization', 2]);
  const detail = tasks.getTask(f.db, f.sarah, t.id);
  assert.deepEqual(detail.qa.pending.checklist, [{ text: 'Title ok', checked: false }, { text: 'Links ok', checked: false }]);
  assert.equal(detail.qa.history.length, 1);
  set(f, f.sarah, t.id, 'in_progress');
  assert.equal(qa.listQueue(f.db, f.mark).length, 0);
  assert.deepEqual(tasks.getTask(f.db, f.sarah, t.id).qa.history.map((h) => h.status), ['withdrawn']);
  // submitting again while already in QA does not add a second record
  set(f, f.sarah, t.id, 'review');
  tasks.updateTask(f.db, f.mark, t.id, { priority: 'high' });
  assert.equal(qa.listQueue(f.db, f.mark).length, 1);
});

test('who may see the queue and review', async () => {
  const f = await setup();
  const t = f.mk();
  set(f, f.sarah, t.id, 'review');
  for (const ctx of [f.josh, f.rayne, f.mark]) assert.equal(qa.listQueue(f.db, ctx).length, 1);
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => qa.listQueue(f.db, ctx), /not allowed/i);
    assert.throws(() => qa.reviewTask(f.db, ctx, t.id, { result: 'approved', checklist: [true, true] }), /not allowed/i);
  }
  assert.deepEqual(qa.listQueue(f.db, f.zed), []);
  assert.throws(() => qa.reviewTask(f.db, f.zed, t.id, { result: 'approved', checklist: [true, true] }), /not found/i);
  assert.throws(() => qa.reviewTask(f.db, { ...f.josh, source: 'ai' }, t.id, { result: 'approved', checklist: [true, true] }), /person/i);
});

test('approving needs every checklist item ticked; it completes the task and keeps the record', async () => {
  const f = await setup();
  const t = f.mk();
  set(f, f.sarah, t.id, 'review');
  assert.throws(() => qa.reviewTask(f.db, f.mark, t.id, { result: 'approved', checklist: [true, false] }), /every checklist item/i);
  assert.throws(() => qa.reviewTask(f.db, f.mark, t.id, { result: 'approved', checklist: [true] }), /every checklist item/i);
  assert.throws(() => qa.reviewTask(f.db, f.mark, t.id, { result: 'maybe' }), /result/i);
  const done = qa.reviewTask(f.db, f.mark, t.id, { result: 'approved', checklist: [true, true], comments: 'Good work' });
  assert.equal(done.status, 'done');
  assert.ok(done.completedAt);
  const rec = done.qa.history[0];
  assert.deepEqual([rec.status, rec.reviewerName, rec.comments, rec.checklist.every((c) => c.checked), rec.submittedByName], ['approved', 'Mark', 'Good work', true, 'Sarah']);
  assert.ok(rec.reviewedAt);
  assert.equal(done.qa.pending, null);
  assert.equal(qa.listQueue(f.db, f.mark).length, 0);
  assert.throws(() => qa.reviewTask(f.db, f.mark, t.id, { result: 'approved', checklist: [true, true] }), /not waiting for QA/i);
});

test('requesting changes needs a comment, sends it back, and a new submission starts a new round', async () => {
  const f = await setup();
  const t = f.mk();
  set(f, f.sarah, t.id, 'review');
  assert.throws(() => qa.reviewTask(f.db, f.mark, t.id, { result: 'changes_requested', comments: '  ' }), /what needs to change/i);
  const back = qa.reviewTask(f.db, f.mark, t.id, { result: 'changes_requested', comments: 'Title is too long', checklist: [false, true] });
  assert.deepEqual([back.status, back.completedAt], ['changes', null]);
  assert.equal(back.qa.history[0].status, 'changes_requested');
  assert.deepEqual(back.qa.history[0].checklist.map((c) => c.checked), [false, true]);
  assert.equal(tasks.getTask(f.db, f.sarah, t.id).qa.history[0].comments, 'Title is too long');
  assert.equal(set(f, f.sarah, t.id, 'in_progress').status, 'in_progress');
  assert.equal(set(f, f.sarah, t.id, 'review').status, 'review');
  const done = qa.reviewTask(f.db, f.josh, t.id, { result: 'approved', checklist: [true, true] });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.qa.history.map((h) => h.status), ['approved', 'changes_requested']);
});

test('nobody reviews their own work, except the Owner', async () => {
  const f = await setup();
  const own = f.mk({ assigneeId: f.ids.mark, title: 'Mark task' });
  set(f, f.mark, own.id, 'review');
  assert.throws(() => qa.reviewTask(f.db, f.mark, own.id, { result: 'approved', checklist: [true, true] }), /own work/i);
  assert.equal(qa.reviewTask(f.db, f.rayne, own.id, { result: 'approved', checklist: [true, true] }).status, 'done');
  const adminOwn = f.mk({ assigneeId: f.ids.rayne, title: 'Rayne task' });
  set(f, f.rayne, adminOwn.id, 'review');
  assert.throws(() => qa.reviewTask(f.db, f.rayne, adminOwn.id, { result: 'approved', checklist: [true, true] }), /own work/i);
  const ownerOwn = f.mk({ assigneeId: f.ids.josh, title: 'Josh task' });
  set(f, f.josh, ownerOwn.id, 'review');
  assert.equal(qa.reviewTask(f.db, f.josh, ownerOwn.id, { result: 'approved', checklist: [true, true] }).status, 'done');
});

test('a task without an SOP can still go through QA, with comments only', async () => {
  const f = await setup();
  const t = f.mk({ sopId: null, qaRequired: true, title: 'No SOP' });
  set(f, f.sarah, t.id, 'review');
  assert.deepEqual(tasks.getTask(f.db, f.mark, t.id).qa.pending.checklist, []);
  assert.equal(qa.reviewTask(f.db, f.mark, t.id, { result: 'approved' }).status, 'done');
});

test('QA actions are written to the activity log', async () => {
  const f = await setup();
  const t = f.mk();
  set(f, f.sarah, t.id, 'review');
  qa.reviewTask(f.db, f.mark, t.id, { result: 'changes_requested', comments: 'Fix it' });
  set(f, f.sarah, t.id, 'review');
  qa.reviewTask(f.db, f.mark, t.id, { result: 'approved', checklist: [true, true] });
  const rows = listActivity(f.db, f.josh).map((r) => r.action).filter((a) => a.startsWith('qa.'));
  assert.deepEqual(rows, ['qa.approve', 'qa.submit', 'qa.request_changes', 'qa.submit']);
});

test('the dashboard counts work waiting in QA for reviewers only', async () => {
  const f = await setup();
  const t = f.mk();
  set(f, f.sarah, t.id, 'review');
  assert.equal(dashboard.getDashboard(f.db, f.mark).qaWaiting, 1);
  assert.equal(dashboard.getDashboard(f.db, f.josh).qaWaiting, 1);
  assert.equal(dashboard.getDashboard(f.db, f.sarah).qaWaiting, 0);
  assert.equal(dashboard.getDashboard(f.db, f.zed).qaWaiting, 0);
});

test('start from an SOP: one task, or one task per step, each carrying the SOP', async () => {
  const f = await setup();
  const one = tasks.createTasksFromSop(f.db, f.mark, f.sop.id, { projectId: f.project.id, assigneeId: f.ids.sarah, dueDate: '2026-11-01', priority: 'high' });
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].title, one[0].sopId, one[0].qaRequired, one[0].assigneeId, one[0].dueDate, one[0].priority], ['Page Optimization', f.sop.id, true, f.ids.sarah, '2026-11-01', 'high']);
  const steps = tasks.createTasksFromSop(f.db, f.mark, f.sop.id, { projectId: f.project.id, mode: 'steps' });
  assert.deepEqual(steps.map((t) => t.title), ['Research', 'Write', 'Publish']);
  assert.ok(steps.every((t) => t.sopId === f.sop.id && t.sopVersion === '1.0'));
  assert.equal(tasks.listTasks(f.db, f.mark).length, 4);
  assert.throws(() => tasks.createTasksFromSop(f.db, f.sarah, f.sop.id, { projectId: f.project.id }), /not allowed/i);
  assert.throws(() => tasks.createTasksFromSop(f.db, f.mark, f.sop.id, { projectId: 99999 }), /not found/i);
  assert.throws(() => tasks.createTasksFromSop(f.db, f.mark, f.sop.id, { projectId: f.project.id, mode: 'weird' }), /mode/i);
  const empty = sops.createSop(f.db, f.mark, { title: 'Empty', status: 'approved', steps: [] });
  assert.throws(() => tasks.createTasksFromSop(f.db, f.mark, empty.id, { projectId: f.project.id, mode: 'steps' }), /no steps/i);
  const draft = sops.createSop(f.db, f.mark, { title: 'Draft', steps: ['a'] });
  assert.throws(() => tasks.createTasksFromSop(f.db, f.mark, draft.id, { projectId: f.project.id }), /testing or approved/i);
  assert.throws(() => tasks.createTasksFromSop(f.db, f.zed, f.sop.id, { projectId: f.project.id }), /not found/i);
  // all or nothing: a bad assignee creates nothing
  assert.throws(() => tasks.createTasksFromSop(f.db, f.mark, f.sop.id, { projectId: f.project.id, mode: 'steps', assigneeId: f.ids.zed }), /team member/i);
  assert.equal(tasks.listTasks(f.db, f.mark).length, 4);
});
