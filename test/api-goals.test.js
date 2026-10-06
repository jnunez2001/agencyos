// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

test('services, goals, client extras and links over HTTP', async () => {
  const app = await setUp();
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');

  // services: Owner and Admin manage, staff read
  assert.equal((await mark.call('POST', '/services', { name: 'SEO' })).status, 403);
  const seo = (await o.call('POST', '/services', { name: 'SEO' })).data;
  const web = (await o.call('POST', '/services', { name: 'Web Development' })).data;
  assert.equal((await o.call('POST', '/services', { name: 'seo' })).status, 409);
  assert.deepEqual((await sarah.call('GET', '/services')).data.map((s) => s.name), ['SEO', 'Web Development']);
  assert.equal((await cole.call('GET', '/services')).status, 403);
  assert.equal((await o.call('PATCH', `/services/${web.id}`, { isActive: false })).data.isActive, false);
  assert.deepEqual((await mark.call('GET', '/services?all=1')).data.map((s) => s.name), ['SEO']);
  assert.equal((await o.call('GET', '/services?all=1')).data.length, 2);
  assert.equal((await o.call('POST', '/services/defaults', {})).data.length, 10);

  // client with services, owner, start date, status
  const c = (await mark.call('POST', '/clients', { name: 'Acme', status: 'onboarding', serviceIds: [seo.id], accountOwnerId: 4, startDate: '2026-10-01' })).data;
  assert.deepEqual([c.status, c.services.map((s) => s.name), c.accountOwnerName, c.startDate], ['onboarding', ['SEO'], 'Sarah', '2026-10-01']);

  // goals
  assert.equal((await sarah.call('POST', `/clients/${c.id}/goals`, { title: 'x' })).status, 403);
  const g = (await mark.call('POST', `/clients/${c.id}/goals`, { title: 'Increase qualified organic leads', target: '50 a month', serviceId: seo.id })).data;
  assert.equal(g.progress.tasksTotal, 0);
  assert.equal((await sarah.call('GET', `/clients/${c.id}/goals`)).data.length, 1);
  assert.equal((await cole.call('GET', `/clients/${c.id}/goals`)).status, 403);
  assert.equal((await mark.call('PATCH', `/goals/${g.id}`, { target: '80 a month' })).data.target, '80 a month');

  // projects and tasks link to the goal
  const p = (await mark.call('POST', '/projects', { clientId: c.id, name: 'Local SEO', goalId: g.id, serviceId: seo.id })).data;
  assert.deepEqual([p.goalTitle, p.serviceName], ['Increase qualified organic leads', 'SEO']);
  const t = (await mark.call('POST', '/tasks', { projectId: p.id, title: 'Audit' })).data;
  assert.deepEqual([t.goalTitle, t.goalInherited], ['Increase qualified organic leads', true]);
  assert.deepEqual((await mark.call('GET', `/clients/${c.id}`)).data.goals[0].progress, { tasksTotal: 1, tasksDone: 0, projects: 1 });
  assert.equal((await mark.call('POST', '/projects', { clientId: c.id, name: 'Bad', goalId: 9999 })).status, 404);
  assert.equal((await mark.call('PATCH', `/goals/${g.id}`, { status: 'dropped' })).data.status, 'dropped');
  assert.equal((await mark.call('POST', '/projects', { clientId: c.id, name: 'Dropped goal', goalId: g.id })).status, 400);

  const log = (await o.call('GET', '/activity?limit=100')).data.map((a) => a.action);
  for (const a of ['service.create', 'service.update', 'goal.create', 'goal.update']) assert.ok(log.includes(a), a);
  for (const [m, path] of [['GET', '/services'], ['POST', '/services'], ['GET', '/clients/1/goals'], ['PATCH', '/goals/1']]) assert.equal((await app.client().call(m, path, m === 'GET' ? undefined : {})).status, 401, `${m} ${path}`);
  await app.close();
});
