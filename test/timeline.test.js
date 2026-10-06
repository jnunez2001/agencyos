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
const time = require('../server/services/timeentries');
const results = require('../server/services/results');
const reports = require('../server/services/reports');
const { extractRecords } = require('../server/services/noterecords');
const { clientTimeline, traceTask } = require('../server/services/timeline');
const { search } = require('../server/services/search');
const { fixture } = require('./fixture');
const { setUp } = require('./support/http');

const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const CONTENT = { service: 'SEO', purpose: 'Make a page rank', steps: ['Check'], checklist: ['Done'] };

// One client whose last days hold a bit of everything, and a chain: event, note, request, task.
async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website' });
  f.sop = sops.createSop(f.db, f.mark, { ...CONTENT, title: 'Page checklist', status: 'approved' });
  const start = new Date(Date.now() - 3600000);
  f.event = events.createEvent(f.db, f.mark, { title: 'Kickoff call', type: 'client_meeting', startsAt: `${start.toISOString().slice(0, 19)}Z`, endsAt: `${new Date().toISOString().slice(0, 19)}Z`, clientId: f.client.id, attendees: [f.ids.sarah] });
  f.note = notes.createNote(f.db, f.mark, { eventId: f.event.id, meetingDate: day(), decisions: '- Use WordPress', requests: '- Add online booking', followUps: '- Send the quote', discussion: 'Talked about hygiene bookings' });
  f.made = extractRecords(f.db, f.mark, f.note.id);
  f.request = requests.getRequest(f.db, f.mark, f.made.created.requests[0].id);
  f.converted = requests.convertToTask(f.db, f.mark, f.request.id, { projectId: f.project.id, assigneeId: f.ids.sarah, title: 'Build booking', });
  f.task = f.converted.task;
  tasks.updateTask(f.db, f.mark, f.task.id, { sopId: f.sop.id });
  results.recordResult(f.db, f.mark, f.client.id, { metric: 'Organic leads', value: 40, unit: 'leads' });
  f.report = reports.generateReport(f.db, f.mark, f.client.id, { periodStart: day(-7), periodEnd: day() });
  const entry = time.createEntry(f.db, f.sarah, { taskId: f.task.id, minutes: 90, description: 'Secret wireframes' });
  time.submitEntries(f.db, f.sarah, { ids: [entry.id] });
  time.approveEntry(f.db, f.mark, entry.id);
  f.other = clients.createClient(f.db, f.mark, { name: 'Quiet Client' });
  return f;
}

const typesOf = (t) => t.groups.map((g) => g.type);

test('the timeline gathers what happened for a client, grouped and newest first', async () => {
  const f = await setup();
  const t = clientTimeline(f.db, f.mark, f.client.id);
  assert.equal(t.days, 7);
  assert.deepEqual(typesOf(t), ['event', 'note', 'decision', 'request', 'follow_up', 'task', 'time', 'result', 'report']);
  for (const item of t.items) { assert.deepEqual(Object.keys(item).slice(0, 5), ['type', 'id', 'title', 'at', 'hash']); assert.match(item.at, /^\d{4}-\d{2}-\d{2}T/); }
  for (let i = 1; i < t.items.length; i += 1) assert.ok(t.items[i - 1].at >= t.items[i].at, 'newest first');
  assert.equal(t.total, t.items.length);
  const byType = (type) => t.groups.find((g) => g.type === type).items;
  assert.deepEqual(byType('event')[0], { type: 'event', id: f.event.id, title: 'Kickoff call', at: f.event.startsAt, hash: `#/calendar/${f.event.id}` });
  assert.equal(byType('note')[0].hash, `#/meetings/${f.note.id}`);
  assert.equal(byType('decision')[0].title, 'Use WordPress');
  assert.deepEqual(byType('request').map((i) => i.title).sort(), ['Add online booking', 'Add online booking: In progress']);
  assert.ok(byType('follow_up').some((i) => i.title === 'Send the quote'));
  assert.deepEqual(byType('task').map((i) => i.title), ['Build booking']);
  assert.equal(byType('result')[0].title, 'Organic leads: 40 leads');
  assert.equal(byType('report')[0].hash, `#/reports/${f.report.id}`);
});

test('approved time is hours only, never the description or the person', async () => {
  const f = await setup();
  const t = clientTimeline(f.db, f.mark, f.client.id);
  const item = t.groups.find((g) => g.type === 'time').items[0];
  assert.deepEqual([item.title, item.hours, item.id], ['1.5 hours approved', 1.5, null]);
  assert.doesNotMatch(JSON.stringify(t), /Secret wireframes|Sarah/);
});

