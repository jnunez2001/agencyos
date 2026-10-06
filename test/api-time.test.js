// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { rpc, async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}

async function world() {
  const app = await setUp();
  const o = app.owner;
  const sess = {};
  for (const n of ['rayne', 'mark', 'sarah', 'cole']) { sess[n] = app.client(); await sess[n].signIn(n); }
  const c = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  const p = (await o.call('POST', '/projects', { clientId: c.id, name: 'Site' })).data;
  const sarahTask = (await o.call('POST', '/tasks', { projectId: p.id, title: 'Copy', assigneeId: 4, estimateHours: 5 })).data;
  const coleTask = (await o.call('POST', '/tasks', { projectId: p.id, title: 'Logo', assigneeId: 5 })).data;
  return { app, o, ...sess, c, p, sarahTask, coleTask };
}

test('time over HTTP: log, submit, review and lock with permissions and the session flags', async () => {
  const w = await world();
  const { o, mark, sarah, cole } = w;
  const e = await sarah.call('POST', '/time-entries', { taskId: w.sarahTask.id, minutes: 90, date: '2026-10-12', description: 'Copy' });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.clientName, 'Acme');
  assert.equal((await sarah.call('POST', '/time-entries', { minutes: 5, timeType: 'billable' })).status, 400);
  assert.equal((await cole.call('POST', '/time-entries', { minutes: 30, clientId: w.c.id })).status, 400);
  assert.equal((await cole.call('POST', '/time-entries', { minutes: 30, taskId: w.sarahTask.id })).status, 404);
  assert.equal((await cole.call('POST', '/time-entries', { minutes: 30, taskId: w.coleTask.id })).status, 200);
  assert.equal((await cole.call('GET', `/time-entries/${e.data.id}`)).status, 404);
  assert.equal((await sarah.call('GET', '/time-entries')).data.length, 1);
  assert.equal((await mark.call('GET', '/time-entries')).data.length, 2);
  assert.equal((await mark.call('PATCH', `/time-entries/${e.data.id}`, { minutes: 5 })).status, 403);
  assert.equal((await sarah.call('PATCH', `/time-entries/${e.data.id}`, { minutes: 60 })).data.minutes, 60);
  assert.equal((await sarah.call('POST', '/time-entries/submit', { from: '2026-10-12', to: '2026-10-18' })).data.submitted, 1);
  assert.equal((await sarah.call('POST', '/time-entries/submit', { from: '2026-10-12', to: '2026-10-18' })).status, 400);
  assert.equal((await sarah.call('POST', `/time-entries/${e.data.id}/approve`, {})).status, 403);
  assert.equal((await mark.call('POST', `/time-entries/${e.data.id}/reject`, {})).status, 400);
  assert.equal((await mark.call('POST', `/time-entries/${e.data.id}/reject`, { note: 'Add detail' })).data.status, 'rejected');
  assert.equal((await sarah.call('POST', '/time-entries/submit', { ids: [e.data.id] })).data.submitted, 1);
  assert.equal((await mark.call('POST', `/time-entries/${e.data.id}/lock`, {})).status, 409);
  assert.equal((await mark.call('POST', `/time-entries/${e.data.id}/approve`, { note: 'ok' })).data.status, 'approved');
  assert.equal((await sarah.call('DELETE', `/time-entries/${e.data.id}`)).status, 403);
  assert.equal((await mark.call('POST', `/time-entries/${e.data.id}/lock`, {})).data.status, 'locked');
  assert.equal((await o.call('GET', `/tasks/${w.sarahTask.id}`)).data.loggedHours, 1);
  assert.equal((await o.call('GET', '/time-entries?status=locked')).data.length, 1);
  const s = (await sarah.call('GET', '/session')).data.can;
  assert.deepEqual([s['time.log'], s['time.review'], s['time.view_team'], s['retainers.view'], s['retainers.manage']], [true, false, false, true, false]);
  const cs = (await cole.call('GET', '/session')).data.can;
  assert.deepEqual([cs['time.log'], cs['retainers.view']], [true, false]);
  assert.equal((await mark.call('GET', '/session')).data.can['time.review'], true);
  await w.app.close();
});

test('the timer over HTTP', async () => {
  const w = await world();
  const { sarah } = w;
  assert.equal((await sarah.call('GET', '/time/timer')).data, null);
  const t = await sarah.call('POST', '/time/timer/start', { taskId: w.sarahTask.id, description: 'Working' });
  assert.equal(t.data.timerState, 'running');
  assert.equal((await sarah.call('POST', '/time/timer/start', {})).status, 409);
  assert.equal((await sarah.call('POST', '/time/timer/pause')).data.timerState, 'paused');
  assert.equal((await sarah.call('POST', '/time/timer/resume')).data.timerState, 'running');
  assert.equal((await sarah.call('GET', '/time/timer')).data.id, t.data.id);
  const done = (await sarah.call('POST', '/time/timer/stop')).data;
  assert.deepEqual([done.timerState, done.minutes], ['none', 1]);
  assert.equal((await sarah.call('POST', '/time/timer/stop')).status, 409);
  await w.app.close();
});

