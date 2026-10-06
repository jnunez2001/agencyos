// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const events = require('../server/services/events');
const followups = require('../server/services/followups');
const requests = require('../server/services/requests');
const notifications = require('../server/services/notifications');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental', accountOwnerId: f.ids.rayne });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  return f;
}
const mine = (f, ctx, opts) => notifications.listNotifications(f.db, ctx, opts);

test('assigning a task notifies the assignee, never the person who did it', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Homepage', assigneeId: f.ids.sarah });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Mine', assigneeId: f.ids.mark });
  assert.deepEqual(mine(f, f.sarah).map((n) => [n.type, n.title, n.link, n.isRead]), [['task_assigned', 'Task assigned to you: Homepage', `#/projects/${f.project.id}`, false]]);
  assert.equal(mine(f, f.mark).length, 0);
  assert.deepEqual(notifications.unreadCount(f.db, f.sarah), { unread: 1 });
});

test('reassigning, comments, follow-ups, events and requests each notify the right person', async () => {
  const f = await setup();
  const t = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Homepage' });
  tasks.updateTask(f.db, f.mark, t.id, { assigneeId: f.ids.sarah });
  tasks.addComment(f.db, f.mark, t.id, { body: 'Please start' });
  followups.createFollowUp(f.db, f.mark, { title: 'Send quote', assigneeId: f.ids.sarah });
  events.createEvent(f.db, f.mark, { title: 'Kickoff', startsAt: '2026-10-12T14:00:00Z', attendees: [f.ids.sarah, f.ids.mark] });
  assert.deepEqual(mine(f, f.sarah).map((n) => n.type).sort(), ['event_invited', 'followup_assigned', 'task_assigned', 'task_comment']);
  requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'Add a blog' });
  assert.deepEqual(mine(f, f.rayne).map((n) => n.type), ['request_new']);
  const r = requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Another', ownerId: f.ids.sarah });
  assert.ok(mine(f, f.sarah).some((n) => n.type === 'request_assigned' && n.link === `#/requests/${r.id}`));
});

test('repeats fold into the unread notification; after reading, a new one is made', async () => {
  const f = await setup();
  const t = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Homepage', assigneeId: f.ids.sarah });
  for (const body of ['one', 'two', 'three']) tasks.addComment(f.db, f.mark, t.id, { body });
  assert.equal(mine(f, f.sarah).filter((n) => n.type === 'task_comment').length, 1);
  const n = mine(f, f.sarah).find((x) => x.type === 'task_comment');
  notifications.markRead(f.db, f.sarah, n.id);
  tasks.addComment(f.db, f.mark, t.id, { body: 'four' });
  assert.equal(mine(f, f.sarah).filter((x) => x.type === 'task_comment').length, 2);
  assert.equal(mine(f, f.sarah, { unread: true }).filter((x) => x.type === 'task_comment').length, 1);
});

test('only your own notifications are visible, readable and countable; read-all works', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'A', assigneeId: f.ids.sarah });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'B', assigneeId: f.ids.sarah });
  const first = mine(f, f.sarah)[0];
  assert.throws(() => notifications.markRead(f.db, f.mark, first.id), /not found/i);
  assert.throws(() => notifications.markRead(f.db, f.zed, first.id), /not found/i);
  assert.equal(mine(f, f.cole).length, 0);
  assert.deepEqual(notifications.markRead(f.db, f.sarah, first.id), { id: first.id, isRead: true });
  assert.deepEqual(notifications.unreadCount(f.db, f.sarah), { unread: 1 });
  assert.deepEqual(notifications.markAllRead(f.db, f.sarah), { marked: 1 });
  assert.deepEqual(notifications.unreadCount(f.db, f.sarah), { unread: 0 });
});

test('the daily digest goes once a day, only when something needs attention', async () => {
  const f = await setup();
  const now = new Date('2026-10-10T12:00:00Z');
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Late', assigneeId: f.ids.sarah, dueDate: '2026-10-01' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Today', assigneeId: f.ids.sarah, dueDate: '2026-10-10' });
  followups.createFollowUp(f.db, f.mark, { title: 'Late call', assigneeId: f.ids.sarah, dueDate: '2026-10-02' });
  const sent = notifications.runDigests(f.db, now);
  assert.equal(sent, 1, 'only Sarah has something that needs attention');
  const d = mine(f, f.sarah).find((n) => n.type === 'digest');
  assert.equal(d.title, 'Your day: 2 overdue, 1 due today');
  assert.match(d.body, /1 overdue task, 1 task due today, 1 overdue follow-up/);
  notifications.markRead(f.db, f.sarah, d.id);
  assert.equal(notifications.runDigests(f.db, now), 0, 'not again the same day, even after reading');
  assert.equal(notifications.runDigests(f.db, new Date('2026-10-11T12:00:00Z')), 1, 'but again the next day');
});

test('old read notifications are removed; unread ones stay', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'A', assigneeId: f.ids.sarah });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'B', assigneeId: f.ids.sarah });
  const [a] = mine(f, f.sarah);
  notifications.markRead(f.db, f.sarah, a.id);
  f.db.prepare("UPDATE notifications SET created_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal(notifications.prune(f.db), 1);
  assert.equal(mine(f, f.sarah).length, 1);
});
