// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { rpc, async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}

test('calendar over HTTP: create, read, change, delete, with permissions', async () => {
  const app = await setUp();
  const o = app.owner;
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const c = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  const e = (await o.call('POST', '/events', { title: 'Kickoff', type: 'client_meeting', startsAt: '2026-10-12T14:00:00Z', endsAt: '2026-10-12T15:00:00Z', clientId: c.id, attendees: [3] })).data;
  assert.equal(e.clientName, 'Acme');
  assert.equal((await o.call('GET', '/calendar?from=2026-10-01&to=2026-10-31')).data.events.length, 1);
  assert.equal((await sarah.call('GET', '/calendar?from=2026-10-01&to=2026-10-31')).data.events.length, 1);
  assert.equal((await cole.call('GET', '/calendar?from=2026-10-01&to=2026-10-31')).data.events.length, 0);
  assert.equal((await cole.call('GET', `/events/${e.id}`)).status, 404);
  assert.equal((await sarah.call('POST', '/events', { title: 'x', startsAt: '2026-10-12T14:00:00Z' })).status, 403);
  assert.equal((await sarah.call('POST', '/events', { title: 'Focus', type: 'blocked_time', startsAt: '2026-10-12T14:00:00Z' })).status, 200);
  assert.equal((await sarah.call('PATCH', `/events/${e.id}`, { title: 'x' })).status, 403);
  assert.equal((await o.call('PATCH', `/events/${e.id}`, { title: 'Kickoff call' })).data.title, 'Kickoff call');
  assert.equal((await o.call('GET', '/calendar?from=2026-10-01')).status, 400);
  assert.equal((await sarah.call('DELETE', `/events/${e.id}`)).status, 403);
  assert.equal((await o.call('DELETE', `/events/${e.id}`)).status, 200);
  assert.equal((await o.call('GET', `/events/${e.id}`)).status, 404);
  const s = (await o.call('GET', '/session')).data;
  assert.equal(s.can['events.manage'], true);
  assert.equal((await sarah.call('GET', '/session')).data.can['events.manage'], false);
  await app.close();
});

test('AI can read the calendar and propose events, but cannot delete', async () => {
  const app = await setUp();
  const key = (await app.owner.call('POST', '/api-keys', { name: 'cal', access: 'propose' })).data;
  const ai = mcp(app, key.token);
  const names = (await ai.rpc('tools/list')).result.tools.map((t) => t.name);
  for (const n of ['list_events', 'get_event', 'create_event', 'update_event']) assert.ok(names.includes(n), n);
  assert.ok(!names.some((n) => n.includes('delete_event')));
  const proposed = await ai.tool('create_event', { title: 'Strategy review', type: 'review', startsAt: '2026-10-15T10:00:00Z', endsAt: '2026-10-15T11:00:00Z' });
  assert.equal(proposed.data.status, 'pending');
  assert.match(proposed.data.lines[0], /Strategy review/);
  assert.equal((await ai.tool('list_events', { from: '2026-10-01', to: '2026-10-31' })).data.events.length, 0);
  const approve = await app.owner.call('POST', `/ai/proposals/${proposed.data.proposalId}/approve`, {});
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  const listed = (await ai.tool('list_events', { from: '2026-10-01', to: '2026-10-31' })).data.events;
  assert.equal(listed.length, 1);
  assert.equal((await ai.tool('get_event', { id: listed[0].id })).data.title, 'Strategy review');
  await app.close();
});

test('meeting notes over HTTP and through AI: AI drafts, only a person finalizes', async () => {
  const app = await setUp();
  const o = app.owner;
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const e = (await o.call('POST', '/events', { title: 'Kickoff', type: 'client_meeting', startsAt: '2026-10-12T14:00:00Z', attendees: [4] })).data;
  const n = await sarah.call('POST', '/meeting-notes', { eventId: e.id, discussion: 'Talked pricing' });
  assert.equal(n.status, 200, JSON.stringify(n.data));
  assert.equal((await o.call('GET', `/events/${e.id}`)).data.meetingNoteId, n.data.id);
  assert.equal((await sarah.call('PATCH', `/meeting-notes/${n.data.id}`, { status: 'final' })).status, 403);
  assert.equal((await cole.call('GET', `/meeting-notes/${n.data.id}`)).status, 404);
  assert.equal((await o.call('GET', '/meeting-notes?q=kick')).data.length, 1);
  assert.equal((await sarah.call('DELETE', `/meeting-notes/${n.data.id}`)).status, 403);
  const key = (await o.call('POST', '/api-keys', { name: 'notes', access: 'direct' })).data;
  const ai = mcp(app, key.token);
  const made = await ai.tool('create_meeting_note', { title: 'AI notes', meetingDate: '2026-10-13', summary: 'Drafted by AI' });
  assert.equal(made.data.status, 'applied');
  const id = made.data.results[0].id;
  assert.equal((await ai.tool('get_meeting_note', { id })).data.status, 'draft');
  const fin = await ai.tool('update_meeting_note', { id, status: 'final' });
  assert.equal(fin.isError, true);
  assert.match(String(fin.data), /cannot finalize/i);
  assert.equal((await ai.tool('list_meeting_notes', {})).data.length, 2);
  assert.equal((await o.call('PATCH', `/meeting-notes/${id}`, { status: 'final' })).data.status, 'final');
  assert.equal((await o.call('DELETE', `/meeting-notes/${id}`)).status, 200);
  await app.close();
});

