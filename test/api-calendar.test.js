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
