// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const events = require('../server/services/events');
const time = require('../server/services/timeentries');
const profiles = require('../server/services/profiles');
const dashboard = require('../server/services/dashboard');
const capacity = require('../server/services/capacity');
const { fixture } = require('./fixture');

const TODAY = '2026-10-14'; // a Wednesday; the week is Oct 12 to 18

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: TODAY };
  const c = clients.createClient(f.db, f.mark, { name: 'Acme' });
  f.project = projects.createProject(f.db, f.mark, { clientId: c.id, name: 'Site', status: 'active' });
  profiles.updateProfile(f.db, f.josh, f.ids.sarah, { weeklyCapacityHours: 20 });
  return f;
}
const row = (res, id) => res.weeks[0].people.find((p) => p.userId === id);

test('capacity, planned (tasks plus events), logged and utilization for the week', async () => {
  const f = await setup();
  const mk = (title, over) => tasks.createTask(f.db, f.mark, { projectId: f.project.id, title, assigneeId: f.ids.sarah, ...over });
  mk('in week', { dueDate: '2026-10-15', estimateHours: 6 });
  mk('also in week', { dueDate: '2026-10-18', estimateHours: 2 });
  mk('next week', { dueDate: '2026-10-19', estimateHours: 9 });
  mk('no estimate', { dueDate: '2026-10-15' });
  const done = mk('done', { dueDate: '2026-10-15', estimateHours: 5 });
  tasks.updateTask(f.db, f.mark, done.id, { status: 'done' });
  events.createEvent(f.db, f.mark, { title: 'Call', type: 'client_meeting', startsAt: '2026-10-13T14:00:00Z', endsAt: '2026-10-13T15:30:00Z', attendees: [f.ids.sarah] });
  events.createEvent(f.db, f.mark, { title: 'Cancelled', type: 'team_meeting', startsAt: '2026-10-13T10:00:00Z', endsAt: '2026-10-13T12:00:00Z', attendees: [f.ids.sarah], status: 'cancelled' });
  events.createEvent(f.db, f.mark, { title: 'Marker', type: 'deadline', startsAt: '2026-10-13T10:00:00Z', endsAt: '2026-10-13T12:00:00Z', attendees: [f.ids.sarah] });
  time.createEntry(f.db, f.sarah, { minutes: 120, timeType: 'internal', date: '2026-10-13' });
  const rej = time.createEntry(f.db, f.sarah, { minutes: 600, timeType: 'internal', date: '2026-10-13' });
  time.submitEntries(f.db, f.sarah, { ids: [rej.id] });
  time.rejectEntry(f.db, f.mark, rej.id, { note: 'no' });
  const r = row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.sarah);
  assert.deepEqual([r.capacityHours, r.taskHours, r.eventHours, r.plannedHours, r.loggedHours], [20, 8, 1.5, 9.5, 2]);
  assert.equal(r.utilizationPercent, 48);
  assert.equal(r.status, 'under');
  assert.match(r.note, /48 percent/);
  assert.equal(row(capacity.workloadCapacity(f.db, f.mark, { weekStart: '2026-10-19' }), f.ids.sarah).taskHours, 9);
  const two = capacity.workloadCapacity(f.db, f.mark, { weeks: 2 });
  assert.deepEqual(two.weeks.map((w) => w.weekStart), ['2026-10-12', '2026-10-19']);
});

test('overload above 100 percent, ok in between, and all-day events count working days', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Big', assigneeId: f.ids.sarah, dueDate: '2026-10-16', estimateHours: 26 });
  let r = row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.sarah);
  assert.deepEqual([r.utilizationPercent, r.status, r.note], [130, 'over', 'Over capacity by 6 hours']);
  tasks.updateTask(f.db, f.mark, tasks.listTasks(f.db, f.mark, {})[0].id, { estimateHours: 12 });
  r = row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.sarah);
  assert.deepEqual([r.utilizationPercent, r.status, r.note], [60, 'ok', '']);
  // an all-day event over Thursday to Sunday adds a working day (8h) for Thursday and Friday only if they work them
  events.createEvent(f.db, f.mark, { title: 'Training', type: 'training', allDay: true, startsAt: '2026-10-15', endsAt: '2026-10-18', attendees: [f.ids.mark] });
  const m = row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.mark);
  assert.equal(m.eventHours, 16);
  // logged time above capacity also overloads
  time.createEntry(f.db, f.sarah, { minutes: 1400, timeType: 'internal', date: '2026-10-12' });
  assert.equal(row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.sarah).status, 'over');
});

test('zero capacity has no percentage; only Managers see the team; others see themselves', async () => {
  const f = await setup();
  profiles.updateProfile(f.db, f.josh, f.ids.cole, { weeklyCapacityHours: 0 });
  assert.deepEqual([row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.cole).utilizationPercent, row(capacity.workloadCapacity(f.db, f.mark, {}), f.ids.cole).status], [null, 'ok']);
  const own = capacity.workloadCapacity(f.db, f.sarah, {});
  assert.deepEqual(own.weeks[0].people.map((p) => p.userId), [f.ids.sarah]);
  assert.equal(capacity.workloadCapacity(f.db, f.sarah, { userId: f.ids.mark }).weeks[0].people.length, 1);
  assert.equal(capacity.workloadCapacity(f.db, f.mark, { userId: f.ids.sarah }).weeks[0].people.length, 1);
  assert.throws(() => capacity.workloadCapacity(f.db, f.mark, { userId: f.ids.zed }), /not found/i);
  assert.throws(() => capacity.workloadCapacity(f.db, f.mark, { weeks: 9 }), /1 to 8/);
  assert.throws(() => capacity.workloadCapacity(f.db, f.mark, { weekStart: 'soon' }), /real date/);
  assert.equal(capacity.workloadCapacity(f.db, f.zed, {}).weeks[0].people.length, 1);
});

test('the dashboard workload gains utilization for Managers without losing its old fields', async () => {
  const f = await setup();
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Big', assigneeId: f.ids.sarah, dueDate: '2026-10-16', estimateHours: 26 });
  const d = dashboard.getDashboard(f.db, f.mark);
  const s = d.workload.find((x) => x.displayName === 'Sarah');
  assert.deepEqual([s.openTasks, s.openHours, s.capacityHours, s.plannedHours, s.utilizationPercent, s.capacityStatus], [1, 26, 20, 26, 130, 'over']);
  assert.equal(d.capacity.weekStart, '2026-10-12');
  const e = dashboard.getDashboard(f.db, f.sarah);
  assert.deepEqual([e.workload, e.capacity], [null, null]);
});
