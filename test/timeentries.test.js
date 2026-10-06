// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const time = require('../server/services/timeentries');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

const TODAY = '2026-10-14';

async function setup() {
  const f = await fixture();
  const at = (ctx, now = `${TODAY}T09:00:00Z`) => ({ ...ctx, today: TODAY, now });
  f.at = at;
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = at(f[k]);
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  f.task = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Home page', assigneeId: f.ids.cole, estimateHours: 4 });
  f.other = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Sitemap', assigneeId: f.ids.sarah });
  return f;
}

test('an Employee logs manual time; a task sets its project and client; the day defaults to today', async () => {
  const f = await setup();
  const e = time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 90, description: 'Wireframes' });
  assert.deepEqual([e.status, e.date, e.minutes, e.hours, e.timeType, e.clientName, e.projectName, e.taskTitle], ['draft', TODAY, 90, 1.5, 'billable', 'Acme Dental', 'Website', 'Sitemap']);
  assert.deepEqual([e.canEdit, e.canDelete, e.canSubmit, e.canReview], [true, true, true, false]);
  const range = time.createEntry(f.db, f.sarah, { startedAt: '2026-10-13T08:00:00Z', endedAt: '2026-10-13T09:30:00Z', timeType: 'internal' });
  assert.deepEqual([range.date, range.minutes, range.startedAt], ['2026-10-13', 90, '2026-10-13T08:00:00Z']);
  const log = listActivity(f.db, f.josh, { action: 'time.create' });
  assert.equal(log.length, 2);
});

test('time is checked: minutes, ranges, types, billable needs a client, links agree, 24 hours a day', async () => {
  const f = await setup();
  assert.throws(() => time.createEntry(f.db, f.sarah, { taskId: f.other.id }), /minutes/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 0 }), /1 to 1440/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 1.5 }), /whole number/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, timeType: 'billable' }), /needs a client/);
  assert.equal(time.createEntry(f.db, f.sarah, { minutes: 30 }).timeType, 'internal');
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, timeType: 'fun' }), /valid time type/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { startedAt: '2026-10-13 08:00', endedAt: '2026-10-13T09:00:00Z' }), /UTC/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { startedAt: '2026-10-13T09:00:00Z', endedAt: '2026-10-13T08:00:00Z' }), /after the start/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, date: '2026-02-30' }), /real date/);
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, status: 'approved' }), /Submit, Approve/);
  const other = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Other' });
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, taskId: f.other.id, projectId: other.id }), /not in that project/);
  const c2 = clients.createClient(f.db, f.mark, { name: 'Second' });
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, projectId: f.project.id, clientId: c2.id }), /another client/);
  const foreign = clients.createClient(f.db, f.zed, { name: 'Zed Client' });
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 30, clientId: foreign.id }), /not found/i);
  time.createEntry(f.db, f.sarah, { minutes: 1400, timeType: 'internal', date: '2026-10-10' });
  assert.throws(() => time.createEntry(f.db, f.sarah, { minutes: 60, timeType: 'internal', date: '2026-10-10' }), /24 hours/);
});

