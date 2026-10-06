// Joshua Nunez
// The roadmap's end-to-end story, over HTTP and MCP: one agency from a new client to approved time, with the
// permission limits checked along the way. If this passes, the pieces work together, not just alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { rpc, async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}

const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

test('from a new client to approved time: calendar, notes, records, tasks, time, retainer, SOP change, AI and permissions', async () => {
  const app = await setUp();
  const owner = app.owner;
  const who = {};
  for (const n of ['rayne', 'mark', 'sarah', 'cole']) { who[n] = app.client(); await who[n].signIn(n); }
  const { mark, sarah, cole } = who;
  const ids = { rayne: 2, mark: 3, sarah: 4, cole: 5 };
  const ok = (r, what) => { assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`); return r.data; };

  // 1. The Owner creates a client, a project and a monthly retainer
  const client = ok(await owner.call('POST', '/clients', { name: 'Acme Dental', status: 'active', accountOwnerId: ids.rayne }), 'client');
  const project = ok(await owner.call('POST', '/projects', { clientId: client.id, name: 'New website' }), 'project');
  ok(await mark.call('PUT', `/clients/${client.id}/retainer`, { hoursAllocated: 10, startDate: `${day().slice(0, 7)}-01` }), 'retainer');

  // 2. A manager schedules a client meeting with the team
  const meeting = ok(await mark.call('POST', '/events', { title: 'Kickoff call', type: 'client_meeting', startsAt: `${day(1)}T14:00:00Z`, endsAt: `${day(1)}T15:00:00Z`, projectId: project.id, attendees: [ids.sarah, ids.mark] }), 'event');
  assert.equal(meeting.clientName, 'Acme Dental');
  assert.ok(ok(await sarah.call('GET', '/notifications'), 'notifications').some((n) => n.type === 'event_invited'), 'an attendee is told');
  assert.equal(ok(await cole.call('GET', `/calendar?from=${day()}&to=${day(7)}`), 'cole calendar').events.length, 0, 'a contractor does not see it');

  // 3. An attendee writes the meeting notes with a transcript
  const note = ok(await sarah.call('POST', '/meeting-notes', { eventId: meeting.id, summary: 'Client wants online booking', decisions: '- Use WordPress', requests: '- Add online booking', followUps: '- Mark sends a quote', transcript: 'Dr. Lee: we need booking.' }), 'note');
  assert.equal((await sarah.call('PATCH', `/meeting-notes/${note.id}`, { status: 'final' })).status, 403, 'only a manager finalizes');

  // 4. A manager turns the notes into records; running it twice changes nothing
  const made = ok(await mark.call('POST', `/meeting-notes/${note.id}/records`, {}), 'records');
  assert.deepEqual([made.created.decisions.length, made.created.requests.length, made.created.followUps.length], [1, 1, 1]);
  assert.equal(ok(await mark.call('POST', `/meeting-notes/${note.id}/records`, {}), 'records again').created.decisions.length, 0);
  ok(await mark.call('PATCH', `/meeting-notes/${note.id}`, { status: 'final' }), 'finalize');

  // 5. The request becomes a task for Sarah, keeping its link; she is told
  const request = ok(await mark.call('GET', '/requests'), 'requests')[0];
  assert.equal((await sarah.call('POST', `/requests/${request.id}/convert`, {})).status, 403);
  const conv = ok(await mark.call('POST', `/requests/${request.id}/convert`, { projectId: project.id, assigneeId: ids.sarah, dueDate: day(), priority: 'high' }), 'convert');
  assert.equal(conv.request.taskId, conv.task.id);
  assert.ok(ok(await sarah.call('GET', '/notifications?unread=1'), 'unread').some((n) => n.type === 'task_assigned'));

  // 6. Sarah's home shows today's work; the manager's shows what needs a manager
  const myDay = ok(await sarah.call('GET', '/workspace'), 'workspace').myDay;
  assert.ok(myDay.tasks.some((t) => t.id === conv.task.id), 'the task is in My Day');
  const mw = ok(await mark.call('GET', '/workspace'), 'manager workspace');
  assert.ok(mw.manager && !mw.owner);
  assert.ok(ok(await owner.call('GET', '/workspace'), 'owner workspace').owner);

  // 7. Sarah tracks time: a timer, then a long manual entry, submitted for approval
  assert.equal(ok(await sarah.call('POST', '/time/timer/start', { taskId: conv.task.id }), 'timer start').timerState, 'running');
  ok(await sarah.call('POST', '/time/timer/stop'), 'timer stop');
  const entry = ok(await sarah.call('POST', '/time-entries', { taskId: conv.task.id, minutes: 540, date: day(), description: 'Booking form' }), 'time entry');
  assert.equal(ok(await sarah.call('POST', '/time-entries/submit', { ids: [entry.id] }), 'submit').submitted, 1);
  assert.equal((await sarah.call('POST', `/time-entries/${entry.id}/approve`, {})).status, 403, 'no one approves their own time here');

  // 8. A manager approves; the retainer warns and the task shows its logged hours
  ok(await mark.call('POST', `/time-entries/${entry.id}/approve`, {}), 'approve');
  const usage = ok(await mark.call('GET', '/retainers'), 'retainers')[0];
  assert.deepEqual([usage.clientName, usage.percent, usage.level], ['Acme Dental', 90, 'warning']);
  assert.equal(ok(await mark.call('GET', `/tasks/${conv.task.id}`), 'task').loggedHours >= 9, true);
  assert.ok(ok(await mark.call('GET', '/capacity'), 'capacity').weeks.length >= 1);

  // 9. A follow-up is finished by its assignee
  const follow = ok(await mark.call('GET', '/follow-ups'), 'follow-ups')[0];
  ok(await mark.call('PATCH', `/follow-ups/${follow.id}`, { assigneeId: ids.sarah }), 'assign follow-up');
  assert.equal(ok(await sarah.call('PATCH', `/follow-ups/${follow.id}`, { status: 'done' }), 'done').status, 'done');

  // 10. An SOP gets a change request; a manager approves and publishes a new version
  const sop = ok(await owner.call('POST', '/sops', { title: 'Page Optimization', status: 'approved', steps: ['Research'], purpose: 'Rank' }), 'sop');
  const change = ok(await sarah.call('POST', '/sop-changes', { sopId: sop.id, title: 'Add a check', details: 'Needs one', proposedContent: { steps: ['Research', 'Check'] } }), 'sop change');
  assert.equal((await sarah.call('PATCH', `/sop-changes/${change.id}`, { status: 'approved' })).status, 403);
  ok(await mark.call('PATCH', `/sop-changes/${change.id}`, { status: 'approved' }), 'approve change');
  assert.equal(ok(await mark.call('POST', `/sop-changes/${change.id}/publish`, { changeNote: 'Added a check' }), 'publish').publishedVersion, '1.1');
  assert.equal(ok(await owner.call('GET', `/sops/${sop.id}`), 'sop after').versions.length, 2, 'the old version is kept');

  // 11. Search finds the client for staff, and nothing of it for a contractor
  assert.ok(ok(await sarah.call('GET', '/search?q=Acme'), 'search').groups.some((g) => g.type === 'client'));
  assert.equal(ok(await cole.call('GET', '/search?q=Acme'), 'contractor search').groups.some((g) => ['client', 'request', 'decision', 'note'].includes(g.type)), false);

  // 12. AI: the owner's connected AI reads the brief and proposes; nothing changes until a person approves
  const key = ok(await owner.call('POST', '/api-keys', { name: 'assistant', access: 'propose' }), 'key');
  const ai = mcp(app, key.token);
  const brief = (await ai.tool('get_meeting_brief', { noteId: note.id })).data;
  assert.equal(brief.note.transcript, 'Dr. Lee: we need booking.');
  assert.deepEqual(brief.openRequests.map((r) => r.id), [request.id]);
  const second = ok(await mark.call('POST', '/meeting-notes', { title: 'Phone call', meetingDate: day(), clientId: client.id, transcript: 'Dr. Lee: also a blog.' }), 'second note');
  const proposal = await ai.tool('apply_changes', { summary: 'Process the call', steps: [{ action: 'update_meeting_note', args: { id: second.id, summary: 'Client wants a blog', requests: '- Add a blog' } }, { action: 'create_records_from_note', args: { noteId: second.id } }] });
  assert.equal(proposal.data.status, 'pending');
  assert.equal(ok(await owner.call('GET', `/meeting-notes/${second.id}`), 'unchanged').summary, '');
  ok(await owner.call('POST', `/ai/proposals/${proposal.data.proposalId}/approve`, {}), 'approve proposal');
  const drafted = ok(await owner.call('GET', `/meeting-notes/${second.id}`), 'drafted');
  assert.deepEqual([drafted.summary, drafted.aiDrafted, drafted.status], ['Client wants a blog', true, 'draft']);
  // and the AI can never decide the important things
  const direct = mcp(app, ok(await owner.call('POST', '/api-keys', { name: 'direct', access: 'direct' }), 'direct key').token);
  assert.equal((await direct.tool('update_meeting_note', { id: second.id, status: 'final' })).isError, true);
  const newRequest = (await direct.tool('create_request', { clientId: client.id, title: 'From AI' })).data.results[0].id;
  assert.equal((await direct.tool('update_request', { id: newRequest, status: 'approved' })).isError, true);
  assert.equal((await direct.tool('log_time', { taskId: conv.task.id, minutes: 30, date: day() })).data.status, 'applied');
  const names = (await direct.rpc('tools/list')).result.tools.map((t) => t.name);
  assert.ok(!names.some((n) => /approve|reject|lock|publish|convert|delete|finalize/.test(n)), 'no decision tools for AI');

  // 13. A contractor is held to their own work
  for (const path of ['/requests', '/decisions', `/clients/${client.id}/retainer`, '/retainers']) assert.equal((await cole.call('GET', path)).status, 403, path);
  assert.equal((await cole.call('POST', '/time-entries', { minutes: 30, clientId: client.id })).status, 400);
  assert.equal((await cole.call('GET', `/meeting-notes/${note.id}`)).status, 404);

  // 14. The trail is in the activity log
  const actions = new Set(ok(await owner.call('GET', '/activity?limit=200'), 'activity').map((a) => a.action));
  for (const a of ['event.create', 'meeting_note.create', 'meeting_note.extract', 'request.convert', 'time.approve', 'sopchange.publish', 'ai.proposal.create']) assert.ok(actions.has(a), `logged: ${a}`);
  await app.close();
});
