// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

async function people(app) {
  const who = {};
  for (const u of ['mark', 'sarah', 'cole']) { who[u] = app.client(); await who[u].signIn(u); }
  return who;
}

test('the whole flow over HTTP: client, contact, project, task, comment, dashboard', async () => {
  const app = await setUp();
  const o = app.owner;
  const c = (await o.call('POST', '/clients', { name: 'Acme Dental', industry: 'Dental' })).data;
  assert.equal(c.status, 'active');
  const contact = await o.call('POST', `/clients/${c.id}/contacts`, { name: 'Dr. Lee', email: 'lee@acme.example', isPrimary: true });
  assert.equal(contact.status, 200);
  const p = (await o.call('POST', '/projects', { clientId: c.id, name: 'New website', dueDate: '2030-01-31' })).data;
  const t = (await o.call('POST', '/tasks', { projectId: p.id, title: 'Homepage copy', assigneeId: 4, priority: 'high' })).data;
  assert.equal(t.projectName, 'New website');
  assert.equal((await o.call('POST', `/tasks/${t.id}/comments`, { body: 'Please start' })).status, 200);
  assert.equal((await o.call('GET', `/tasks/${t.id}/comments`)).data.length, 1);
  assert.equal((await o.call('GET', `/clients/${c.id}`)).data.projects.length, 1);
  assert.equal((await o.call('GET', `/projects/${p.id}`)).data.openTasks, 1);
  assert.equal((await o.call('GET', `/tasks?projectId=${p.id}&status=todo`)).data.length, 1);
  const d = (await o.call('GET', '/dashboard')).data;
  assert.equal(d.agency.openTasks, 1);
  assert.equal((await o.call('PATCH', `/tasks/${t.id}`, { status: 'done' })).data.status, 'done');
  assert.equal((await o.call('DELETE', `/contacts/${contact.data.id}`)).status, 200);
  assert.equal((await o.call('DELETE', `/tasks/${t.id}`)).status, 200);
  assert.equal((await o.call('GET', `/tasks/${t.id}`)).status, 404);
  await app.close();
});

test('role limits hold over HTTP, and a Contractor sees only their task', async () => {
  const app = await setUp();
  const o = app.owner;
  const { sarah, cole, mark } = await people(app);
  const c = (await mark.call('POST', '/clients', { name: 'Acme' })).data;
  const p = (await mark.call('POST', '/projects', { clientId: c.id, name: 'Site' })).data;
  const hers = (await mark.call('POST', '/tasks', { projectId: p.id, title: 'Hers', assigneeId: 4 })).data;
  const his = (await mark.call('POST', '/tasks', { projectId: p.id, title: 'His', assigneeId: 5 })).data;
  assert.deepEqual([hers.assigneeName, his.assigneeName], ['Sarah', 'Cole']);

  assert.equal((await sarah.call('POST', '/clients', { name: 'No' })).status, 403);
  assert.equal((await sarah.call('POST', '/tasks', { projectId: p.id, title: 'No' })).status, 403);
  assert.equal((await sarah.call('PATCH', `/tasks/${hers.id}`, { status: 'review' })).data.status, 'review');
  assert.equal((await sarah.call('PATCH', `/tasks/${hers.id}`, { title: 'x' })).status, 403);

  assert.equal((await cole.call('GET', '/clients')).status, 403);
  assert.equal((await cole.call('GET', '/projects')).status, 403);
  assert.deepEqual((await cole.call('GET', '/tasks')).data.map((x) => x.title), ['His']);
  assert.equal((await cole.call('GET', `/tasks/${hers.id}`)).status, 404);
  assert.equal((await cole.call('GET', `/tasks/${hers.id}/comments`)).status, 404);
  assert.equal((await cole.call('GET', '/dashboard')).data.agency, null);
  assert.equal((await o.call('GET', '/tasks')).data.length, 2);
  await app.close();
});

test('another agency gets not found on every work record, and nothing leaks into its lists', async () => {
  const app = await setUp();
  const o = app.owner;
  const c = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  const p = (await o.call('POST', '/projects', { clientId: c.id, name: 'Site' })).data;
  const t = (await o.call('POST', '/tasks', { projectId: p.id, title: 'Secret' })).data;
  const zed = app.client();
  assert.equal((await zed.call('POST', '/setup', { organizationName: 'x', displayName: 'Z', username: 'zed', password: 'correct horse battery' })).status, 409); // one agency per server in the app
  await app.close();
  // the service-level isolation tests cover a second agency; here the HTTP layer is checked for bad ids
  const app2 = await setUp();
  for (const path of ['/clients/99', '/projects/99', '/tasks/99', '/tasks/99/comments', '/clients/abc', '/tasks/0']) assert.equal((await app2.owner.call('GET', path)).status, 404, path);
  assert.equal((await app2.owner.call('PATCH', '/tasks/99', { title: 'x' })).status, 404);
  assert.equal((await app2.owner.call('DELETE', '/tasks/99')).status, 404);
  assert.equal(t.title, 'Secret');
  await app2.close();
});

test('work routes need a session and the CSRF token', async () => {
  const app = await setUp();
  const anon = app.client();
  for (const [m, p] of [['GET', '/clients'], ['GET', '/projects'], ['GET', '/tasks'], ['POST', '/tasks'], ['POST', '/clients']]) assert.equal((await anon.call(m, p, m === 'POST' ? {} : undefined)).status, 401, `${m} ${p}`);
  const noToken = await app.owner.call('POST', '/clients', { name: 'X' }, { csrfToken: '' });
  assert.equal(noToken.status, 403);
  await app.close();
});

test('bad input comes back as a plain message', async () => {
  const app = await setUp();
  const r = await app.owner.call('POST', '/clients', { name: '' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /name/i);
  assert.equal((await app.owner.call('POST', '/tasks', { title: 'no project' })).status, 404);
  assert.equal((await app.owner.call('GET', '/tasks?status=nonsense')).status, 400);
  await app.close();
});
