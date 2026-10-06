// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

function mcp(app, token) {
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })).json());
  return { rpc, async tool(name, args = {}) { const r = await rpc('tools/call', { name, arguments: args }); let data = r.result.content[0].text; try { data = JSON.parse(data); } catch { /* plain */ } return { isError: !!r.result.isError, data }; } };
}

test('SOP change requests over HTTP: raise, review, reject, publish, with permissions', async () => {
  const app = await setUp();
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const sop = (await o.call('POST', '/sops', { title: 'Page Optimization', status: 'approved', steps: ['Research'], purpose: 'Rank' })).data;

  assert.equal((await cole.call('POST', '/sop-changes', { sopId: sop.id, title: 'x', details: 'y' })).status, 403);
  assert.equal((await cole.call('GET', '/sop-changes')).data.length, 0);
  const made = await sarah.call('POST', '/sop-changes', { sopId: sop.id, title: 'Add a check', details: 'Needs one', proposedContent: { steps: ['Research', 'Check'] } });
  assert.equal(made.status, 200);
  const id = made.data.id;
  assert.equal((await sarah.call('GET', `/sop-changes/${id}`)).data.proposedContent.steps.length, 2);
  assert.equal((await sarah.call('GET', `/sop-changes?sopId=${sop.id}&status=identified`)).data.length, 1);
  assert.equal((await sarah.call('GET', '/sop-changes?status=bogus')).status, 400);
  assert.equal((await sarah.call('PATCH', `/sop-changes/${id}`, { status: 'approved' })).status, 403);
  assert.equal((await sarah.call('PATCH', `/sop-changes/${id}`, { status: 'needs_review' })).data.status, 'needs_review');
  assert.equal((await sarah.call('POST', `/sop-changes/${id}/publish`, {})).status, 403);
  assert.equal((await mark.call('POST', `/sop-changes/${id}/publish`, {})).status, 400); // not approved yet
  assert.equal((await mark.call('PATCH', `/sop-changes/${id}`, { status: 'approved' })).data.status, 'approved');
  assert.equal((await mark.call('POST', `/sop-changes/${id}/publish`, { changeNote: 'Added a check' })).data.publishedVersion, '1.1');
  assert.equal((await o.call('GET', `/sops/${sop.id}`)).data.versions.length, 2);
  assert.equal((await o.call('GET', '/sop-changes/abc')).status, 404);

  const second = (await sarah.call('POST', '/sop-changes', { sopId: sop.id, title: 'Another', details: 'More' })).data;
  const rej = await mark.call('PATCH', `/sop-changes/${second.id}`, { status: 'rejected' });
  assert.equal(rej.status, 400);
  assert.match(rej.data.error, /why/i);
  assert.equal((await mark.call('PATCH', `/sop-changes/${second.id}`, { status: 'rejected', rejectedReason: 'Duplicate' })).data.rejectedReason, 'Duplicate');

  const session = (await sarah.call('GET', '/session')).data;
  assert.deepEqual([session.can['sopchanges.view'], session.can['sopchanges.create'], session.can['sopchanges.manage']], [true, true, false]);
  assert.equal((await cole.call('GET', '/session')).data.can['sopchanges.manage'], false);
  await app.close();
});

test('AI can read and raise change requests but never decide or publish them', async () => {
  const app = await setUp();
  const o = app.owner;
  const sop = (await o.call('POST', '/sops', { title: 'Page Optimization', status: 'approved', steps: ['Research'] })).data;
  const read = mcp(app, (await o.call('POST', '/api-keys', { name: 'r', access: 'read' })).data.token);
  const direct = mcp(app, (await o.call('POST', '/api-keys', { name: 'd', access: 'direct' })).data.token);
  const propose = mcp(app, (await o.call('POST', '/api-keys', { name: 'p', access: 'propose' })).data.token);

  const names = (await direct.rpc('tools/list')).result.tools.map((t) => t.name);
  assert.ok(['list_sop_changes', 'get_sop_change', 'create_sop_change', 'update_sop_change'].every((n) => names.includes(n)));
  assert.ok(!(await read.rpc('tools/list')).result.tools.some((t) => t.name === 'create_sop_change'));
  assert.ok(!names.some((n) => /publish/.test(n)));

  const made = await direct.tool('create_sop_change', { sopId: sop.id, title: 'AI idea', details: 'From the QA notes', proposedContent: { steps: ['Research', 'Check'] } });
  assert.equal(made.data.status, 'applied');
  const list = (await read.tool('list_sop_changes', { status: 'identified' })).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].createdByName, 'Josh');
  const one = (await read.tool('get_sop_change', { id: list[0].id })).data;
  assert.deepEqual(one.proposedContent.steps, ['Research', 'Check']);
  assert.equal((await direct.tool('update_sop_change', { id: one.id, status: 'needs_review', priority: 'high' })).data.status, 'applied');
  assert.equal((await read.tool('get_sop_change', { id: one.id })).data.status, 'needs_review');

  for (const status of ['approved', 'rejected', 'in_progress', 'testing', 'published']) {
    const bad = await direct.tool('update_sop_change', { id: one.id, status });
    assert.equal(bad.isError, true, status);
    assert.match(bad.data, /cannot approve, reject, start, test or publish/);
    const badNew = await direct.tool('create_sop_change', { sopId: sop.id, title: 'x', details: 'y', status });
    assert.equal(badNew.isError, true, status);
  }
  const viaPlan = await direct.tool('apply_changes', { summary: 's', steps: [{ action: 'update_sop_change', args: { id: one.id, status: 'approved' } }] });
  assert.equal(viaPlan.isError, true);
  assert.equal((await read.tool('get_sop_change', { id: one.id })).data.status, 'needs_review');

  const proposed = await propose.tool('create_sop_change', { sopId: sop.id, title: 'Proposed idea', details: 'Why' });
  assert.equal(proposed.data.status, 'pending');
  assert.match(proposed.data.lines[0], /Proposed idea/);
  assert.equal((await o.call('POST', `/ai/proposals/${proposed.data.proposalId}/approve`, {})).data.status, 'approved');
  assert.equal((await read.tool('list_sop_changes')).data.length, 2);
  const log = (await o.call('GET', '/activity?action=sopchange.create')).data;
  assert.ok(log.length >= 2 && log.some((r) => r.source === 'ai'));
  await app.close();
});
