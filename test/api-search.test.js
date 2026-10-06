// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}

test('search over HTTP follows each role and needs a signed-in person', async () => {
  const app = await setUp();
  const o = app.owner;
  const cole = app.client(); await cole.signIn('cole');
  const sarah = app.client(); await sarah.signIn('sarah');
  const c = (await o.call('POST', '/clients', { name: 'Zebra Dental' })).data;
  const p = (await o.call('POST', '/projects', { clientId: c.id, name: 'Zebra site' })).data;
  const t = (await o.call('POST', '/tasks', { projectId: p.id, title: 'Zebra copy', assigneeId: 5 })).data;
  await o.call('POST', '/tasks', { projectId: p.id, title: 'Zebra logo', assigneeId: 4 });
  const mine = await o.call('GET', '/search?q=zebra');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data.groups.map((g) => g.type), ['client', 'project', 'task']);
  assert.equal(mine.data.groups[2].results.length, 2);
  assert.equal(mine.data.groups[0].results[0].hash, `#/clients/${c.id}`);
  const theirs = (await cole.call('GET', '/search?q=zebra')).data;
  assert.deepEqual(theirs.groups.map((g) => g.type), ['task']);
  assert.equal(theirs.groups[0].results[0].id, t.id);
  assert.equal((await sarah.call('GET', '/search?q=zebra&limit=1')).data.groups[0].results.length, 1);
  assert.equal((await o.call('GET', '/search?q=z')).status, 400);
  assert.equal((await o.call('GET', '/search')).status, 400);
  assert.equal((await app.client().call('GET', '/search?q=zebra')).status, 401);
  await app.close();
});

test('AI can search with a read key and sees only what its owner may see', async () => {
  const app = await setUp();
  const o = app.owner;
  await o.call('POST', '/clients', { name: 'Zebra Dental' });
  const key = (await o.call('POST', '/api-keys', { name: 'finder', access: 'read' })).data;
  const ai = mcp(app, key.token);
  const found = await ai.tool('search_agency', { q: 'zebra' });
  assert.equal(found.isError, false);
  assert.equal(found.data.groups[0].results[0].title, 'Zebra Dental');
  assert.equal((await ai.tool('search_agency', { q: 'z' })).isError, true);
  const cole = app.client(); await cole.signIn('cole');
  const ckey = (await cole.call('POST', '/api-keys', { name: 'cole ai', access: 'read' })).data;
  assert.deepEqual((await mcp(app, ckey.token).tool('search_agency', { q: 'zebra' })).data.groups, []);
  await app.close();
});
