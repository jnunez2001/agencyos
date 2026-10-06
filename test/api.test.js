// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setUp, PASSWORD } = require('./support/http');

test('first run: status, setup, and setup can only happen once', async () => {
  const app = await boot();
  const c = app.client();
  assert.deepEqual((await c.call('GET', '/status')).data, { needsSetup: true, setupCodeRequired: false });
  assert.equal((await c.call('POST', '/setup', { organizationName: '', displayName: 'Josh', username: 'josh', password: PASSWORD })).status, 400);
  assert.equal((await c.call('POST', '/setup', { organizationName: 'Whalls', displayName: 'Josh', username: 'josh', password: PASSWORD })).status, 200);
  assert.equal((await c.call('GET', '/status')).data.needsSetup, false);
  assert.equal((await c.call('POST', '/setup', { organizationName: 'Again', displayName: 'X', username: 'someone', password: PASSWORD })).status, 409);
  await app.close();
});

test('every protected route needs a session', async () => {
  const app = await setUp();
  const anon = app.client();
  for (const [m, p] of [['GET', '/session'], ['GET', '/org'], ['GET', '/members'], ['GET', '/activity'], ['GET', '/dashboard'], ['GET', '/profile'], ['POST', '/members'], ['POST', '/password']]) {
    assert.equal((await anon.call(m, p, m === 'POST' ? {} : undefined)).status, 401, `${m} ${p}`);
  }
  await app.close();
});

test('login gives a cookie and a session with the role and what the person may do', async () => {
  const app = await setUp();
  const mark = app.client();
  assert.equal((await mark.signIn('mark', 'wrong password here')).status, 401);
  assert.equal((await mark.signIn('mark')).status, 200);
  const s = (await mark.call('GET', '/session')).data;
  assert.deepEqual([s.user.username, s.role, s.organization.name, s.user.mustChangePassword], ['mark', 'manager', 'Whalls Agency', false]);
  assert.equal(s.can['members.list'], true);
  assert.equal(s.can['members.create'], false);
  assert.equal(s.can['activity.view'], false);
  assert.ok(!JSON.stringify(s).includes('password_hash'));
  await app.close();
});

test('responses carry security headers and are never cached', async () => {
  const app = await boot();
  const { res } = await app.client().call('GET', '/status', undefined, { raw: true });
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await app.close();
});

test('a change without the session CSRF token is refused', async () => {
  const app = await setUp();
  const r = await app.owner.call('POST', '/members', { username: 'csrf1', displayName: 'X', role: 'employee', password: PASSWORD }, { csrfToken: '' });
  assert.equal(r.status, 403);
  assert.equal((await app.owner.call('POST', '/members', { username: 'csrf1', displayName: 'X', role: 'employee', password: PASSWORD }, { csrfToken: 'forged' })).status, 403);
  await app.close();
});

test('a new member can only change their password until they do', async () => {
  const app = await boot();
  const owner = app.client();
  await owner.call('POST', '/setup', { organizationName: 'Whalls', displayName: 'Josh', username: 'josh', password: PASSWORD });
  await owner.signIn('josh');
  await owner.call('POST', '/members', { username: 'newbie', displayName: 'Newbie', role: 'employee', password: PASSWORD });
  const n = app.client();
  await n.signIn('newbie');
  assert.equal((await n.call('GET', '/session')).data.user.mustChangePassword, true);
  const blocked = await n.call('GET', '/members');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'must_change_password');
  assert.equal((await n.call('GET', '/dashboard')).status, 403);
  assert.equal((await n.call('POST', '/password', { current: PASSWORD, next: 'short' })).status, 400);
  assert.equal((await n.call('POST', '/password', { current: PASSWORD, next: 'my own new password' })).status, 200);
  assert.equal((await n.call('GET', '/session')).data.user.mustChangePassword, false);
  assert.equal((await n.call('GET', '/members')).status, 200);
  await app.close();
});

