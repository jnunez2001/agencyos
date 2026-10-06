// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const notes = require('../server/services/meetingnotes');
const decisions = require('../server/services/decisions');
const requests = require('../server/services/requests');
const followups = require('../server/services/followups');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: '2026-10-20' };
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme' });
  f.other = clients.createClient(f.db, f.mark, { name: 'Beta' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Site' });
  f.otherProject = projects.createProject(f.db, f.mark, { clientId: f.other.id, name: 'Other site' });
  return f;
}

test('meeting notes keep purpose, risks, context, SOP impact and next meeting; the list leaves them out', async () => {
  const f = await setup();
  const n = notes.createNote(f.db, f.mark, { title: 'Kickoff', meetingDate: '2026-10-20', purpose: 'Agree scope', risks: 'Tight launch', importantContext: 'Prefers email', sopImpact: 'Launch SOP', nextMeeting: 'Oct 27' });
  assert.deepEqual([n.purpose, n.risks, n.importantContext, n.sopImpact, n.nextMeeting], ['Agree scope', 'Tight launch', 'Prefers email', 'Launch SOP', 'Oct 27']);
  const u = notes.updateNote(f.db, f.mark, n.id, { risks: 'Very tight launch' });
  assert.equal(u.risks, 'Very tight launch');
  assert.equal(u.purpose, 'Agree scope');
  const row = notes.listNotes(f.db, f.mark)[0];
  for (const k of ['purpose', 'risks', 'importantContext', 'sopImpact', 'nextMeeting']) assert.equal(k in row, false, k);
  assert.throws(() => notes.updateNote(f.db, f.mark, n.id, { purpose: 'x'.repeat(5001) }), /Purpose must be/);
  const log = listActivity(f.db, f.josh, { action: 'meeting_note.update' })[0];
  assert.deepEqual(Object.keys(log.after), ['risks']);
  assert.equal(notes.getNote(f.db, f.mark, n.id).risks, 'Very tight launch');
});

test('decisions keep who was involved', async () => {
  const f = await setup();
  const d = decisions.createDecision(f.db, f.mark, { title: 'Use WordPress', decidedOn: '2026-10-20', peopleInvolved: 'Dr. Lee, Mark' });
  assert.equal(d.peopleInvolved, 'Dr. Lee, Mark');
  assert.equal(decisions.updateDecision(f.db, f.mark, d.id, { peopleInvolved: 'Dr. Lee' }).peopleInvolved, 'Dr. Lee');
  assert.equal(decisions.createDecision(f.db, f.mark, { title: 'Other', decidedOn: '2026-10-20' }).peopleInvolved, '');
  assert.throws(() => decisions.createDecision(f.db, f.mark, { title: 'Long', decidedOn: '2026-10-20', peopleInvolved: 'x'.repeat(501) }), /People involved/);
});

test('requests have priority, source and received date (today by default in the agency timezone)', async () => {
  const f = await setup();
  const r = requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'Add a blog' });
  assert.deepEqual([r.priority, r.source, r.receivedOn], ['normal', '', '2026-10-20']);
  const h = requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'Fix menu', priority: 'urgent', source: 'Client call', receivedOn: '2026-10-18' });
  assert.deepEqual([h.priority, h.source, h.receivedOn], ['urgent', 'Client call', '2026-10-18']);
  assert.equal(requests.updateRequest(f.db, f.sarah, h.id, { priority: 'low', source: 'Email' }).priority, 'low');
  assert.throws(() => requests.createRequest(f.db, f.sarah, { clientId: f.client.id, title: 'x', priority: 'huge' }), /priority/i);
  assert.throws(() => requests.updateRequest(f.db, f.sarah, h.id, { receivedOn: '' }), /Received on is required/);
  assert.deepEqual(requests.listRequests(f.db, f.mark, { priority: 'low' }).map((x) => x.id), [h.id]);
  const log = listActivity(f.db, f.josh, { action: 'request.update' })[0];
  assert.deepEqual(Object.keys(log.after).sort(), ['priority', 'source']);
});

test('follow-ups have a priority and may link a request and a task of the same agency and client', async () => {
  const f = await setup();
  const req = requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: 'Add booking' });
  const otherReq = requests.createRequest(f.db, f.mark, { clientId: f.other.id, title: 'Theirs' });
  const task = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Build booking' });
  const otherTask = tasks.createTask(f.db, f.mark, { projectId: f.otherProject.id, title: 'Theirs' });
  const fu = followups.createFollowUp(f.db, f.mark, { title: 'Check booking', priority: 'high', requestId: req.id, taskId: task.id });
  assert.deepEqual([fu.priority, fu.requestId, fu.requestTitle, fu.taskId, fu.taskTitle, fu.clientId], ['high', req.id, 'Add booking', task.id, 'Build booking', f.client.id]);
  assert.equal(followups.createFollowUp(f.db, f.mark, { title: 'Plain' }).priority, 'normal');
  assert.throws(() => followups.createFollowUp(f.db, f.mark, { title: 'x', clientId: f.client.id, requestId: otherReq.id }), /another client/);
  assert.throws(() => followups.createFollowUp(f.db, f.mark, { title: 'x', clientId: f.client.id, taskId: otherTask.id }), /another client/);
  assert.throws(() => followups.createFollowUp(f.db, f.mark, { title: 'x', requestId: 9999 }), /not found/i);
  // another agency's request or task is never found
  const zc = clients.createClient(f.db, f.zed, { name: 'Zed client' });
  const zr = requests.createRequest(f.db, f.zed, { clientId: zc.id, title: 'Zed request' });
  assert.throws(() => followups.createFollowUp(f.db, f.mark, { title: 'x', requestId: zr.id }), /not found/i);
  // change and clear links
  assert.equal(followups.updateFollowUp(f.db, f.mark, fu.id, { taskId: null }).taskId, null);
  assert.equal(followups.updateFollowUp(f.db, f.mark, fu.id, { priority: 'urgent' }).priority, 'urgent');
  assert.throws(() => followups.updateFollowUp(f.db, f.mark, fu.id, { requestId: otherReq.id }), /another client/);
  assert.deepEqual(followups.listFollowUps(f.db, f.mark, { requestId: req.id }).map((x) => x.id), [fu.id]);
  // deleting the request leaves the follow-up, unlinked
  requests.deleteRequest(f.db, f.mark, req.id);
  assert.equal(followups.getFollowUp(f.db, f.mark, fu.id).requestId, null);
});
