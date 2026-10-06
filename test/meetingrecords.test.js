// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const events = require('../server/services/events');
const notes = require('../server/services/meetingnotes');
const requests = require('../server/services/requests');
const decisions = require('../server/services/decisions');
const followups = require('../server/services/followups');
const { extractRecords, recordsOfNote, lines } = require('../server/services/noterecords');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  f.zedClient = clients.createClient(f.db, f.zed, { name: 'Zed Client' });
  return f;
}
const note = (f, over = {}) => notes.createNote(f.db, f.mark, { title: 'Kickoff', meetingDate: '2026-10-12', clientId: f.client.id, projectId: f.project.id, ...over });

test('lines are read from bullets, numbers and plain text', () => {
  assert.deepEqual(lines('- One\n* Two\n\n3. Three\n  4) Four\nFive'), ['One', 'Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(lines(''), []);
});

test('a meeting note turns into decisions, requests and follow-ups linked back to it', async () => {
  const f = await setup();
  const n = note(f, { decisions: '- Use WordPress\n- Launch in November', requests: '1. Add online booking', followUps: '- Mark sends a quote\n- Rayne books the shoot' });
  const out = extractRecords(f.db, f.mark, n.id);
  assert.deepEqual([out.created.decisions.length, out.created.requests.length, out.created.followUps.length], [2, 1, 2]);
  const d = decisions.listDecisions(f.db, f.sarah);
  assert.deepEqual(d.map((x) => [x.title, x.decidedOn, x.clientName, x.projectName, x.sourceNoteTitle]).sort(), [['Launch in November', '2026-10-12', 'Acme Dental', 'Website', 'Kickoff'], ['Use WordPress', '2026-10-12', 'Acme Dental', 'Website', 'Kickoff']]);
  const r = requests.listRequests(f.db, f.sarah);
  assert.deepEqual([r[0].title, r[0].status, r[0].clientName, r[0].sourceNoteId], ['Add online booking', 'new', 'Acme Dental', n.id]);
  assert.equal(followups.listFollowUps(f.db, f.sarah).length, 2);
  assert.deepEqual(recordsOfNote(f.db, f.mark, n.id), { decisions: 2, requests: 1, followUps: 2 });
});

test('running it twice does not double anything; new lines are added', async () => {
  const f = await setup();
  const n = note(f, { decisions: '- Use WordPress', followUps: '- Send quote' });
  extractRecords(f.db, f.mark, n.id);
  const again = extractRecords(f.db, f.mark, n.id);
  assert.deepEqual([again.created.decisions.length, again.skipped.decisions, again.skipped.followUps], [0, 1, 1]);
  notes.updateNote(f.db, f.mark, n.id, { decisions: '- Use WordPress\n- Hire a photographer' });
  assert.deepEqual(extractRecords(f.db, f.mark, n.id, { kinds: ['decisions'] }).created.decisions.map((x) => x.title), ['Hire a photographer']);
  assert.equal(decisions.listDecisions(f.db, f.mark).length, 2);
});

test('requests need a client; only managers extract; kinds are checked', async () => {
  const f = await setup();
  const bare = notes.createNote(f.db, f.mark, { title: 'No client', meetingDate: '2026-10-12', requests: '- Something', decisions: '- A decision' });
  assert.throws(() => extractRecords(f.db, f.mark, bare.id), /client first/);
  assert.equal(decisions.listDecisions(f.db, f.mark).length, 0, 'nothing is half-created');
  assert.equal(extractRecords(f.db, f.mark, bare.id, { kinds: ['decisions'] }).created.decisions.length, 1);
  const n = note(f, { decisions: '- X' });
  assert.throws(() => extractRecords(f.db, f.sarah, n.id), /not allowed/i);
  assert.throws(() => extractRecords(f.db, f.mark, n.id, { kinds: ['tasks'] }), /Choose from/);
  assert.throws(() => extractRecords(f.db, f.zed, n.id), /not found/i);
});

test('a long line keeps its full text in the details', async () => {
  const f = await setup();
  const long = 'x'.repeat(250);
  const n = note(f, { decisions: long });
  extractRecords(f.db, f.mark, n.id);
  const d = decisions.listDecisions(f.db, f.mark)[0];
  assert.deepEqual([d.title.length, d.details.length], [200, 250]);
});

test('client requests: who may add and edit, and which statuses', async () => {
  const f = await setup();
  const r = requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'Add a blog', requestedBy: 'Dr. Lee' });
  assert.deepEqual([r.status, r.requestedBy, r.canEdit, r.canManage, r.canConvert], ['new', 'Dr. Lee', true, false, false]);
  assert.throws(() => requests.createRequest(f.db, f.cole, { clientId: f.client.id, title: 'x' }), /not allowed/i);
  assert.throws(() => requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'x', status: 'approved' }), /manager/i);
  assert.equal(requests.updateRequest(f.db, f.sarah, r.id, { status: 'reviewing', description: 'More detail' }).status, 'reviewing');
  assert.throws(() => requests.updateRequest(f.db, f.sarah, r.id, { status: 'approved' }), /manager/i);
  const other = requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Managers own' });
  assert.throws(() => requests.updateRequest(f.db, f.sarah, other.id, { title: 'x' }), /not allowed/i);
  for (const s of ['approved', 'in_progress', 'waiting', 'completed', 'rejected']) assert.equal(requests.updateRequest(f.db, f.mark, r.id, { status: s }).status, s);
  assert.throws(() => requests.updateRequest(f.db, f.mark, r.id, { status: 'done' }), /valid status/);
  assert.equal(requests.getRequest(f.db, f.sarah, r.id).canEdit, false, 'staff can no longer edit once a manager has moved it on');
});