test('roles are enforced over HTTP', async () => {
  const app = await setUp();
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const mark = app.client(); await mark.signIn('mark');
  assert.equal((await sarah.call('GET', '/members')).status, 200);
  assert.equal((await sarah.call('GET', '/activity')).status, 403);
  assert.equal((await sarah.call('PATCH', '/org', { name: 'Mine now' })).status, 403);
  assert.equal((await sarah.call('POST', '/members', { username: 'sneaky', displayName: 'S', role: 'employee', password: PASSWORD })).status, 403);
  assert.equal((await cole.call('GET', '/members')).status, 403);
  assert.equal((await mark.call('GET', '/dashboard')).data.team.total, 5);
  assert.equal((await sarah.call('GET', '/dashboard')).data.team, null);
  assert.equal((await mark.call('GET', '/activity')).status, 403);
  await app.close();
});

test('the Owner can run the team: add, change role, reset password, deactivate', async () => {
  const app = await setUp();
  const list = (await app.owner.call('GET', '/members')).data;
  const sarah = list.find((m) => m.username === 'sarah');
  assert.equal((await app.owner.call('PATCH', `/members/${sarah.id}`, { role: 'manager' })).data.role, 'manager');
  assert.equal((await app.owner.call('POST', `/members/${sarah.id}/reset-password`, { password: 'another temporary pass' })).status, 200);
  assert.equal((await app.owner.call('PATCH', `/members/${sarah.id}`, { isActive: false })).data.isActive, false);
  const gone = app.client();
  assert.equal((await gone.signIn('sarah', 'another temporary pass')).status, 401);
  const log = (await app.owner.call('GET', '/activity?action=member.update')).data;
  assert.ok(log.length >= 2 && log.every((r) => r.action === 'member.update'));
  await app.close();
});

test('profiles: edit your own, and an Admin edits others below them', async () => {
  const app = await setUp();
  const sarah = app.client(); await sarah.signIn('sarah');
  const mine = (await sarah.call('PATCH', '/profile', { jobTitle: 'SEO Specialist', workDays: [1, 2, 3], weeklyCapacityHours: 24 })).data;
  assert.deepEqual([mine.jobTitle, mine.workDays, mine.weeklyCapacityHours], ['SEO Specialist', [1, 2, 3], 24]);
  assert.equal((await sarah.call('PATCH', '/profile', { workStart: '18:00', workEnd: '09:00' })).status, 400);
  const rayne = app.client(); await rayne.signIn('rayne');
  const id = (await rayne.call('GET', '/members')).data.find((m) => m.username === 'sarah').id;
  assert.equal((await rayne.call('PATCH', `/members/${id}/profile`, { department: 'SEO' })).data.department, 'SEO');
  const ownerId = (await rayne.call('GET', '/members')).data.find((m) => m.username === 'josh').id;
  assert.equal((await rayne.call('PATCH', `/members/${ownerId}/profile`, { department: 'x' })).status, 403);
  await app.close();
});

test('another agency is invisible: its members are 404 and its data never appears', async () => {
  const app = await setUp();
  const { createOrganization } = require('../server/services/organizations');
  const b = await createOrganization(app.db, { organizationName: 'Other Agency', displayName: 'Zed', username: 'zed', password: PASSWORD });
  assert.equal((await app.owner.call('PATCH', `/members/${b.userId}`, { role: 'employee' })).status, 404);
  assert.equal((await app.owner.call('POST', `/members/${b.userId}/reset-password`, { password: 'another temporary pass' })).status, 404);
  assert.equal((await app.owner.call('GET', `/members/${b.userId}/profile`)).status, 404);
  assert.ok(!JSON.stringify((await app.owner.call('GET', '/members')).data).includes('zed'));
  assert.ok(!JSON.stringify((await app.owner.call('GET', '/activity')).data).includes('Zed'));
  const zed = app.client(); await zed.signIn('zed');
  assert.equal((await zed.call('GET', '/members')).data.length, 1);
  assert.equal((await zed.call('GET', '/org')).data.name, 'Other Agency');
  await app.close();
});

test('logout ends the session', async () => {
  const app = await setUp();
  const c = app.client(); await c.signIn('mark');
  assert.equal((await c.call('POST', '/logout', {})).status, 200);
  assert.equal((await c.call('GET', '/session')).status, 401);
  await app.close();
});
