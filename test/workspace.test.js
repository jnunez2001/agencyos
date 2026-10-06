// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const events = require('../server/services/events');
const followups = require('../server/services/followups');
const requests = require('../server/services/requests');
const { getWorkspace } = require('../server/services/workspace');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole']) f[k].today = '2026-10-10';
  f.zed.today = '2026-10-10';
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental', status: 'at_risk' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  return f;
}

test('My Day holds what is mine and due, and nothing of other people', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Late', assigneeId: f.ids.sarah, dueDate: '2026-10-05' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Today', assigneeId: f.ids.sarah, dueDate: '2026-10-10' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Later', assigneeId: f.ids.sarah, dueDate: '2026-10-20' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Not mine', assigneeId: f.ids.mark, dueDate: '2026-10-05' });
  followups.createFollowUp(f.db, f.mark, { title: 'Call', assigneeId: f.ids.sarah, dueDate: '2026-10-10' });
  requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Booking', ownerId: f.ids.sarah });
  events.createEvent(f.db, f.mark, { title: 'Standup', type: 'team_meeting', startsAt: '2026-10-10T09:00:00Z', attendees: [f.ids.sarah] });
  events.createEvent(f.db, f.mark, { title: 'Other', startsAt: '2026-10-10T10:00:00Z', attendees: [f.ids.mark] });
  const w = getWorkspace(f.db, f.sarah);
  assert.deepEqual(w.myDay.tasks.map((t) => [t.title, t.isOverdue]), [['Late', true], ['Today', false]]);
  assert.deepEqual(w.myDay.followUps.map((x) => x.title), ['Call']);
  assert.deepEqual(w.myDay.requests.map((x) => [x.title, x.clientName]), [['Booking', 'Acme Dental']]);
  assert.deepEqual(w.myDay.events.map((e) => e.title), ['Standup']);
  assert.equal(w.myDay.unreadNotifications, 6, '3 tasks, a follow-up, a request and an event were assigned to her');
  assert.equal(w.myDay.qaWaiting, null);
  assert.equal(w.manager, undefined);
  assert.equal(w.owner, undefined);
});

test('a Contractor gets My Day only, with no client names', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Late', assigneeId: f.ids.cole, dueDate: '2026-10-05' });
  const w = getWorkspace(f.db, f.cole);
  assert.deepEqual([w.myDay.tasks[0].title, w.myDay.tasks[0].projectName], ['Late', null]);
  assert.deepEqual(w.myDay.requests, []);
  assert.equal(w.manager, undefined);
});

test('the Manager view counts what needs a manager', async () => {
  const f = await setup();
  requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'New one' });
  followups.createFollowUp(f.db, f.mark, { title: 'Late', assigneeId: f.ids.sarah, dueDate: '2026-10-01' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Nobody has it' });
  events.createEvent(f.db, f.mark, { title: 'Past call', type: 'client_meeting', startsAt: '2026-10-08T09:00:00Z' });
  events.createEvent(f.db, f.mark, { title: 'Old call', type: 'client_meeting', startsAt: '2026-09-01T09:00:00Z' });
  const m = getWorkspace(f.db, f.mark).manager;
  assert.deepEqual([m.requestsToReview, m.overdueFollowUps, m.unassignedTasks], [1, 1, 1]);
  assert.deepEqual(m.meetingsWithoutNotes.map((e) => e.title), ['Past call'], 'only the last 14 days');
  assert.equal(getWorkspace(f.db, f.mark).owner, undefined);
});

test('the Owner overview shows clients at risk, overdue work and client meetings ahead; other agencies stay out', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Late', dueDate: '2026-10-01' });
  requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Open' });
  events.createEvent(f.db, f.mark, { title: 'Review call', type: 'client_meeting', startsAt: '2026-10-12T09:00:00Z', clientId: f.client.id });
  events.createEvent(f.db, f.mark, { title: 'Too far', type: 'client_meeting', startsAt: '2026-10-30T09:00:00Z' });
  const o = getWorkspace(f.db, f.josh).owner;
  assert.deepEqual(o.clientsAtRisk.map((c) => c.name), ['Acme Dental']);
  assert.deepEqual([o.overdueTasks, o.openRequests, o.aiPending], [1, 1, 0]);
  assert.deepEqual(o.upcomingClientMeetings.map((e) => [e.title, e.clientName]), [['Review call', 'Acme Dental']]);
  assert.ok(getWorkspace(f.db, f.rayne).owner, 'Admin sees it too');
  const z = getWorkspace(f.db, f.zed);
  assert.deepEqual([z.owner.clientsAtRisk.length, z.owner.overdueTasks, z.owner.openRequests], [0, 0, 0]);
});
