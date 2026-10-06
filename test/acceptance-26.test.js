// Joshua Nunez
// The end-to-end acceptance workflow from the final audit brief, step by step (steps 1 to 26), over HTTP and MCP.
// A failure names the step that broke.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { rpc, async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}
const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

test('the 26 step acceptance workflow', async () => {
  const app = await setUp();
  const owner = app.owner;
  const who = {};
  for (const n of ['rayne', 'mark', 'sarah', 'cole']) { who[n] = app.client(); await who[n].signIn(n); }
  const { mark, sarah } = who;
  const ids = { rayne: 2, mark: 3, sarah: 4, cole: 5 };
  const ok = (r, step) => { assert.equal(r.status, 200, `${step}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; };

  const client = ok(await owner.call('POST', '/clients', { name: 'ABC Company', status: 'active' }), 'Step 1 create client');
  const project = ok(await owner.call('POST', '/projects', { clientId: client.id, name: 'SEO growth' }), 'Step 2 create project');
  ok(await mark.call('PUT', `/clients/${client.id}/retainer`, { hoursAllocated: 10, startDate: `${day().slice(0, 7)}-01` }), 'retainer setup');

  const meeting = ok(await mark.call('POST', '/events', { title: 'Strategy call', type: 'client_meeting', startsAt: `${day(1)}T14:00:00Z`, endsAt: `${day(1)}T15:00:00Z`, projectId: project.id, attendees: [ids.sarah, ids.mark] }), 'Step 3 client meeting');
  const note = ok(await mark.call('POST', '/meeting-notes', { eventId: meeting.id, purpose: 'Plan the quarter', discussion: 'Leads are down', risks: 'Seasonality', sopImpact: 'Page optimization needs a speed check' }), 'Step 4 meeting notes');
  assert.equal(note.eventId, meeting.id);
  const decision = ok(await mark.call('POST', '/decisions', { title: 'Focus on service pages first', details: 'Highest intent traffic', decidedOn: day(), clientId: client.id, projectId: project.id }), 'Step 5 decision');
  const request = ok(await mark.call('POST', '/requests', { clientId: client.id, projectId: project.id, title: 'Add a pricing page', source: 'Strategy call', priority: 'high' }), 'Step 6 client request');
  const follow = ok(await mark.call('POST', '/follow-ups', { title: 'Send the content plan', clientId: client.id, assigneeId: ids.mark, dueDate: day(2), priority: 'normal' }), 'Step 7 follow-up');

  const conv = ok(await mark.call('POST', `/requests/${request.id}/convert`, { projectId: project.id, assigneeId: ids.sarah, dueDate: day(), priority: 'high' }), 'Step 8 convert request to task');
  const task = conv.task;
  assert.equal(conv.request.taskId, task.id, 'Step 8: the link is kept');
  assert.equal(task.assigneeId, ids.sarah, 'Step 9 assign task to employee');
  ok(await mark.call('PATCH', `/tasks/${task.id}`, { qaRequired: true }), 'QA required on the task');

  assert.ok(ok(await sarah.call('GET', '/workspace'), 'Step 10').myDay.tasks.some((t) => t.id === task.id), 'Step 10: the employee sees the task in My Day');

  assert.equal(ok(await sarah.call('POST', '/time/timer/start', { taskId: task.id }), 'Step 11 start timer').timerState, 'running');
  ok(await sarah.call('POST', '/time/timer/stop'), 'Step 12 stop timer');
  const entry = ok(await sarah.call('POST', '/time-entries', { taskId: task.id, minutes: 540, date: day(), description: 'Pricing page' }), 'Step 12 manual time');
  assert.equal(ok(await sarah.call('POST', '/time-entries/submit', { ids: [entry.id] }), 'Step 12 submit time').submitted, 1);

  assert.equal(ok(await sarah.call('PATCH', `/tasks/${task.id}`, { status: 'review' }), 'Step 13 task enters QA').status, 'review');
  assert.equal(ok(await mark.call('GET', '/qa'), 'Step 14 QA queue').length, 1);
  assert.equal(ok(await mark.call('POST', `/tasks/${task.id}/qa`, { result: 'approved', checklist: [] }), 'Step 14 QA review').status, 'done', 'Step 15: the task is completed');

  ok(await mark.call('POST', `/time-entries/${entry.id}/approve`, {}), 'Step 16 approve time');
  const usage = ok(await mark.call('GET', '/retainers'), 'Step 17 retainer usage')[0];
  assert.deepEqual([usage.clientName, usage.percent], ['ABC Company', 90], 'Step 17: usage updated from approved time');

  ok(await mark.call('POST', `/clients/${client.id}/results`, { metric: 'Organic leads', value: 42, unit: 'leads', recordedOn: day() }), 'Step 18 record result');
  const report = ok(await mark.call('POST', `/clients/${client.id}/reports/generate`, { periodStart: `${day().slice(0, 7)}-01`, periodEnd: day() }), 'Step 19 generate report');
  assert.ok(report.id);

  const sop = ok(await owner.call('POST', '/sops', { title: 'Page Optimization', status: 'approved', steps: ['Research', 'Write'], purpose: 'Rank pages' }), 'SOP exists');
  const change = ok(await sarah.call('POST', '/sop-changes', { sopId: sop.id, title: 'Add a page speed check', details: 'The pricing page was slow (Step 20)', proposedContent: { steps: ['Research', 'Write', 'Check speed'] } }), 'Step 20-21 SOP change request');
  ok(await mark.call('PATCH', `/sop-changes/${change.id}`, { status: 'approved' }), 'Step 22 approve change');
  assert.equal(ok(await mark.call('POST', `/sop-changes/${change.id}/publish`, { changeNote: 'Added a page speed check' }), 'Step 23 publish').publishedVersion, '1.1');
  assert.equal(ok(await owner.call('GET', `/sops/${sop.id}`), 'sop versions').versions.length, 2, 'Step 23: the old version is kept');

  const notified = ok(await sarah.call('GET', '/notifications'), 'Step 24 notifications');
  assert.ok(notified.some((n) => n.type === 'task_assigned' && n.link), 'Step 24: a linked notification was generated');

  const actions = new Set(ok(await owner.call('GET', '/activity?limit=200'), 'Step 25 audit').map((a) => a.action));
  for (const a of ['client.create', 'project.create', 'event.create', 'meeting_note.create', 'decision.create', 'request.create', 'followup.create', 'request.convert', 'time.approve', 'qa.approve', 'sopchange.publish']) assert.ok(actions.has(a), `Step 25: audit history has ${a}`);

  const key = ok(await owner.call('POST', '/api-keys', { name: 'assistant', access: 'read' }), 'key');
  const ai = mcp(app, key.token);
  const trace = (await ai.tool('trace_task', { taskId: task.id })).data;
  assert.ok(JSON.stringify(trace).includes('Add a pricing page'), 'Step 26: MCP traces the task back to the request');
  assert.ok((await ai.tool('list_meeting_notes', { clientId: client.id })).data.some((n) => n.id === note.id), 'Step 26: meeting notes');
  assert.ok((await ai.tool('list_decisions', { clientId: client.id })).data.some((d) => d.id === decision.id), 'Step 26: decisions');
  assert.ok((await ai.tool('list_requests', { clientId: client.id })).data.some((r) => r.id === request.id), 'Step 26: requests');
  assert.ok((await ai.tool('list_follow_ups', { clientId: client.id })).data.some((f) => f.id === follow.id), 'Step 26: follow-ups');
  assert.ok((await ai.tool('get_retainer_usage', {})).data, 'Step 26: retainer usage');
  assert.ok(JSON.stringify((await ai.tool('get_client_timeline', { clientId: client.id, days: 7 })).data).includes('Strategy call'), 'Step 26: client timeline');
  assert.ok((await ai.tool('get_workload_capacity', {})).data, 'Step 26: capacity');
  await app.close();
});
