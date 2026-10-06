// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const events = require('../server/services/events');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  f.task = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Home page', assigneeId: f.ids.cole, dueDate: '2026-10-14' });
  f.zedClient = clients.createClient(f.db, f.zed, { name: 'Zed Client' });
  return f;
}
const base = { title: 'Kickoff call', type: 'client_meeting', startsAt: '2026-10-12T14:00:00Z', endsAt: '2026-10-12T15:00:00Z' };

test('a Manager creates an event linked to a task; the project and client follow the task', async () => {
  const f = await setup();
  const e = events.createEvent(f.db, f.mark, { ...base, taskId: f.task.id, attendees: [f.ids.sarah, f.ids.mark] });
  assert.deepEqual([e.type, e.status, e.clientName, e.projectName, e.taskTitle, e.allDay], ['client_meeting', 'scheduled', 'Acme Dental', 'Website', 'Home page', false]);
  assert.deepEqual(e.attendees.map((a) => a.displayName), ['Mark', 'Sarah']);
  assert.equal(e.meetingNoteId, null);
  assert.equal(e.canEdit, true);
});

test('links must agree and belong to this agency', async () => {
  const f = await setup();
  const other = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Other' });
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, taskId: f.task.id, projectId: other.id }), /not in that project/);
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, clientId: f.zedClient.id }), /not found/i);
  const c2 = clients.createClient(f.db, f.mark, { name: 'Second' });
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, projectId: f.project.id, clientId: c2.id }), /another client/);
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, attendees: [f.ids.zed] }), /team member/);
});

test('times are checked: UTC format, end after start, all-day uses dates, at most 31 days', async () => {
  const f = await setup();
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, startsAt: '2026-10-12 14:00' }), /UTC/);
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, endsAt: '2026-10-12T13:00:00Z' }), /before the start/);
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, endsAt: '2026-12-12T13:00:00Z' }), /at most 31 days/);
  assert.throws(() => events.createEvent(f.db, f.mark, { ...base, type: 'party' }), /valid type/);
  const d = events.createEvent(f.db, f.mark, { title: 'Offsite', type: 'team_meeting', allDay: true, startsAt: '2026-10-20', endsAt: '2026-10-21' });
  assert.deepEqual([d.allDay, d.startsAt, d.endsAt], [true, '2026-10-20', '2026-10-21']);
  assert.throws(() => events.createEvent(f.db, f.mark, { title: 'x', allDay: true, startsAt: '2026-02-30' }), /real date/);
  const noEnd = events.createEvent(f.db, f.mark, { title: 'Quick', startsAt: '2026-10-12T09:00:00Z' });
  assert.equal(noEnd.endsAt, '2026-10-12T09:00:00Z');
});

test('who may create, change and delete', async () => {
  const f = await setup();
  // Employees and Contractors may only block their own time.
  assert.throws(() => events.createEvent(f.db, f.sarah, base), /not allowed/i);
  const mine = events.createEvent(f.db, f.sarah, { title: 'Focus', type: 'blocked_time', startsAt: '2026-10-12T09:00:00Z', endsAt: '2026-10-12T11:00:00Z' });
  assert.deepEqual(mine.attendees.map((a) => a.id), [f.ids.sarah]);
  assert.equal(mine.canEdit, true);
  assert.throws(() => events.createEvent(f.db, f.sarah, { title: 'Focus', type: 'blocked_time', startsAt: '2026-10-12T09:00:00Z', attendees: [f.ids.mark] }), /own time/);
  assert.equal(events.updateEvent(f.db, f.sarah, mine.id, { title: 'Deep work' }).title, 'Deep work');
  assert.throws(() => events.updateEvent(f.db, f.sarah, mine.id, { type: 'client_meeting' }), /not allowed/i);
  const meeting = events.createEvent(f.db, f.mark, { ...base, attendees: [f.ids.sarah] });
  assert.throws(() => events.updateEvent(f.db, f.sarah, meeting.id, { title: 'x' }), /not allowed/i);
  assert.throws(() => events.deleteEvent(f.db, f.sarah, meeting.id), /not allowed/i);
  assert.equal(events.getEvent(f.db, f.sarah, meeting.id).canEdit, false);
  events.deleteEvent(f.db, f.sarah, mine.id);
  assert.throws(() => events.getEvent(f.db, f.sarah, mine.id), /not found/i);
  assert.deepEqual(events.deleteEvent(f.db, f.mark, meeting.id), { deleted: true });
  // Contractors can block their own time too
  assert.equal(events.createEvent(f.db, f.cole, { title: 'Away', type: 'blocked_time', startsAt: '2026-10-13T00:00:00Z' }).canEdit, true);
});