test('records over HTTP and AI: notes become records, requests convert to tasks, AI never decides a request', async () => {
  const app = await setUp();
  const o = app.owner;
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const c = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  const p = (await o.call('POST', '/projects', { clientId: c.id, name: 'Site' })).data;
  const n = (await o.call('POST', '/meeting-notes', { title: 'Kickoff', meetingDate: '2026-10-12', clientId: c.id, projectId: p.id, decisions: '- Use WordPress', requests: '- Add booking', followUps: '- Send quote' })).data;
  assert.equal((await sarah.call('POST', `/meeting-notes/${n.id}/records`, {})).status, 403);
  const out = await o.call('POST', `/meeting-notes/${n.id}/records`, {});
  assert.deepEqual([out.data.created.decisions.length, out.data.created.requests.length, out.data.created.followUps.length], [1, 1, 1]);
  assert.deepEqual((await o.call('GET', `/meeting-notes/${n.id}/records`)).data, { decisions: 1, requests: 1, followUps: 1 });
  const req = (await sarah.call('GET', '/requests')).data[0];
  assert.equal(req.sourceNoteTitle, 'Kickoff');
  assert.equal((await cole.call('GET', '/requests')).status, 403);
  assert.equal((await cole.call('GET', '/decisions')).status, 403);
  assert.equal((await cole.call('GET', '/follow-ups')).data.length, 0);
  const conv = await o.call('POST', `/requests/${req.id}/convert`, {});
  assert.equal(conv.status, 200, JSON.stringify(conv.data));
  assert.equal(conv.data.request.taskId, conv.data.task.id);
  assert.equal((await sarah.call('POST', `/requests/${req.id}/convert`, {})).status, 403);
  const fu = (await o.call('GET', '/follow-ups')).data[0];
  assert.equal((await o.call('PATCH', `/follow-ups/${fu.id}`, { status: 'done', dueDate: '2026-10-20' })).data.status, 'done');
  assert.equal((await o.call('DELETE', `/decisions/${(await o.call('GET', '/decisions')).data[0].id}`)).status, 200);

  const key = (await o.call('POST', '/api-keys', { name: 'rec', access: 'direct' })).data;
  const ai = mcp(app, key.token);
  const made = await ai.tool('create_request', { clientId: c.id, title: 'Add a blog' });
  assert.equal(made.data.status, 'applied');
  const id = made.data.results[0].id;
  const verdict = await ai.tool('update_request', { id, status: 'approved' });
  assert.equal(verdict.isError, true);
  assert.match(String(verdict.data), /manager decides/i);
  assert.equal((await ai.tool('update_request', { id, status: 'reviewing' })).data.status, 'applied');
  assert.equal((await ai.tool('create_follow_up', { title: 'Call the client', dueDate: '2026-10-15' })).data.status, 'applied');
  assert.equal((await ai.tool('create_decision', { title: 'Go live Nov 1', decidedOn: '2026-10-12' })).data.status, 'applied');
  const again = await ai.tool('create_records_from_note', { noteId: n.id });
  assert.equal(again.data.status, 'applied');
  assert.equal((await ai.tool('list_requests', { open: true })).data.length, 2);
  assert.equal((await ai.tool('list_follow_ups', {})).data.length, 2);
  assert.equal((await ai.tool('list_decisions', {})).data.length, 2, 'the decision deleted earlier is made again from the note');
  const names = (await ai.rpc('tools/list')).result.tools.map((t) => t.name);
  assert.ok(!names.some((x) => /convert|delete/.test(x)));
  // follow-ups with a due date show on the calendar
  const cal = (await o.call('GET', '/calendar?from=2026-10-01&to=2026-10-31')).data;
  assert.ok(cal.deadlines.some((d) => d.kind === 'follow_up' && d.title === 'Call the client'));
  await app.close();
});

test('meeting brief: an AI gets the transcript and what the client already has open, then drafts for review', async () => {
  const app = await setUp();
  const o = app.owner;
  const c = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  await o.call('POST', '/requests', { clientId: c.id, title: 'Existing request' });
  await o.call('POST', '/follow-ups', { clientId: c.id, title: 'Existing follow-up' });
  const n = (await o.call('POST', '/meeting-notes', { title: 'Call', meetingDate: '2026-10-12', clientId: c.id, transcript: 'Dr. Lee: please add online booking.' })).data;
  const key = (await o.call('POST', '/api-keys', { name: 'brief', access: 'propose' })).data;
  const ai = mcp(app, key.token);
  const brief = (await ai.tool('get_meeting_brief', { noteId: n.id })).data;
  assert.equal(brief.note.transcript, 'Dr. Lee: please add online booking.');
  assert.deepEqual(brief.openRequests.map((r) => r.title), ['Existing request']);
  assert.deepEqual(brief.openFollowUps.map((r) => r.title), ['Existing follow-up']);
  assert.match(brief.howToUse, /cannot/);
  const proposal = await ai.tool('apply_changes', { summary: 'Process the call', steps: [
    { action: 'update_meeting_note', args: { id: n.id, summary: 'Client wants online booking', requests: '- Add online booking' } },
    { action: 'create_records_from_note', args: { noteId: n.id, kinds: ['requests'] } } ] });
  assert.equal(proposal.data.status, 'pending');
  assert.equal((await o.call('GET', `/meeting-notes/${n.id}`)).data.summary, '', 'nothing changes until a person approves');
  assert.equal((await o.call('POST', `/ai/proposals/${proposal.data.proposalId}/approve`, {})).status, 200);
  const after = (await o.call('GET', `/meeting-notes/${n.id}`)).data;
  assert.deepEqual([after.summary, after.aiDrafted, after.status], ['Client wants online booking', true, 'draft']);
  assert.equal((await o.call('GET', '/requests')).data.length, 2);
  await app.close();
});