test('people edit and delete only their own draft or rejected entries', async () => {
  const f = await setup();
  const e = time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 60 });
  assert.throws(() => time.updateEntry(f.db, f.mark, e.id, { minutes: 30 }), /only change your own/);
  assert.throws(() => time.deleteEntry(f.db, f.mark, e.id), /only change your own/);
  assert.throws(() => time.getEntry(f.db, f.cole, e.id), /not found/i);
  const up = time.updateEntry(f.db, f.sarah, e.id, { minutes: 45, description: 'Shorter' });
  assert.deepEqual([up.minutes, up.description], [45, 'Shorter']);
  const log = listActivity(f.db, f.josh, { action: 'time.update' });
  assert.deepEqual(log[0].after, { minutes: 45, description: 'Shorter' });
  assert.deepEqual(log[0].before, { minutes: 60, description: '' });
  time.updateEntry(f.db, f.sarah, e.id, { minutes: 45 }); // nothing changed, nothing logged
  assert.equal(listActivity(f.db, f.josh, { action: 'time.update' }).length, 1);
  time.submitEntries(f.db, f.sarah, { ids: [e.id] });
  assert.throws(() => time.updateEntry(f.db, f.sarah, e.id, { minutes: 30 }), /Submitted time cannot be changed/);
  assert.throws(() => time.deleteEntry(f.db, f.sarah, e.id), /Submitted time/);
  const gone = time.createEntry(f.db, f.sarah, { minutes: 10 });
  assert.deepEqual(time.deleteEntry(f.db, f.sarah, gone.id), { deleted: true });
  assert.throws(() => time.getEntry(f.db, f.sarah, gone.id), /not found/i);
});

test('submit, approve, reject, lock: the full flow with who may do each step', async () => {
  const f = await setup();
  const a = time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 120 });
  const b = time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 30, date: '2026-10-13' });
  assert.deepEqual(time.submitEntries(f.db, f.sarah, { from: '2026-10-12', to: '2026-10-18' }).ids, [b.id, a.id]);
  assert.throws(() => time.submitEntries(f.db, f.sarah, { from: '2026-10-12', to: '2026-10-18' }), /nothing to submit/);
  assert.throws(() => time.submitEntries(f.db, f.sarah, {}), /Choose entries or a week/);
  // an Employee cannot review; a Manager can; reject needs a note
  assert.throws(() => time.approveEntry(f.db, f.sarah, a.id), /not allowed/i);
  assert.throws(() => time.rejectEntry(f.db, f.mark, a.id, {}), /Say why/);
  const approved = time.approveEntry(f.db, f.mark, a.id);
  assert.deepEqual([approved.status, approved.reviewerName, approved.canLock, approved.canEdit], ['approved', 'Mark', true, false]);
  assert.throws(() => time.updateEntry(f.db, f.sarah, a.id, { minutes: 5 }), /Approved time cannot be changed/);
  assert.throws(() => time.deleteEntry(f.db, f.sarah, a.id), /Approved time/);
  assert.throws(() => time.approveEntry(f.db, f.mark, a.id), /Only submitted time/);
  const rejected = time.rejectEntry(f.db, f.mark, b.id, { note: 'Wrong task' });
  assert.deepEqual([rejected.status, rejected.reviewNote, rejected.canEdit], ['rejected', 'Wrong task', false]);
  assert.deepEqual([time.getEntry(f.db, f.sarah, b.id).canEdit, time.getEntry(f.db, f.sarah, b.id).canSubmit], [true, true]);
  // fix and resubmit
  time.updateEntry(f.db, f.sarah, b.id, { description: 'On the right task' });
  assert.equal(time.submitEntries(f.db, f.sarah, { ids: [b.id] }).submitted, 1);
  assert.equal(time.getEntry(f.db, f.sarah, b.id).reviewNote, '');
  // lock only after approval, only a manager, and locked stays locked
  assert.throws(() => time.lockEntry(f.db, f.mark, b.id), /Only approved time/);
  assert.throws(() => time.lockEntry(f.db, f.sarah, a.id), /not allowed/i);
  const locked = time.lockEntry(f.db, f.mark, a.id);
  assert.deepEqual([locked.status, locked.canLock, locked.canEdit], ['locked', false, false]);
  assert.throws(() => time.updateEntry(f.db, f.sarah, a.id, { minutes: 5 }), /Locked time cannot be changed/);
  const actions = listActivity(f.db, f.josh, {}).map((x) => x.action);
  for (const x of ['time.submit', 'time.approve', 'time.reject', 'time.lock']) assert.ok(actions.includes(x), x);
});