test('a Contractor sees only events they attend or created, without client names', async () => {
  const f = await setup();
  const withCole = events.createEvent(f.db, f.mark, { ...base, clientId: f.client.id, attendees: [f.ids.cole] });
  const without = events.createEvent(f.db, f.mark, { ...base, title: 'Internal' });
  const seen = events.calendar(f.db, f.cole, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(seen.events.map((e) => e.id), [withCole.id]);
  assert.equal(seen.events[0].clientName, null);
  assert.throws(() => events.getEvent(f.db, f.cole, without.id), /not found/i);
  assert.deepEqual(seen.deadlines.map((d) => [d.kind, d.title, d.clientName]), [['task', 'Home page', null]]);
  assert.equal(events.calendar(f.db, f.sarah, { from: '2026-10-01', to: '2026-10-31' }).events.length, 2);
});

test('the calendar filters by range, client and person, and lists deadlines read only', async () => {
  const f = await setup();
  events.createEvent(f.db, f.mark, { ...base, clientId: f.client.id, attendees: [f.ids.sarah] });
  events.createEvent(f.db, f.mark, { title: 'Team sync', type: 'team_meeting', startsAt: '2026-10-13T09:00:00Z' });
  events.createEvent(f.db, f.mark, { title: 'Next month', startsAt: '2026-11-03T09:00:00Z' });
  projects.updateProject(f.db, f.mark, f.project.id, { dueDate: '2026-10-30' });
  const all = events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(all.events.map((e) => e.title), ['Kickoff call', 'Team sync']);
  assert.deepEqual(all.deadlines.map((d) => [d.kind, d.title, d.date]), [['task', 'Home page', '2026-10-14'], ['project', 'Website', '2026-10-30']]);
  assert.deepEqual(events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31', userId: f.ids.sarah }).events.map((e) => e.title), ['Kickoff call']);
  assert.equal(events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31', userId: f.ids.sarah }).deadlines.length, 0);
  assert.deepEqual(events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31', clientId: f.client.id }).events.map((e) => e.title), ['Kickoff call']);
  assert.deepEqual(events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31', userId: f.ids.cole }).deadlines.map((d) => d.title), ['Home page']);
  // a multi-day event shows on every day it touches
  events.createEvent(f.db, f.mark, { title: 'Retreat', type: 'training', allDay: true, startsAt: '2026-09-29', endsAt: '2026-10-02' });
  assert.ok(events.calendar(f.db, f.mark, { from: '2026-10-02', to: '2026-10-02' }).events.some((e) => e.title === 'Retreat'));
  assert.throws(() => events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2027-10-31' }), /120 days/);
  assert.throws(() => events.calendar(f.db, f.mark, { from: '2026-10-05', to: '2026-10-01' }), /before/);
});

test('cancelled events are hidden unless asked for; updates change links and attendees', async () => {
  const f = await setup();
  const e = events.createEvent(f.db, f.mark, { ...base, taskId: f.task.id, attendees: [f.ids.sarah] });
  events.updateEvent(f.db, f.mark, e.id, { status: 'cancelled' });
  assert.equal(events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31' }).events.length, 0);
  assert.equal(events.calendar(f.db, f.mark, { from: '2026-10-01', to: '2026-10-31', includeCancelled: true }).events.length, 1);
  const moved = events.updateEvent(f.db, f.mark, e.id, { taskId: null, projectId: null, clientId: null, attendees: [f.ids.cole, f.ids.mark] });
  assert.deepEqual([moved.clientId, moved.projectId, moved.taskId], [null, null, null]);
  assert.deepEqual(moved.attendees.map((a) => a.displayName), ['Cole', 'Mark']);
  assert.throws(() => events.updateEvent(f.db, f.mark, e.id, { allDay: true }), /new start and end/);
});

test('agencies are isolated', async () => {
  const f = await setup();
  const e = events.createEvent(f.db, f.mark, base);
  assert.throws(() => events.getEvent(f.db, f.zed, e.id), /not found/i);
  assert.throws(() => events.updateEvent(f.db, f.zed, e.id, { title: 'x' }), /not found/i);
  assert.throws(() => events.deleteEvent(f.db, f.zed, e.id), /not found/i);
  assert.equal(events.calendar(f.db, f.zed, { from: '2026-10-01', to: '2026-10-31' }).events.length, 0);
});

test('changes are logged with only what changed', async () => {
  const f = await setup();
  const e = events.createEvent(f.db, f.mark, base);
  events.updateEvent(f.db, f.mark, e.id, { title: 'Kickoff', location: 'Zoom' });
  events.updateEvent(f.db, f.mark, e.id, { title: 'Kickoff' });
  events.deleteEvent(f.db, f.mark, e.id);
  const rows = listActivity(f.db, f.josh).filter((a) => a.objectType === 'event').reverse();
  assert.deepEqual(rows.map((a) => a.action), ['event.create', 'event.update', 'event.delete']);
  assert.deepEqual(rows[1].after, { title: 'Kickoff', location: 'Zoom' });
});