test('completed tasks, completed follow-ups, approved reports and status changes appear as they happen', async () => {
  const f = await setup();
  tasks.updateTask(f.db, f.mark, f.task.id, { status: 'done' });
  followups.updateFollowUp(f.db, f.mark, f.made.created.followUps[0].id, { status: 'done' });
  reports.approveReport(f.db, f.mark, f.report.id);
  requests.updateRequest(f.db, f.mark, f.request.id, { status: 'waiting' });
  const titles = clientTimeline(f.db, f.mark, f.client.id).items.map((i) => i.title);
  for (const wanted of ['Build booking: done', 'Send the quote: done', `${f.report.title}: approved`, 'Add online booking: Waiting']) assert.ok(titles.includes(wanted), wanted);
});

test('the window is the days asked for; older records and other clients are left out', async () => {
  const f = await setup();
  f.db.prepare('UPDATE decisions SET decided_on = ?').run(day(-20));
  f.db.prepare('UPDATE client_results SET recorded_on = ?').run(day(-20));
  const week = clientTimeline(f.db, f.mark, f.client.id);
  assert.ok(!typesOf(week).includes('decision') && !typesOf(week).includes('result'));
  const month = clientTimeline(f.db, f.mark, f.client.id, { days: 30 });
  assert.ok(typesOf(month).includes('decision') && typesOf(month).includes('result'));
  assert.equal(clientTimeline(f.db, f.mark, f.other.id).total, 0);
  for (const bad of [0, 91, 1.5, 'x']) assert.throws(() => clientTimeline(f.db, f.mark, f.client.id, { days: bad }), /Days must be/);
});

test('every role sees only what its own screens show', async () => {
  const f = await setup();
  assert.throws(() => clientTimeline(f.db, f.cole, f.client.id), /Not allowed/);
  const sarah = clientTimeline(f.db, f.sarah, f.client.id);
  assert.ok(!typesOf(sarah).includes('time'), 'time is for people who review the team\'s time');
  assert.ok(typesOf(sarah).includes('task') && typesOf(sarah).includes('report'));
  assert.deepEqual(clientTimeline(f.db, f.mark, f.client.id).items.map((i) => i.title).filter((t) => t !== '1.5 hours approved').sort(), sarah.items.map((i) => i.title).sort());
  // a note the person may not open is not in their timeline either (an Employee sees every note; the rule is the notes service's)
  assert.throws(() => clientTimeline(f.db, f.zed, f.client.id), /Client not found/);
  assert.throws(() => clientTimeline(f.db, f.mark, 999999), /Client not found/);
  assert.equal(clientTimeline(f.db, f.zed, clients.createClient(f.db, f.zed, { name: 'Zed Client' }).id).total, 0);
});

test('a task traces back to its request, meeting note, event, decisions, follow-ups, SOP and time', async () => {
  const f = await setup();
  const t = traceTask(f.db, f.mark, f.task.id);
  assert.equal(t.taskId, f.task.id);
  assert.deepEqual(t.request, { id: f.request.id, title: 'Add online booking', status: 'in_progress', hash: `#/requests/${f.request.id}` });
  assert.deepEqual(t.meetingNote, { id: f.note.id, title: 'Kickoff call', date: day(), hash: `#/meetings/${f.note.id}` });
  assert.equal(t.event.id, f.event.id);
  assert.deepEqual(t.decisions.map((d) => d.title), ['Use WordPress']);
  assert.deepEqual(t.followUps.map((x) => x.title), ['Send the quote']);
  assert.deepEqual(t.sop, { id: f.sop.id, title: 'Page checklist', version: '1.0', hash: `#/sops/${f.sop.id}` });
  assert.deepEqual(t.timeEntries, { scope: 'team', count: 1, hours: 1.5, approvedHours: 1.5 });
  const plain = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Made by hand' });
  assert.deepEqual(traceTask(f.db, f.mark, plain.id), { taskId: plain.id, request: null, meetingNote: null, event: null, decisions: [], followUps: [], sop: null, timeEntries: { scope: 'team', count: 0, hours: 0, approvedHours: 0 } });
});

