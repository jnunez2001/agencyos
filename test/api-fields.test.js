// Joshua Nunez
// The brief fields over HTTP and MCP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { rpc, async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}
const ok = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };

test('brief fields over HTTP: notes, decisions, requests and follow-up links', async () => {
  const app = await setUp();
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const c = ok(await o.call('POST', '/clients', { name: 'Acme' }), 'client');
  const p = ok(await o.call('POST', '/projects', { clientId: c.id, name: 'Site' }), 'project');
  const task = ok(await o.call('POST', '/tasks', { projectId: p.id, title: 'Build' }), 'task');
  const note = ok(await mark.call('POST', '/meeting-notes', { title: 'Kickoff', meetingDate: '2026-10-12', purpose: 'Scope', risks: 'Time', importantContext: 'Email only', sopImpact: 'Launch SOP', nextMeeting: 'Oct 19' }), 'note');
  assert.deepEqual([note.purpose, note.risks, note.importantContext, note.sopImpact, note.nextMeeting], ['Scope', 'Time', 'Email only', 'Launch SOP', 'Oct 19']);
  assert.equal(ok(await mark.call('PATCH', `/meeting-notes/${note.id}`, { risks: 'Less time' }), 'patch').risks, 'Less time');
  assert.equal('risks' in ok(await mark.call('GET', '/meeting-notes'), 'list')[0], false);
  const d = ok(await mark.call('POST', '/decisions', { title: 'Use WP', decidedOn: '2026-10-12', peopleInvolved: 'Dr. Lee' }), 'decision');
  assert.equal(d.peopleInvolved, 'Dr. Lee');
  const r = ok(await mark.call('POST', '/requests', { clientId: c.id, title: 'Booking', priority: 'high', source: 'Email', receivedOn: '2026-10-10' }), 'request');
  assert.deepEqual([r.priority, r.source, r.receivedOn], ['high', 'Email', '2026-10-10']);
  assert.equal((await mark.call('POST', '/requests', { clientId: c.id, title: 'Bad', priority: 'huge' })).status, 400);
  assert.equal(ok(await mark.call('GET', '/requests?priority=high'), 'filter').length, 1);
  const f = ok(await mark.call('POST', '/follow-ups', { title: 'Check', priority: 'urgent', requestId: r.id, taskId: task.id }), 'follow-up');
  assert.deepEqual([f.priority, f.requestTitle, f.taskTitle, f.clientId], ['urgent', 'Booking', 'Build', c.id]);
  const other = ok(await o.call('POST', '/clients', { name: 'Beta' }), 'other client');
  assert.equal((await mark.call('POST', '/follow-ups', { title: 'Mismatch', clientId: other.id, requestId: r.id })).status, 400);
  assert.equal((await mark.call('POST', '/follow-ups', { title: 'Missing', requestId: 9999 })).status, 404);
  assert.equal(ok(await mark.call('GET', `/follow-ups?requestId=${r.id}`), 'by request').length, 1);
  await app.close();
});

test('brief fields over MCP: direct key writes them, the plan can point at an earlier step', async () => {
  const app = await setUp();
  const o = app.owner;
  const c = ok(await o.call('POST', '/clients', { name: 'Acme' }), 'client');
  const key = ok(await o.call('POST', '/api-keys', { name: 'direct', access: 'direct' }), 'key');
  const ai = mcp(app, key.token);
  const tools = (await ai.rpc('tools/list')).result.tools;
  const schema = (n) => tools.find((t) => t.name === n).inputSchema.properties;
  assert.ok(schema('create_meeting_note').risks && schema('create_request').priority && schema('create_decision').peopleInvolved && schema('create_follow_up').requestId);
  const out = await ai.tool('apply_changes', { summary: 'Capture a call', steps: [
    { action: 'create_request', as: 'req', args: { clientId: c.id, title: 'Add booking', priority: 'urgent', source: 'Client call' } },
    { action: 'create_follow_up', args: { title: 'Quote it', priority: 'high', requestId: '$req' } },
    { action: 'create_decision', args: { title: 'Use WP', decidedOn: '2026-10-12', peopleInvolved: 'Dr. Lee' } },
    { action: 'create_meeting_note', args: { title: 'Call', meetingDate: '2026-10-12', purpose: 'Scope', nextMeeting: 'Oct 19' } },
  ] });
  assert.equal(out.data.status, 'applied', JSON.stringify(out.data));
  const fu = ok(await o.call('GET', '/follow-ups'), 'follow-ups')[0];
  assert.deepEqual([fu.priority, fu.requestTitle], ['high', 'Add booking']);
  assert.equal(ok(await o.call('GET', '/requests'), 'requests')[0].priority, 'urgent');
  assert.equal(ok(await o.call('GET', '/decisions'), 'decisions')[0].peopleInvolved, 'Dr. Lee');
  assert.equal(ok(await o.call('GET', '/meeting-notes'), 'notes').length, 1);
  assert.equal((await ai.tool('list_follow_ups', { requestId: fu.requestId })).data.length, 1);
  await app.close();
});
