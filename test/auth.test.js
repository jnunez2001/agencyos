// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../server/services/auth');
const members = require('../server/services/members');
const { fixture, PASSWORD } = require('./fixture');

const attempt = (f, username, password, ip = '10.0.0.1') => auth.login(f.db, { username, password, ip, userAgent: 'test' });

test('a correct login gives a session that resolves to the user, organization and role', async () => {
  const f = await fixture();
  const r = await attempt(f, 'josh', PASSWORD);
  assert.equal(r.ok, true);
  const s = auth.resolveSession(f.db, r.session.token);
  assert.deepEqual([s.user.username, s.organization.name, s.role, s.user.mustChangePassword], ['josh', 'Whalls Agency', 'owner', false]);
  assert.ok(s.csrf);
  assert.ok(f.db.prepare("SELECT 1 FROM activity_logs WHERE action = 'login.success'").get());
});

test('a wrong password and an unknown username get the same message', async () => {
  const f = await fixture();
  const wrong = await attempt(f, 'josh', 'not the password');
  const unknown = await attempt(f, 'nobody', 'not the password');
  assert.deepEqual([wrong.ok, wrong.status, wrong.error], [false, 401, 'Wrong username or password']);
  assert.deepEqual([unknown.ok, unknown.status, unknown.error], [false, 401, 'Wrong username or password']);
  assert.equal((await attempt(f, '', '')).status, 400);
});

test('five wrong tries lock the username, even with the right password', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i += 1) await attempt(f, 'josh', 'wrong password', `10.0.0.${i}`);
  const locked = await attempt(f, 'josh', PASSWORD, '10.9.9.9');
  assert.equal(locked.status, 429);
  const other = await attempt(f, 'rayne', PASSWORD, '10.9.9.9');
  assert.equal(other.ok, true);
});

test('a role change applies at once, because the role is read live', async () => {
  const f = await fixture();
  const r = await attempt(f, 'mark', PASSWORD);
  assert.equal(auth.resolveSession(f.db, r.session.token).role, 'manager');
  members.updateMember(f.db, f.josh, f.ids.mark, { role: 'employee' });
  assert.equal(auth.resolveSession(f.db, r.session.token).role, 'employee');
});

test('deactivating a member ends their sessions and blocks login', async () => {
  const f = await fixture();
  const r = await attempt(f, 'sarah', PASSWORD);
  assert.ok(auth.resolveSession(f.db, r.session.token));
  members.updateMember(f.db, f.josh, f.ids.sarah, { isActive: false });
  assert.equal(auth.resolveSession(f.db, r.session.token), null);
  assert.equal((await attempt(f, 'sarah', PASSWORD)).status, 401);
});

test('an expired or unknown session token is refused', async () => {
  const f = await fixture();
  const r = await attempt(f, 'josh', PASSWORD);
  f.db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal(auth.resolveSession(f.db, r.session.token), null);
  assert.equal(auth.resolveSession(f.db, 'nope'), null);
  assert.equal(auth.resolveSession(f.db, undefined), null);
});

test('a new member must change the temporary password, and doing so clears the flag and ends other sessions', async () => {
  const f = await fixture();
  const first = await attempt(f, 'cole', PASSWORD);
  const second = await attempt(f, 'cole', PASSWORD);
  assert.equal(auth.resolveSession(f.db, first.session.token).user.mustChangePassword, true);
  await assert.rejects(() => auth.changePassword(f.db, f.cole, { current: 'wrong', next: 'a brand new password' }), /current password/i);
  await assert.rejects(() => auth.changePassword(f.db, f.cole, { current: PASSWORD, next: 'short' }), /at least 10/i);
  await auth.changePassword(f.db, f.cole, { current: PASSWORD, next: 'a brand new password', keepSessionId: auth.resolveSession(f.db, first.session.token).sessionId });
  assert.equal(auth.resolveSession(f.db, first.session.token).user.mustChangePassword, false);
  assert.equal(auth.resolveSession(f.db, second.session.token), null);
  assert.equal((await attempt(f, 'cole', 'a brand new password')).ok, true);
  assert.equal((await attempt(f, 'cole', PASSWORD)).ok, false);
});

test('logging out ends the session', async () => {
  const f = await fixture();
  const r = await attempt(f, 'josh', PASSWORD);
  auth.destroySession(f.db, auth.resolveSession(f.db, r.session.token).sessionId);
  assert.equal(auth.resolveSession(f.db, r.session.token), null);
});