test('nobody approves their own time except an Owner', async () => {
  const f = await setup();
  const own = time.createEntry(f.db, f.mark, { taskId: f.other.id, minutes: 60 });
  time.submitEntries(f.db, f.mark, { ids: [own.id] });
  assert.equal(time.getEntry(f.db, f.mark, own.id).canReview, false);
  assert.throws(() => time.approveEntry(f.db, f.mark, own.id), /own time/);
  assert.equal(time.approveEntry(f.db, f.rayne, own.id).status, 'approved');
  const josh = time.createEntry(f.db, f.josh, { minutes: 20 });
  time.submitEntries(f.db, f.josh, { ids: [josh.id] });
  assert.equal(time.approveEntry(f.db, f.josh, josh.id).status, 'approved');
});

test('an AI can never approve, reject, lock, submit or run a timer, even as an Owner', async () => {
  const f = await setup();
  const e = time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 60 });
  time.submitEntries(f.db, f.sarah, { ids: [e.id] });
  const ai = { ...f.josh, source: 'ai' };
  assert.throws(() => time.approveEntry(f.db, ai, e.id), /AI cannot/);
  assert.throws(() => time.rejectEntry(f.db, ai, e.id, { note: 'no' }), /AI cannot/);
  time.approveEntry(f.db, f.mark, e.id);
  assert.throws(() => time.lockEntry(f.db, ai, e.id), /AI cannot/);
  assert.throws(() => time.submitEntries(f.db, { ...f.sarah, source: 'ai' }, { from: '2026-10-01', to: '2026-10-31' }), /AI cannot/);
  assert.throws(() => time.startTimer(f.db, { ...f.sarah, source: 'ai' }, {}), /AI cannot/);
  assert.equal(time.getEntry(f.db, { ...f.mark, source: 'ai' }, e.id).canReview, false);
  assert.equal(time.createEntry(f.db, { ...f.sarah, source: 'ai' }, { minutes: 15 }).status, 'draft');
});

test('the timer: start, pause, resume, stop, one at a time', async () => {
  const f = await setup();
  const t = time.startTimer(f.db, f.at(f.sarah, '2026-10-14T09:00:00Z'), { taskId: f.other.id, description: 'SEO audit' });
  assert.deepEqual([t.timerState, t.status, t.minutes, t.canEdit, t.canSubmit], ['running', 'draft', 0, false, false]);
  assert.equal(time.getTimer(f.db, f.at(f.sarah, '2026-10-14T09:10:00Z')).elapsedSeconds, 600);
  assert.throws(() => time.startTimer(f.db, f.sarah, {}), /already have a timer/);
  assert.throws(() => time.updateEntry(f.db, f.sarah, t.id, { minutes: 5 }), /Stop the timer/);
  assert.throws(() => time.submitEntries(f.db, f.sarah, { ids: [t.id] }), /cannot be submitted/);
  assert.throws(() => time.resumeTimer(f.db, f.sarah), /already running/);
  const p = time.pauseTimer(f.db, f.at(f.sarah, '2026-10-14T09:30:00Z'));
  assert.deepEqual([p.timerState, p.elapsedSeconds], ['paused', 1800]);
  assert.throws(() => time.pauseTimer(f.db, f.sarah), /already paused/);
  // paused time does not run on
  assert.equal(time.getTimer(f.db, f.at(f.sarah, '2026-10-14T12:00:00Z')).elapsedSeconds, 1800);
  time.resumeTimer(f.db, f.at(f.sarah, '2026-10-14T13:00:00Z'));
  const done = time.stopTimer(f.db, f.at(f.sarah, '2026-10-14T13:15:00Z'));
  assert.deepEqual([done.timerState, done.minutes, done.canSubmit, done.canEdit], ['none', 45, true, true]);
  assert.equal(time.getTimer(f.db, f.sarah), null);
  assert.throws(() => time.stopTimer(f.db, f.sarah), /no timer/);
  // a very short timer still logs a minute; a new one can start
  time.startTimer(f.db, f.at(f.sarah, '2026-10-14T14:00:00Z'), { minutes: 99, timeType: 'internal' });
  assert.equal(time.stopTimer(f.db, f.at(f.sarah, '2026-10-14T14:00:05Z')).minutes, 1);
  // nobody else sees or touches my timer
  const mine = time.startTimer(f.db, f.sarah, { timeType: 'admin' });
  assert.throws(() => time.getEntry(f.db, f.cole, mine.id), /not found/i);
  assert.equal(time.getTimer(f.db, f.mark), null);
  time.startTimer(f.db, f.mark, {});
});