test('a trace leaves out the links this person may not see', async () => {
  const f = await setup();
  tasks.updateTask(f.db, f.mark, f.task.id, { assigneeId: f.ids.cole });
  // a Contractor sees their own task, but not the request, the note, decisions or the SOP link
  const c = traceTask(f.db, f.cole, f.task.id);
  assert.deepEqual([c.request, c.meetingNote, c.event, c.decisions, c.followUps], [null, null, null, [], []]);
  assert.deepEqual(c.sop, { id: f.sop.id, title: 'Page checklist', version: '1.0', hash: null });
  assert.equal(c.timeEntries.scope, 'mine');
  assert.equal(c.timeEntries.count, 0, 'the time on it was logged by someone else');
  const sarah = traceTask(f.db, f.sarah, f.task.id);
  assert.equal(sarah.timeEntries.scope, 'mine');
  assert.equal(sarah.timeEntries.count, 1);
  // not their task: not found, as everywhere else
  const mine = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Sarah only', assigneeId: f.ids.sarah });
  assert.throws(() => traceTask(f.db, f.cole, mine.id), /Task not found/);
  // another agency
  assert.throws(() => traceTask(f.db, f.zed, f.task.id), /Task not found/);
  // a note the Contractor does not attend is not linked even by an event they cannot open
  events.updateEvent(f.db, f.mark, f.event.id, { attendees: [f.ids.cole] });
  assert.equal(traceTask(f.db, f.cole, f.task.id).meetingNote, null, 'a Contractor never sees the request, so never its note');
});

test('the API and the MCP tools serve both reads', async () => {
  const app = await setUp();
  const mark = app.client();
  await mark.signIn('mark');
  const cl = await app.owner.call('POST', '/clients', { name: 'Acme Dental' });
  const pr = await app.owner.call('POST', '/projects', { clientId: cl.data.id, name: 'Website' });
  const rq = await app.owner.call('POST', '/requests', { clientId: cl.data.id, title: 'Add booking' });
  const cv = await app.owner.call('POST', `/requests/${rq.data.id}/convert`, { projectId: pr.data.id });
  const tl = await mark.call('GET', `/clients/${cl.data.id}/timeline?days=3`);
  assert.equal(tl.status, 200);
  assert.equal(tl.data.days, 3);
  assert.ok(tl.data.items.some((i) => i.title === 'Add booking'));
  assert.equal((await mark.call('GET', `/clients/${cl.data.id}/timeline?days=500`)).status, 400);
  const tr = await mark.call('GET', `/tasks/${cv.data.task.id}/trace`);
  assert.equal(tr.status, 200);
  assert.equal(tr.data.request.id, rq.data.id);
  const cole = app.client();
  await cole.signIn('cole');
  assert.equal((await cole.call('GET', `/clients/${cl.data.id}/timeline`)).status, 403);
  assert.equal((await cole.call('GET', `/tasks/${cv.data.task.id}/trace`)).status, 404);
  const key = (await app.owner.call('POST', '/api-keys', { name: 'k', access: 'read' })).data;
  const call = async (name, args) => { const res = await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }); return (await res.json()).result; };
  const a = await call('get_client_timeline', { clientId: cl.data.id });
  assert.ok(!a.isError && JSON.parse(a.content[0].text).items.length >= 1);
  const b = await call('trace_task', { taskId: cv.data.task.id });
  assert.equal(JSON.parse(b.content[0].text).request.title, 'Add booking');
  assert.equal((await call('trace_task', { taskId: 999999 })).isError, true);
  await app.close();
});

test('search finds reports and the words inside meeting notes, without leaking', async () => {
  const f = await setup();
  const groupOf = (out, type) => (out.groups.find((g) => g.type === type) || { results: [] }).results;
  const byReport = search(f.db, f.mark, 'acme dental');
  assert.ok(groupOf(byReport, 'report').some((r) => r.id === f.report.id && r.hash === `#/reports/${f.report.id}`));
  assert.deepEqual(Object.keys(groupOf(byReport, 'report')[0]).sort(), ['hash', 'id', 'subtitle', 'title', 'type']);
  assert.deepEqual(groupOf(search(f.db, f.mark, 'acme dental report'), 'report').map((r) => r.id), [f.report.id]);
  assert.equal(groupOf(search(f.db, f.cole, 'acme dental'), 'report').length, 0, 'a Contractor has no reports');
  assert.equal(groupOf(search(f.db, f.zed, 'acme dental'), 'report').length, 0, 'another agency has none');
  // words from the discussion, decisions, requests and follow-ups find the note
  for (const word of ['hygiene bookings', 'use wordpress', 'online booking', 'send the quote']) assert.deepEqual(groupOf(search(f.db, f.mark, word), 'note').map((n) => n.id), [f.note.id], word);
  // the raw transcript is still not searched
  notes.updateNote(f.db, f.mark, f.note.id, { transcript: 'Dr. Lee whispered the passphrase marmalade' });
  assert.equal(groupOf(search(f.db, f.mark, 'marmalade'), 'note').length, 0);
  // a Contractor who does not attend the event cannot find the note through its text; one who does can
  assert.equal(groupOf(search(f.db, f.cole, 'hygiene bookings'), 'note').length, 0);
  assert.equal(groupOf(search(f.db, f.zed, 'hygiene bookings'), 'note').length, 0);
  events.updateEvent(f.db, f.mark, f.event.id, { attendees: [f.ids.cole] });
  assert.equal(groupOf(search(f.db, f.cole, 'hygiene bookings'), 'note').length, 1);
  // the list endpoint's q behaves the same way
  assert.equal(notes.listNotes(f.db, f.mark, { q: 'hygiene' }).length, 1);
  assert.equal(notes.listNotes(f.db, f.mark, { q: '100%' }).length, 0);
});

