// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

const SOP = { title: 'Service Page Optimization', service: 'SEO', requiresQa: true, status: 'approved', steps: ['Research', 'Write'], checklist: ['Title ok', 'Links ok'], purpose: 'Rank' };

test('SOPs, tasks with SOPs and QA over HTTP, start to finish', async () => {
  const app = await setUp();
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');
  const sop = (await mark.call('POST', '/sops', SOP)).data;
  assert.equal(sop.version, '1.0');
  const v = (await mark.call('POST', `/sops/${sop.id}/versions`, { steps: ['Research', 'Write', 'Publish'], changeNote: 'Added publish' })).data;
  assert.equal(v.version, '1.1');
  const full = (await sarah.call('GET', `/sops/${sop.id}`)).data;
  assert.deepEqual([full.versions.length, full.content.steps.length], [2, 3]);
  assert.equal((await sarah.call('GET', `/sops/${sop.id}/versions/${full.versions[1].id}`)).data.content.steps.length, 2);
  assert.equal((await sarah.call('PATCH', `/sops/${sop.id}`, { title: 'x' })).status, 403);
  assert.equal((await sarah.call('GET', '/sops?status=approved')).data.length, 1);
  assert.equal((await mark.call('GET', '/sops?q=optim')).data.length, 1);

  const c = (await mark.call('POST', '/clients', { name: 'Acme' })).data;
  const p = (await mark.call('POST', '/projects', { clientId: c.id, name: 'Site' })).data;
  const started = (await mark.call('POST', `/sops/${sop.id}/tasks`, { projectId: p.id, mode: 'steps', assigneeId: 4 })).data;
  assert.deepEqual(started.map((t) => t.title), ['Research', 'Write', 'Publish']);
  const t = started[0];
  assert.equal(t.qaRequired, true);

  assert.equal((await sarah.call('PATCH', `/tasks/${t.id}`, { status: 'done' })).status, 400);
  assert.equal((await sarah.call('PATCH', `/tasks/${t.id}`, { status: 'review' })).data.status, 'review');
  assert.equal((await sarah.call('GET', '/qa')).status, 403);
  const queue = (await mark.call('GET', '/qa')).data;
  assert.equal(queue.length, 1);
  assert.equal((await sarah.call('POST', `/tasks/${t.id}/qa`, { result: 'approved' })).status, 403);
  assert.equal((await mark.call('POST', `/tasks/${t.id}/qa`, { result: 'approved', checklist: [true, false] })).status, 400);
  const back = (await mark.call('POST', `/tasks/${t.id}/qa`, { result: 'changes_requested', comments: 'Fix the title' })).data;
  assert.equal(back.status, 'changes');
  assert.equal((await sarah.call('GET', `/tasks/${t.id}`)).data.qa.history[0].comments, 'Fix the title');
  assert.equal((await sarah.call('PATCH', `/tasks/${t.id}`, { status: 'review' })).data.status, 'review');
  const done = (await o.call('POST', `/tasks/${t.id}/qa`, { result: 'approved', checklist: [true, true] })).data;
  assert.equal(done.status, 'done');
  assert.equal((await o.call('GET', '/dashboard')).data.qaWaiting, 0);
  const log = (await o.call('GET', '/activity?limit=100')).data.map((a) => a.action);
  for (const a of ['sop.create', 'sop.version', 'qa.submit', 'qa.request_changes', 'qa.approve']) assert.ok(log.includes(a), a);
  await app.close();
});

test('SOP and QA routes need a session', async () => {
  const app = await setUp();
  const anon = app.client();
  for (const [m, p] of [['GET', '/sops'], ['POST', '/sops'], ['GET', '/sops/1'], ['GET', '/qa'], ['POST', '/tasks/1/qa']]) assert.equal((await anon.call(m, p, m === 'POST' ? {} : undefined)).status, 401, `${m} ${p}`);
  for (const path of ['/sops/99', '/sops/abc']) assert.equal((await app.owner.call('GET', path)).status, 404, path);
  await app.close();
});