test('a Contractor logs time only on tasks assigned to them and never sees client names', async () => {
  const f = await setup();
  assert.throws(() => time.createEntry(f.db, f.cole, { minutes: 30, timeType: 'internal' }), /one of your tasks/);
  assert.throws(() => time.createEntry(f.db, f.cole, { minutes: 30, taskId: f.other.id }), /Task not found/);
  assert.throws(() => time.createEntry(f.db, f.cole, { minutes: 30, clientId: f.client.id }), /one of your tasks/);
  const e = time.createEntry(f.db, f.cole, { minutes: 30, taskId: f.task.id });
  assert.deepEqual([e.clientName, e.projectName, e.taskTitle, e.clientId], [null, null, 'Home page', f.client.id]);
  assert.equal(time.startTimer(f.db, f.cole, { taskId: f.task.id }).timerState, 'running');
  assert.throws(() => time.approveEntry(f.db, f.cole, e.id), /not allowed/i);
  assert.equal(time.listEntries(f.db, f.cole, {}).length, 2);
});

test('lists: people see their own, Managers see everyone with filters, other agencies see nothing', async () => {
  const f = await setup();
  time.createEntry(f.db, f.sarah, { taskId: f.other.id, minutes: 60, date: '2026-10-12' });
  time.createEntry(f.db, f.sarah, { minutes: 30, date: '2026-10-20' });
  time.createEntry(f.db, f.mark, { minutes: 45, date: '2026-10-13' });
  assert.equal(time.listEntries(f.db, f.sarah, {}).length, 2);
  assert.equal(time.listEntries(f.db, f.sarah, { userId: f.ids.mark }).length, 0); // asking for someone else's finds nothing
  assert.equal(time.listEntries(f.db, f.mark, {}).length, 3);
  assert.equal(time.listEntries(f.db, f.mark, { userId: f.ids.sarah }).length, 2);
  assert.equal(time.listEntries(f.db, f.mark, { from: '2026-10-13', to: '2026-10-19' }).length, 1);
  assert.equal(time.listEntries(f.db, f.mark, { clientId: f.client.id }).length, 1);
  assert.equal(time.listEntries(f.db, f.mark, { status: 'submitted' }).length, 0);
  assert.throws(() => time.listEntries(f.db, f.mark, { status: 'bogus' }), /valid status/);
  assert.equal(time.listEntries(f.db, f.zed, {}).length, 0);
  assert.throws(() => time.getEntry(f.db, f.zed, 1), /not found/i);
});

test('a task shows the time logged against it, without rejected entries', async () => {
  const f = await setup();
  const a = time.createEntry(f.db, f.sarah, { taskId: f.task.id, minutes: 90 });
  const b = time.createEntry(f.db, f.cole, { taskId: f.task.id, minutes: 30 });
  assert.equal(tasks.getTask(f.db, f.mark, f.task.id).loggedHours, 2);
  assert.equal(tasks.getTask(f.db, f.mark, f.task.id).estimateHours, 4);
  time.submitEntries(f.db, f.cole, { ids: [b.id] });
  time.rejectEntry(f.db, f.mark, b.id, { note: 'No' });
  assert.equal(tasks.getTask(f.db, f.cole, f.task.id).loggedHours, 1.5);
  assert.equal(a.minutes, 90);
});