test('lists accept limit and offset, capped at 200, and keep their size without them', async () => {
  const f = await setup();
  for (let i = 0; i < 5; i += 1) requests.createRequest(f.db, f.mark, { clientId: f.client.id, title: `Extra ${i}` });
  const all = requests.listRequests(f.db, f.mark);
  assert.equal(all.length, 6);
  assert.deepEqual(requests.listRequests(f.db, f.mark, { limit: '2' }).map((r) => r.id), all.slice(0, 2).map((r) => r.id));
  assert.deepEqual(requests.listRequests(f.db, f.mark, { limit: '2', offset: '2' }).map((r) => r.id), all.slice(2, 4).map((r) => r.id));
  assert.deepEqual(requests.listRequests(f.db, f.mark, { offset: '4' }).map((r) => r.id), all.slice(4).map((r) => r.id));
  assert.equal(requests.listRequests(f.db, f.mark, { limit: 'many', offset: '-3' }).length, 6, 'nonsense is ignored');
  assert.equal(decisions.listDecisions(f.db, f.mark, { limit: 1 }).length, 1);
  assert.equal(followups.listFollowUps(f.db, f.mark, { limit: 1 }).length, 1);
  assert.equal(notes.listNotes(f.db, f.mark, { limit: 1 }).length, 1);
  assert.equal(tasks.listTasks(f.db, f.mark, { limit: 1 }).length, 1);
  assert.equal(time.listEntries(f.db, f.mark, { limit: 1 }).length, 1);
  const { MAX_PAGE, pageOf } = require('../server/services/paging');
  assert.deepEqual([MAX_PAGE, pageOf({ limit: 5000 }, 300).limit, pageOf({}, 300).limit, pageOf({ limit: 0 }, 300).limit], [200, 200, 300, 300]);
});

test('limit and offset work on every list endpoint over HTTP, and 500 asks for at most 200', async () => {
  const app = await setUp();
  const o = app.owner;
  const cl = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  const pr = (await o.call('POST', '/projects', { clientId: cl.id, name: 'Site' })).data;
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await o.call('POST', '/tasks', { projectId: pr.id, title: `Task ${i}` })).status, 200);
    assert.equal((await o.call('POST', '/requests', { clientId: cl.id, title: `Request ${i}` })).status, 200);
    assert.equal((await o.call('POST', '/decisions', { title: `Decision ${i}`, decidedOn: day(-i) })).status, 200);
    assert.equal((await o.call('POST', '/follow-ups', { title: `Follow ${i}` })).status, 200);
    assert.equal((await o.call('POST', '/meeting-notes', { title: `Note ${i}`, meetingDate: day(-i) })).status, 200);
    assert.equal((await o.call('POST', '/time-entries', { minutes: 10 + i, timeType: 'internal' })).status, 200);
  }
  for (const path of ['/tasks', '/requests', '/decisions', '/follow-ups', '/meeting-notes', '/time-entries', '/activity']) {
    const all = (await o.call('GET', path)).data;
    assert.ok(all.length >= 4, path);
    const first = (await o.call('GET', `${path}?limit=2`)).data;
    const second = (await o.call('GET', `${path}?limit=2&offset=2`)).data;
    assert.deepEqual([first.length, second.length], [2, 2], path);
    assert.deepEqual([...first, ...second].map((r) => r.id), all.slice(0, 4).map((r) => r.id), path);
    assert.deepEqual((await o.call('GET', `${path}?limit=500`)).data.map((r) => r.id), all.slice(0, 200).map((r) => r.id), `${path} capped`);
    assert.deepEqual((await o.call('GET', `${path}?limit=abc&offset=-1`)).data.map((r) => r.id), all.map((r) => r.id), `${path} nonsense ignored`);
  }
  await app.close();
});