test('request links: project must belong to the client, and another agency is not found', async () => {
  const f = await setup();
  const c2 = clients.createClient(f.db, f.mark, { name: 'Second' });
  assert.throws(() => requests.createRequest(f.db, f.mark, { clientId: c2.id, projectId: f.project.id, title: 'x' }), /another client/);
  assert.throws(() => requests.createRequest(f.db, f.mark, { clientId: f.zedClient.id, title: 'x' }), /not found/i);
  const r = requests.createRequest(f.db, f.mark, { clientId: f.client.id, projectId: f.project.id, title: 'x' });
  assert.equal(requests.updateRequest(f.db, f.mark, r.id, { clientId: c2.id }).projectId, null);
  assert.throws(() => requests.getRequest(f.db, f.zed, r.id), /not found/i);
  assert.throws(() => requests.listRequests(f.db, f.cole), /not allowed/i);
});

test('Convert to Task keeps the link, moves the request on, and cannot be done twice', async () => {
  const f = await setup();
  const r = requests.createRequest(f.db, f.mark, { clientId: f.client.id, projectId: f.project.id, title: 'Add online booking', description: 'Hygiene visits', ownerId: f.ids.sarah, dueDate: '2026-11-01' });
  assert.equal(r.canConvert, true);
  assert.throws(() => requests.convertToTask(f.db, f.sarah, r.id), /not allowed/i);
  const out = requests.convertToTask(f.db, f.mark, r.id, { priority: 'high' });
  assert.deepEqual([out.task.title, out.task.projectName, out.task.assigneeId, out.task.dueDate, out.task.priority], ['Add online booking', 'Website', f.ids.sarah, '2026-11-01', 'high']);
  assert.match(out.task.description, /Hygiene visits[\s\S]*client request #/);
  assert.deepEqual([out.request.status, out.request.taskId, out.request.taskStatus, out.request.canConvert], ['in_progress', out.task.id, 'todo', false]);
  tasks.updateTask(f.db, f.mark, out.task.id, { status: 'done' });
  assert.equal(requests.getRequest(f.db, f.mark, r.id).taskStatus, 'done');
  assert.throws(() => requests.convertToTask(f.db, f.mark, r.id), /already has a task/);
  const noProject = requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Loose' });
  assert.throws(() => requests.convertToTask(f.db, f.mark, noProject.id), /Choose a project/);
  const c2 = clients.createClient(f.db, f.mark, { name: 'Second' });
  const p2 = projects.createProject(f.db, f.mark, { clientId: c2.id, name: 'P2' });
  assert.throws(() => requests.convertToTask(f.db, f.mark, noProject.id, { projectId: p2.id }), /another client/);
  assert.equal(requests.convertToTask(f.db, f.mark, noProject.id, { projectId: f.project.id }).task.projectId, f.project.id);
  const rejected = requests.createRequest(f.db, f.mark, { clientId: f.client.id, projectId: f.project.id, title: 'No', status: 'rejected' });
  assert.throws(() => requests.convertToTask(f.db, f.mark, rejected.id), /cannot become a task/);
});

test('decisions: managers write, staff read, contractors do not see them', async () => {
  const f = await setup();
  assert.throws(() => decisions.createDecision(f.db, f.sarah, { title: 'x', decidedOn: '2026-10-01' }), /not allowed/i);
  assert.throws(() => decisions.createDecision(f.db, f.mark, { title: 'x' }), /required/i);
  const d = decisions.createDecision(f.db, f.mark, { title: 'Use WordPress', decidedOn: '2026-10-01', projectId: f.project.id, details: 'Cheaper' });
  assert.equal(d.clientName, 'Acme Dental');
  assert.equal(decisions.getDecision(f.db, f.sarah, d.id).canEdit, false);
  assert.equal(decisions.updateDecision(f.db, f.mark, d.id, { status: 'reversed' }).status, 'reversed');
  assert.deepEqual(decisions.listDecisions(f.db, f.sarah, { status: 'active' }), []);
  assert.throws(() => decisions.listDecisions(f.db, f.cole), /not allowed/i);
  assert.throws(() => decisions.getDecision(f.db, f.zed, d.id), /not found/i);
  assert.throws(() => decisions.deleteDecision(f.db, f.sarah, d.id), /not allowed/i);
  decisions.deleteDecision(f.db, f.mark, d.id);
  assert.equal(decisions.listDecisions(f.db, f.mark).length, 0);
});

test('follow-ups: assignee may finish theirs, a Contractor sees only theirs, overdue is marked', async () => {
  const f = await setup();
  const mine = followups.createFollowUp(f.db, f.mark, { title: 'Send quote', assigneeId: f.ids.sarah, dueDate: '2020-01-01', clientId: f.client.id });
  const cole = followups.createFollowUp(f.db, f.mark, { title: 'Cole task', assigneeId: f.ids.cole });
  followups.createFollowUp(f.db, f.mark, { title: 'Unassigned' });
  assert.equal(mine.isOverdue, true);
  assert.deepEqual(followups.listFollowUps(f.db, f.cole).map((x) => x.title), ['Cole task']);
  assert.equal(followups.listFollowUps(f.db, f.cole)[0].clientName, null);
  assert.throws(() => followups.getFollowUp(f.db, f.cole, mine.id), /not found/i);
  assert.equal(followups.listFollowUps(f.db, f.sarah, { mine: 1 }).length, 1);
  assert.equal(followups.listFollowUps(f.db, f.sarah, { overdue: 1 }).length, 1);
  assert.throws(() => followups.createFollowUp(f.db, f.cole, { title: 'x' }), /not allowed/i);
  assert.throws(() => followups.updateFollowUp(f.db, f.sarah, mine.id, { title: 'renamed' }), /not allowed/i);
  const done = followups.updateFollowUp(f.db, f.sarah, mine.id, { status: 'done' });
  assert.deepEqual([done.status, done.isOverdue], ['done', false]);
  assert.ok(done.completedAt);
  assert.equal(followups.updateFollowUp(f.db, f.cole, cole.id, { status: 'done' }).status, 'done');
  assert.equal(followups.updateFollowUp(f.db, f.sarah, mine.id, { status: 'open' }).completedAt, null);
  assert.throws(() => followups.updateFollowUp(f.db, f.sarah, mine.id, { status: 'archived' }), /valid status/);
  assert.throws(() => followups.deleteFollowUp(f.db, f.sarah, mine.id), /not allowed/i);
  assert.throws(() => followups.updateFollowUp(f.db, f.zed, mine.id, { status: 'done' }), /not found/i);
  followups.deleteFollowUp(f.db, f.mark, mine.id);
});

test('creating and converting is logged with the source note', async () => {
  const f = await setup();
  const n = note(f, { decisions: '- A', requests: '- B' });
  extractRecords(f.db, f.mark, n.id);
  const r = requests.listRequests(f.db, f.mark)[0];
  requests.convertToTask(f.db, f.mark, r.id);
  const actions = listActivity(f.db, f.josh, { limit: 100 }).map((a) => a.action);
  for (const a of ['decision.create', 'request.create', 'meeting_note.extract', 'request.convert', 'task.create']) assert.ok(actions.includes(a), a);
  assert.equal(listActivity(f.db, f.josh).find((a) => a.action === 'request.create').after.sourceNoteId, n.id);
});
