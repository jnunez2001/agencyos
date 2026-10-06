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
  assert.deepEqual(read, ['list_clients', 'get_client', 'list_projects', 'get_project', 'list_tasks', 'get_task', 'list_events', 'get_event', 'list_meeting_notes', 'get_meeting_note', 'list_requests', 'get_request', 'list_decisions', 'list_follow_ups', 'list_team', 'get_workload', 'list_sops', 'get_sop', 'list_services', 'list_goals', 'get_metrics', 'list_results', 'get_report_data', 'list_reports', 'get_report', 'list_qa_queue', 'list_time_entries', 'get_workload_capacity', 'get_retainer_usage']);
  const propose = await names('propose');
  assert.deepEqual(propose.slice(0, read.length), read);
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

test('SOP and QA tools: read for every key, drafting through plans, reviewing never', async () => {
  const app = await setUp();
  const direct = mcp(app, (await withKey(app, 'direct', 'd')).token);
  const r = await direct.tool('create_sop', { title: 'Page Optimization', service: 'SEO', status: 'testing', requiresQa: true, steps: ['Research', 'Write'], checklist: ['Title ok'] });
  assert.equal(r.data.status, 'applied');
  const read = mcp(app, (await withKey(app, 'read', 'r')).token);
  const list = (await read.tool('list_sops')).data;
  assert.deepEqual([list.length, list[0].title, list[0].status, list[0].version], [1, 'Page Optimization', 'testing', '1.0']);
  assert.deepEqual((await read.tool('get_sop', { id: list[0].id })).data.content.checklist, ['Title ok']);
  assert.equal((await read.tool('list_sops', { q: 'nothing' })).data.length, 0);
  assert.deepEqual((await read.tool('list_qa_queue')).data, []);
  // a person approves, then the AI starts work from it
  assert.equal((await app.owner.call('PATCH', `/sops/${list[0].id}`, { status: 'approved' })).data.status, 'approved');
  const client = (await direct.tool('create_client', { name: 'Acme' })).data;
  assert.equal(client.status, 'applied');
  const proj = (await app.owner.call('POST', '/projects', { clientId: (await app.owner.call('GET', '/clients')).data[0].id, name: 'Site' })).data;
  const made = await direct.tool('create_tasks_from_sop', { sopId: list[0].id, projectId: proj.id, mode: 'steps' });
  assert.equal(made.data.status, 'applied');
  assert.equal((await read.tool('list_tasks')).data.length, 2);
  // an AI cannot approve an SOP or review work
  assert.equal((await direct.tool('apply_changes', { summary: 's', steps: [{ action: 'update_sop', args: { id: list[0].id, status: 'deprecated' } }] })).data.status, 'applied');
  const bad = await direct.tool('apply_changes', { summary: 's', steps: [{ action: 'update_sop', args: { id: list[0].id, status: 'approved' } }] });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /person/i);
  assert.equal((await direct.tool('review_task', { id: 1 })).isError, true);
  await app.close();
});

test('service and goal tools: read for every key, goals through plans', async () => {
  const app = await setUp();
  await app.owner.call('POST', '/services', { name: 'SEO' });
  const direct = mcp(app, (await withKey(app, 'direct', 'd')).token);
  const read = mcp(app, (await withKey(app, 'read', 'r')).token);
  const services = (await read.tool('list_services')).data;
  assert.deepEqual(services.map((s) => s.name), ['SEO']);
  assert.equal((await direct.tool('create_client', { name: 'Acme', status: 'lead', serviceIds: [services[0].id] })).data.status, 'applied');
  const client = (await read.tool('list_clients')).data[0];
  assert.deepEqual([client.status, client.services[0].name], ['lead', 'SEO']);
  const made = await direct.tool('create_goal', { clientId: client.id, title: 'Increase leads', serviceId: services[0].id });
  assert.equal(made.data.status, 'applied');
  const goals = (await read.tool('list_goals', { clientId: client.id })).data;
  assert.deepEqual([goals[0].title, goals[0].serviceName, goals[0].status], ['Increase leads', 'SEO', 'active']);
  assert.equal((await read.tool('get_client', { id: client.id })).data.goals.length, 1);
  assert.equal((await read.tool('create_goal', { clientId: client.id, title: 'x' })).isError, true);
  await app.close();
});

test('result and report tools: read for every key, drafting through plans, never approving', async () => {
  const app = await setUp();
  const direct = mcp(app, (await withKey(app, 'direct', 'd')).token);
  const read = mcp(app, (await withKey(app, 'read', 'r')).token);
  assert.equal((await direct.tool('create_client', { name: 'Acme' })).data.status, 'applied');
  const client = (await read.tool('list_clients')).data[0];
  for (const [value, recordedOn] of [[40, '2026-08-31'], [55, '2026-09-30']]) assert.equal((await direct.tool('record_result', { clientId: client.id, metric: 'Organic leads', value, unit: 'leads', recordedOn })).data.status, 'applied');
  const metrics = (await read.tool('get_metrics', { clientId: client.id })).data;
  assert.deepEqual([metrics[0].metric, metrics[0].latest.value, metrics[0].change], ['Organic leads', 55, 15]);
  assert.equal((await read.tool('list_results', { clientId: client.id, metric: 'organic leads' })).data.length, 2);
  const facts = (await read.tool('get_report_data', { clientId: client.id, from: '2026-09-01', to: '2026-09-30' })).data;
  assert.deepEqual([facts.client.name, facts.results[0].change, facts.completedTasks.length], ['Acme', 15, 0]);
  assert.equal((await read.tool('get_report_data', { clientId: client.id, from: '2026-09-01' })).isError, true);
  assert.equal((await direct.tool('generate_report', { clientId: client.id, periodStart: '2026-09-01', periodEnd: '2026-09-30' })).data.status, 'applied');
  const list = (await read.tool('list_reports')).data;
  assert.deepEqual([list.length, list[0].status], [1, 'draft']);
  const created = await direct.tool('create_report', { clientId: client.id, title: 'Written by AI', periodStart: '2026-09-01', periodEnd: '2026-09-30', executiveSummary: 'Strong month.', recommendations: 'Keep going.' });
  assert.equal(created.data.status, 'applied');
  const mine = (await read.tool('list_reports', { status: 'draft' })).data.find((r) => r.title === 'Written by AI');
  assert.equal((await read.tool('get_report', { id: mine.id })).data.sections.executiveSummary, 'Strong month.');
  assert.equal((await read.tool('record_result', { clientId: client.id, metric: 'x', value: 1 })).isError, true);
  assert.equal((await direct.tool('approve_report', { id: mine.id })).isError, true);
  assert.equal((await app.owner.call('POST', `/reports/${mine.id}/approve`, {})).data.status, 'approved'); // a person can
  await app.close();
});
