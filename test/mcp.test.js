// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

// A tiny MCP client: JSON-RPC over POST with a Bearer key.
function mcp(app, token) {
  let id = 0;
  const post = async (body, headers = {}) => {
    const res = await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const rpc = async (method, params) => (await post({ jsonrpc: '2.0', id: ++id, method, params })).data;
  const tool = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.result.content[0].text;
    let data = text;
    try { data = JSON.parse(text); } catch { /* plain message */ }
    return { isError: !!r.result.isError, data, text };
  };
  return { post, rpc, tool };
}

async function withKey(app, access, name = 'test') {
  const r = await app.owner.call('POST', '/api-keys', { name, access });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

test('the endpoint needs a valid key', async () => {
  const app = await setUp();
  assert.equal((await mcp(app, null).post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  assert.equal((await mcp(app, 'aos_' + 'x'.repeat(32)).post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  assert.equal((await mcp(app, 'not a key').post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  const res = await fetch(app.base.replace('/api', '/mcp'));
  assert.equal(res.status, 405);
  await app.close();
});

test('a revoked key stops working at once', async () => {
  const app = await setUp();
  const key = await withKey(app, 'read');
  const c = mcp(app, key.token);
  assert.equal((await c.post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200);
  assert.equal((await app.owner.call('DELETE', `/api-keys/${key.id}`)).status, 200);
  assert.equal((await c.post({ jsonrpc: '2.0', id: 2, method: 'ping' })).status, 401);
  await app.close();
});

test('initialize, notifications, ping and unknown methods follow the protocol', async () => {
  const app = await setUp();
  const c = mcp(app, (await withKey(app, 'read')).token);
  const init = await c.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.jsonrpc, '2.0');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(init.result.serverInfo.name, 'agencyos');
  assert.equal((await c.rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18');
  const note = await c.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.deepEqual((await c.rpc('ping')).result, {});
  assert.equal((await c.rpc('no/such/method')).error.code, -32601);
  assert.equal((await c.post({ not: 'jsonrpc' })).data.error.code, -32600);
  await app.close();
});

test('tools/list shows write tools only to keys that can write', async () => {
  const app = await setUp();
  const names = async (access) => (await mcp(app, (await withKey(app, access, access)).token).rpc('tools/list')).result.tools.map((t) => t.name);
  const read = await names('read');
  assert.deepEqual(read, ['list_clients', 'get_client', 'list_projects', 'get_project', 'list_tasks', 'get_task', 'list_team', 'get_workload']);
  const propose = await names('propose');
  assert.deepEqual(propose.slice(0, 8), read);
  assert.ok(['apply_changes', 'create_client', 'create_project', 'create_task', 'update_task', 'add_comment'].every((n) => propose.includes(n)));
  const tools = (await mcp(app, (await withKey(app, 'read')).token).rpc('tools/list')).result.tools;
  assert.ok(tools.every((t) => t.description && t.inputSchema && t.inputSchema.type === 'object'));
  await app.close();
});

test('direct key: tools create real records, read tools see them, and the log says AI', async () => {
  const app = await setUp();
  const c = mcp(app, (await withKey(app, 'direct')).token);
  const plan = await c.tool('apply_changes', { summary: 'Set up Acme', steps: [
    { action: 'create_client', as: 'a', args: { name: 'Acme Dental' } },
    { action: 'create_project', as: 'p', args: { clientId: '$a', name: 'New website' } },
    { action: 'create_task', args: { projectId: '$p', title: 'Homepage copy', assigneeId: 4, dueDate: '2030-01-05' } },
  ] });
  assert.equal(plan.isError, false);
  assert.equal(plan.data.status, 'applied');
  const clients = (await c.tool('list_clients')).data;
  assert.equal(clients[0].name, 'Acme Dental');
  assert.equal((await c.tool('get_client', { id: clients[0].id })).data.projects.length, 1);
  const tasks = (await c.tool('list_tasks', { status: 'todo' })).data;
  assert.equal(tasks[0].title, 'Homepage copy');
  const one = (await c.tool('get_task', { id: tasks[0].id })).data;
  assert.deepEqual([one.title, Array.isArray(one.comments)], ['Homepage copy', true]);
  assert.equal((await c.tool('update_task', { id: tasks[0].id, status: 'in_progress' })).data.status, 'applied');
  assert.equal((await c.tool('add_comment', { taskId: tasks[0].id, body: 'hi' })).data.status, 'applied');
  assert.equal((await c.tool('create_task', { projectId: (await c.tool('list_projects')).data[0].id, title: 'Another' })).data.status, 'applied');
  const team = (await c.tool('list_team')).data;
  assert.equal(team.length, 5);
  assert.ok(team.every((m) => !('mustChangePassword' in m) && !('canManage' in m)));
  assert.ok(Array.isArray((await c.tool('get_workload')).data.workload));
  const activity = (await app.owner.call('GET', '/activity?limit=100')).data;
  assert.ok(activity.some((a) => a.action === 'task.create' && a.source === 'ai'));
  await app.close();
});

test('propose key: changes wait in the inbox, and approving applies them', async () => {
  const app = await setUp();
  const c = mcp(app, (await withKey(app, 'propose')).token);
  const r = await c.tool('create_client', { name: 'Acme Dental', industry: 'Dental' });
  assert.equal(r.data.status, 'pending');
  assert.ok(r.data.proposalId);
  assert.deepEqual(r.data.lines, ['Create client "Acme Dental"']);
  assert.deepEqual((await c.tool('list_clients')).data, []);
  assert.equal((await app.owner.call('GET', '/dashboard')).data.aiPending, 1);
  const inbox = (await app.owner.call('GET', '/ai/proposals?status=pending')).data;
  assert.equal(inbox.length, 1);
  assert.equal((await app.owner.call('POST', `/ai/proposals/${inbox[0].id}/approve`, {})).data.status, 'approved');
  assert.equal((await c.tool('list_clients')).data[0].name, 'Acme Dental');
  assert.equal((await app.owner.call('GET', '/dashboard')).data.aiPending, 0);
  // reject path
  const r2 = await c.tool('create_client', { name: 'Beta' });
  assert.equal((await app.owner.call('POST', `/ai/proposals/${r2.data.proposalId}/reject`, {})).data.status, 'rejected');
  assert.equal((await c.tool('list_clients')).data.length, 1);
  await app.close();
});

test('mistakes come back as tool errors, not broken connections', async () => {
  const app = await setUp();
  const read = mcp(app, (await withKey(app, 'read')).token);
  const w = await read.tool('create_client', { name: 'X' });
  assert.equal(w.isError, true);
  assert.match(w.text, /unknown tool|only read/i);
  const direct = mcp(app, (await withKey(app, 'direct')).token);
  const bad = await direct.tool('create_task', { projectId: 999, title: 'x' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Step 1.*not found/i);
  assert.equal((await direct.tool('no_such_tool')).isError, true);
  assert.equal((await direct.tool('get_client', { id: 'abc' })).isError, true);
  assert.equal((await direct.rpc('tools/call', { arguments: {} })).result.isError, true);
  await app.close();
});

test('a key is limited to 120 calls a minute', async () => {
  const app = await setUp();
  const c = mcp(app, (await withKey(app, 'read')).token);
  let limited = 0;
  for (let i = 0; i < 130; i++) if ((await c.post({ jsonrpc: '2.0', id: i, method: 'ping' })).status === 429) limited += 1;
  assert.equal(limited, 10);
  await app.close();
});

test('everyone makes personal keys and sees only their own; Owner and Admin see all', async () => {
  const app = await setUp();
  const sarah = app.client();
  await sarah.signIn('sarah');
  const mine = (await sarah.call('POST', '/api-keys', { name: 'sarah agent', access: 'read' })).data;
  assert.equal(mine.access, 'read');
  const ownerKey = await withKey(app, 'read', 'owner key');
  assert.deepEqual((await sarah.call('GET', '/api-keys')).data.map((k) => k.name), ['sarah agent']);
  assert.equal((await sarah.call('DELETE', `/api-keys/${ownerKey.id}`)).status, 404);
  assert.equal((await sarah.call('GET', '/ai/proposals')).status, 200);
  assert.equal((await sarah.call('GET', '/dashboard')).data.aiPending, 0);
  const all = (await app.owner.call('GET', '/api-keys')).data;
  assert.deepEqual(all.map((k) => k.name).sort(), ['owner key', 'sarah agent']);
  assert.ok(!JSON.stringify(all).includes(ownerKey.token));
  assert.equal((await app.owner.call('PATCH', `/api-keys/${ownerKey.id}`, { access: 'propose' })).data.access, 'propose');
  // her key works as her: what an Employee may not see is a tool error, not a crash
  const c = mcp(app, mine.token);
  assert.equal((await c.tool('get_workload')).isError, true);
  assert.equal((await c.tool('list_team')).data.length, 5);
  assert.equal((await mcp(app, null).post({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  await app.close();
});
