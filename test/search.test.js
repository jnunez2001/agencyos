// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const sops = require('../server/services/sops');
const events = require('../server/services/events');
const notes = require('../server/services/meetingnotes');
const requests = require('../server/services/requests');
const decisions = require('../server/services/decisions');
const followups = require('../server/services/followups');
const { search } = require('../server/services/search');
const { fixture } = require('./fixture');

const CONTENT = { service: 'SEO', purpose: 'Make a page rank', steps: ['Check'], checklist: ['Done'] };

// One of everything with the word "zebra" in it, and a Contractor who may see only a few of them.
async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Zebra Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Zebra website' });
  f.mine = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Zebra copy for Cole', assigneeId: f.ids.cole });
  f.other = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Zebra logo for Sarah', assigneeId: f.ids.sarah });
  f.sop = sops.createSop(f.db, f.mark, { ...CONTENT, title: 'Zebra checklist', status: 'approved' });
  f.draftSop = sops.createSop(f.db, f.mark, { ...CONTENT, title: 'Zebra draft idea' });
  f.attended = events.createEvent(f.db, f.mark, { title: 'Zebra kickoff', type: 'client_meeting', startsAt: '2026-10-12T14:00:00Z', endsAt: '2026-10-12T15:00:00Z', attendees: [f.ids.cole] });
  f.hidden = events.createEvent(f.db, f.mark, { title: 'Zebra planning', type: 'internal_meeting', startsAt: '2026-10-13T14:00:00Z', endsAt: '2026-10-13T15:00:00Z' });
  f.note = notes.createNote(f.db, f.mark, { title: 'Zebra call notes', meetingDate: '2026-10-12', clientId: f.client.id });
  f.eventNote = notes.createNote(f.db, f.mark, { title: 'Zebra kickoff notes', meetingDate: '2026-10-12', eventId: f.attended.id });
  f.request = requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Zebra blog' });
  f.decision = decisions.createDecision(f.db, f.mark, { title: 'Zebra stays on WordPress', decidedOn: '2026-10-01' });
  f.fuCole = followups.createFollowUp(f.db, f.mark, { title: 'Zebra quote for Cole', assigneeId: f.ids.cole });
  f.fuMark = followups.createFollowUp(f.db, f.mark, { title: 'Zebra quote for Mark', assigneeId: f.ids.mark });
  return f;
}

const groupOf = (out, type) => (out.groups.find((g) => g.type === type) || { results: [] }).results;
const titles = (out, type) => groupOf(out, type).map((r) => r.title);

test('a manager finds every kind of record, shaped with a route to open it', async () => {
  const f = await setup();
  const out = search(f.db, f.mark, 'zebra');
  assert.deepEqual(out.groups.map((g) => g.type), ['client', 'project', 'task', 'sop', 'note', 'request', 'decision', 'follow_up', 'event']);
  assert.equal(groupOf(out, 'client')[0].hash, `#/clients/${f.client.id}`);
  assert.equal(groupOf(out, 'project')[0].hash, `#/projects/${f.project.id}`);
  assert.equal(groupOf(out, 'task').length, 2);
  assert.equal(groupOf(out, 'task')[0].hash.startsWith('#/tasks/'), true);
  assert.equal(groupOf(out, 'sop').length, 2);
  assert.equal(groupOf(out, 'note')[0].hash.startsWith('#/meetings/'), true);
  assert.equal(groupOf(out, 'request')[0].hash, `#/requests/${f.request.id}`);
  assert.equal(groupOf(out, 'decision')[0].hash, '#/meetings/decisions');
  assert.equal(groupOf(out, 'follow_up').length, 2);
  assert.equal(groupOf(out, 'follow_up')[0].hash, '#/meetings/follow-ups');
  assert.equal(groupOf(out, 'event').length, 2);
  assert.equal(groupOf(out, 'event')[0].hash.startsWith('#/calendar/'), true);
  for (const g of out.groups) for (const r of g.results) { assert.deepEqual(Object.keys(r).sort(), ['hash', 'id', 'subtitle', 'title', 'type']); assert.equal(r.type, g.type); }
  const people = search(f.db, f.mark, 'rayne');
  assert.equal(groupOf(people, 'member')[0].title, 'Rayne');
  assert.equal(groupOf(people, 'member')[0].hash, '#/team');
});