test('capacity and retainers over HTTP', async () => {
  const w = await world();
  const { o, mark, sarah, cole } = w;
  const cap = await mark.call('GET', '/capacity?weekStart=2026-10-12&weeks=2');
  assert.equal(cap.data.weeks.length, 2);
  assert.ok(cap.data.weeks[0].people.length >= 5);
  assert.equal((await sarah.call('GET', '/capacity')).data.weeks[0].people.length, 1);
  assert.equal((await mark.call('GET', '/capacity?weeks=20')).status, 400);
  assert.equal((await sarah.call('PUT', `/clients/${w.c.id}/retainer`, { hoursAllocated: 10 })).status, 403);
  const made = await mark.call('PUT', `/clients/${w.c.id}/retainer`, { hoursAllocated: 10, startDate: '2026-10-01' });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal((await sarah.call('GET', `/clients/${w.c.id}/retainer`)).data.retainer.hoursAllocated, 10);
  assert.equal((await cole.call('GET', `/clients/${w.c.id}/retainer`)).status, 403);
  const e = (await sarah.call('POST', '/time-entries', { taskId: w.sarahTask.id, minutes: 540, date: '2026-10-05' })).data;
  await sarah.call('POST', '/time-entries/submit', { ids: [e.id] });
  assert.equal((await mark.call('GET', '/retainers')).data[0].pendingHours, 9);
  await mark.call('POST', `/time-entries/${e.id}/approve`, {});
  const u = (await mark.call('GET', '/retainers')).data[0];
  assert.deepEqual([u.clientName, u.percent, u.level], ['Acme', 90, 'warning']);
  assert.equal((await o.call('GET', '/dashboard')).data.capacity.weeks === undefined, true);
  await w.app.close();
});

test('AI reads time, capacity and retainers, logs draft time, and can never submit, approve, reject or lock', async () => {
  const w = await world();
  const { o, mark, sarah } = w;
  const key = (await sarah.call('POST', '/api-keys', { name: 'sarah ai', access: 'direct' })).data;
  const ai = mcp(w.app, key.token);
  const names = (await ai.rpc('tools/list')).result.tools.map((t) => t.name);
  for (const n of ['list_time_entries', 'get_workload_capacity', 'get_retainer_usage', 'log_time', 'update_time_entry']) assert.ok(names.includes(n), n);
  for (const bad of ['approve_time', 'reject_time', 'lock_time', 'submit_time', 'delete_time_entry', 'start_timer']) assert.ok(!names.includes(bad), bad);
  const made = await ai.tool('log_time', { taskId: w.sarahTask.id, minutes: 45, date: '2026-10-12', description: 'Drafted by AI' });
  assert.equal(made.data.status, 'applied', JSON.stringify(made.data));
  const id = made.data.results[0].id;
  const listed = (await ai.tool('list_time_entries', { from: '2026-10-01', to: '2026-10-31' })).data;
  assert.deepEqual([listed.length, listed[0].status, listed[0].userName], [1, 'draft', 'Sarah']);
  assert.equal((await ai.tool('update_time_entry', { id, minutes: 50 })).data.status, 'applied');
  for (const status of ['submitted', 'approved', 'rejected', 'locked']) {
    const r = await ai.tool('update_time_entry', { id, status });
    assert.equal(r.isError, true);
    assert.match(String(r.data), /AI cannot submit, approve, reject or lock/);
  }
  assert.equal((await ai.tool('log_time', { minutes: 5, status: 'approved', timeType: 'internal' })).isError, true);
  // through the plan runner too, with a manager's key
  const mkey = (await mark.call('POST', '/api-keys', { name: 'mark ai', access: 'direct' })).data;
  const mai = mcp(w.app, mkey.token);
  await sarah.call('POST', '/time-entries/submit', { ids: [id] });
  const bad = await mai.tool('apply_changes', { summary: 'Approve', steps: [{ action: 'approve_time', args: { id } }] });
  assert.equal(bad.isError, true);
  assert.equal((await mark.call('GET', `/time-entries/${id}`)).data.status, 'submitted');
  assert.equal((await mai.tool('get_workload_capacity', { weekStart: '2026-10-12' })).data.weeks[0].people.length >= 5, true);
  assert.equal((await ai.tool('get_workload_capacity', {})).data.weeks[0].people.length, 1);
  await mark.call('PUT', `/clients/${w.c.id}/retainer`, { hoursAllocated: 5, startDate: '2026-10-01' });
  assert.equal((await mai.tool('get_retainer_usage', {})).data.length, 1);
  assert.equal((await ai.tool('get_retainer_usage', { clientId: w.c.id })).data[0].allocatedHours, 5);
  // a key that asks first holds the plan in the inbox
  const pkey = (await sarah.call('POST', '/api-keys', { name: 'ask', access: 'propose' })).data;
  const pending = await mcp(w.app, pkey.token).tool('log_time', { minutes: 20, timeType: 'internal', description: 'Admin chores' });
  assert.equal(pending.data.status, 'pending');
  assert.match(pending.data.lines[0], /Log 20 minutes: Admin chores/);
  const approve = await sarah.call('POST', `/ai/proposals/${pending.data.proposalId}/approve`, {});
  assert.equal(approve.data.status, 'approved', JSON.stringify(approve.data));
  assert.equal((await sarah.call('GET', '/time-entries')).data.length, 2);
  const log = (await o.call('GET', '/activity?action=time.create')).data;
  assert.ok(log.some((x) => x.source === 'ai'));
  await w.app.close();
});