test('matching ignores case and looks at more than the title where the service does', async () => {
  const f = await setup();
  assert.equal(search(f.db, f.mark, 'ZEBRA DENTAL').groups[0].results[0].id, f.client.id);
  assert.ok(titles(search(f.db, f.mark, 'make a page'), 'sop').includes('Zebra checklist'));
  assert.equal(search(f.db, f.mark, 'nothing matches this').groups.length, 0);
});

test('a Contractor sees only their own tasks, events they attend, their notes and follow-ups assigned to them', async () => {
  const f = await setup();
  const out = search(f.db, f.cole, 'zebra');
  assert.deepEqual(out.groups.map((g) => g.type), ['task', 'note', 'follow_up', 'event']);
  assert.deepEqual(titles(out, 'task'), ['Zebra copy for Cole']);
  assert.deepEqual(titles(out, 'event'), ['Zebra kickoff']);
  assert.deepEqual(titles(out, 'note'), ['Zebra kickoff notes']);
  assert.deepEqual(titles(out, 'follow_up'), ['Zebra quote for Cole']);
  assert.equal(search(f.db, f.cole, 'rayne').groups.length, 0);
});

test('an Employee sees what staff see, but never a draft SOP', async () => {
  const f = await setup();
  const out = search(f.db, f.sarah, 'zebra');
  assert.deepEqual(titles(out, 'sop'), ['Zebra checklist']);
  assert.equal(groupOf(out, 'task').length, 2);
  assert.equal(groupOf(out, 'client').length, 1);
  assert.equal(groupOf(out, 'request').length, 1);
  assert.equal(groupOf(out, 'decision').length, 1);
  assert.equal(groupOf(out, 'follow_up').length, 2);
});

test('another agency never appears, in either direction', async () => {
  const f = await setup();
  clients.createClient(f.db, f.zed, { name: 'Zebra Outsider' });
  assert.deepEqual(titles(search(f.db, f.mark, 'outsider'), 'client'), []);
  assert.deepEqual(titles(search(f.db, f.zed, 'zebra'), 'client'), ['Zebra Outsider']);
  assert.equal(search(f.db, f.zed, 'zebra').groups.length, 1);
  assert.equal(search(f.db, f.zed, 'rayne').groups.length, 0);
});

test('percent and underscore are searched as plain text', async () => {
  const f = await setup();
  clients.createClient(f.db, f.mark, { name: '100% Organic' });
  clients.createClient(f.db, f.mark, { name: 'Snake_case Co' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Reach 100% of goals' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Snakeacase tidy' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Reach 1000 of goals' });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Rename snake_case files' });
  assert.deepEqual(titles(search(f.db, f.mark, '%'.repeat(2)), 'task'), []);
  assert.deepEqual(titles(search(f.db, f.mark, '0% o'), 'client'), ['100% Organic']);
  assert.deepEqual(titles(search(f.db, f.mark, '0% o'), 'task'), ['Reach 100% of goals']);
  assert.deepEqual(titles(search(f.db, f.mark, 'e_c'), 'client'), ['Snake_case Co']);
  assert.deepEqual(titles(search(f.db, f.mark, 'e_c'), 'task'), ['Rename snake_case files']);
  assert.deepEqual(titles(search(f.db, f.mark, '__'), 'task'), []);
});

test('the text must be at least two characters, and each group is capped at eight', async () => {
  const f = await setup();
  assert.throws(() => search(f.db, f.mark, 'a'), /at least 2/i);
  assert.throws(() => search(f.db, f.mark, '  '), /at least 2/i);
  assert.throws(() => search(f.db, f.mark), /at least 2/i);
  for (let i = 0; i < 12; i++) tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: `Bulk item ${i}` });
  assert.equal(groupOf(search(f.db, f.mark, 'bulk item'), 'task').length, 8);
  assert.equal(groupOf(search(f.db, f.mark, 'bulk item', { limit: 3 }), 'task').length, 3);
  assert.equal(groupOf(search(f.db, f.mark, 'bulk item', { limit: 50 }), 'task').length, 8);
});
