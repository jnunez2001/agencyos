// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const members = require('../server/services/members');
const auth = require('../server/services/auth');
const { fixture, PASSWORD } = require('./fixture');

const add = (f, ctx, over = {}) => members.createMember(f.db, ctx, { username: 'newbie', displayName: 'New Person', role: 'employee', password: PASSWORD, ...over });

test('the team list shows everyone in the agency and nobody from another agency', async () => {
  const f = await fixture();
  const list = members.listMembers(f.db, f.josh);
  assert.deepEqual(list.map((m) => m.username).sort(), ['cole', 'josh', 'mark', 'rayne', 'sarah']);
  const josh = list.find((m) => m.username === 'josh');
  assert.deepEqual([josh.role, josh.isActive, josh.displayName], ['owner', true, 'Josh']);
  assert.ok(!JSON.stringify(list).includes('zed'));
  assert.ok(!JSON.stringify(list).includes('hash') && !JSON.stringify(list).includes('password_hash'));
});

test('each member says whether the viewer may manage them', async () => {
  const f = await fixture();
  const byUser = (ctx) => Object.fromEntries(members.listMembers(f.db, ctx).map((m) => [m.username, m.canManage]));
  assert.deepEqual(byUser(f.josh), { josh: true, rayne: true, mark: true, sarah: true, cole: true });
  assert.deepEqual(byUser(f.rayne), { josh: false, rayne: false, mark: true, sarah: true, cole: true });
  assert.deepEqual(byUser(f.mark), { josh: false, rayne: false, mark: false, sarah: false, cole: false });
});

test('owner, admin, manager and employee can see the team; a contractor cannot', async () => {
  const f = await fixture();
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) assert.equal(members.listMembers(f.db, ctx).length, 5);
  assert.throws(() => members.listMembers(f.db, f.cole), /not allowed/i);
});

test('an Owner can add a member of any role, with a temporary password that must be changed', async () => {
  const f = await fixture();
  for (const role of ['owner', 'admin', 'manager', 'employee', 'contractor']) {
    const m = await add(f, f.josh, { username: `u_${role}`, role });
    assert.equal(m.role, role);
  }
  const u = f.db.prepare("SELECT must_change_password FROM users WHERE username = 'u_employee'").get();
  assert.equal(u.must_change_password, 1);
  assert.ok(f.db.prepare("SELECT 1 FROM employee_profiles WHERE user_id = (SELECT id FROM users WHERE username = 'u_employee')").get());
});

test('an Admin can add only roles below admin; a manager, employee or contractor cannot add anyone', async () => {
  const f = await fixture();
  for (const role of ['manager', 'employee', 'contractor']) await add(f, f.rayne, { username: `a_${role}`, role });
  await assert.rejects(() => add(f, f.rayne, { username: 'xxx1', role: 'admin' }), /not allowed/i);
  await assert.rejects(() => add(f, f.rayne, { username: 'xxx2', role: 'owner' }), /not allowed/i);
  for (const ctx of [f.mark, f.sarah, f.cole]) await assert.rejects(() => add(f, ctx, { username: 'xxx3' }), /not allowed/i);
});

test('adding a member validates the input and refuses a duplicate username', async () => {
  const f = await fixture();
  await assert.rejects(() => add(f, f.josh, { username: 'a b' }), /username/i);
  await assert.rejects(() => add(f, f.josh, { displayName: '' }), /name/i);
  await assert.rejects(() => add(f, f.josh, { password: 'short' }), /at least 10/i);
  await assert.rejects(() => add(f, f.josh, { role: 'wizard' }), /role/i);
  await assert.rejects(() => add(f, f.josh, { username: 'JOSH' }), /already/i);
  await assert.rejects(() => add(f, f.josh, { username: 'zed' }), /already/i); // usernames are unique across agencies
});

test('adding a member is logged without the password', async () => {
  const f = await fixture();
  await add(f, f.josh);
  const log = f.db.prepare("SELECT * FROM activity_logs WHERE action = 'member.create' ORDER BY id DESC").get();
  assert.equal(log.actor_user_id, f.ids.josh);
  assert.deepEqual(JSON.parse(log.after_json), { username: 'newbie', displayName: 'New Person', role: 'employee' });
  assert.ok(!/password|scrypt/i.test(JSON.stringify(log)));
});

test('an Owner can change anyone role; an Admin only members below admin, and only to roles below admin', async () => {
  const f = await fixture();
  assert.equal(members.updateMember(f.db, f.josh, f.ids.sarah, { role: 'manager' }).role, 'manager');
  assert.equal(members.updateMember(f.db, f.rayne, f.ids.sarah, { role: 'contractor' }).role, 'contractor');
  assert.throws(() => members.updateMember(f.db, f.rayne, f.ids.sarah, { role: 'admin' }), /not allowed/i);
  assert.throws(() => members.updateMember(f.db, f.rayne, f.ids.josh, { role: 'employee' }), /not allowed/i);
  assert.throws(() => members.updateMember(f.db, f.rayne, f.ids.rayne, { role: 'owner' }), /not allowed/i);
  for (const ctx of [f.mark, f.sarah, f.cole]) assert.throws(() => members.updateMember(f.db, ctx, f.ids.cole, { role: 'employee' }), /not allowed/i);
});

test('a role change is logged with before and after', async () => {
  const f = await fixture();
  members.updateMember(f.db, f.josh, f.ids.sarah, { role: 'manager', displayName: 'Sarah K' });
  const log = f.db.prepare("SELECT * FROM activity_logs WHERE action = 'member.update'").get();
  assert.deepEqual(JSON.parse(log.before_json), { role: 'employee', displayName: 'Sarah' });
  assert.deepEqual(JSON.parse(log.after_json), { role: 'manager', displayName: 'Sarah K' });
  assert.equal(log.object_id, f.ids.sarah);
});

test('nobody can deactivate themselves, and the agency always keeps an active Owner', async () => {
  const f = await fixture();
  assert.throws(() => members.updateMember(f.db, f.josh, f.ids.josh, { isActive: false }), /yourself/i);
  assert.throws(() => members.updateMember(f.db, f.josh, f.ids.josh, { role: 'admin' }), /at least one owner/i);
  const second = await add(f, f.josh, { username: 'owner2', role: 'owner' });
  assert.equal(members.updateMember(f.db, f.josh, f.ids.josh, { role: 'admin' }).role, 'admin'); // another owner exists now
  assert.throws(() => members.updateMember(f.db, f.ctxOf(f.orgId, second.id, 'owner'), second.id, { role: 'admin' }), /at least one owner/i);
  assert.equal(members.updateMember(f.db, f.ctxOf(f.orgId, second.id, 'owner'), f.ids.josh, { isActive: false }).isActive, false);
});

test('deactivating and reactivating works, and ends the sessions', async () => {
  const f = await fixture();
  const login = await auth.login(f.db, { username: 'mark', password: PASSWORD, ip: '10.0.0.1' });
  members.updateMember(f.db, f.rayne, f.ids.mark, { isActive: false });
  assert.equal(auth.resolveSession(f.db, login.session.token), null);
  assert.equal(members.listMembers(f.db, f.josh).find((m) => m.username === 'mark').isActive, false);
  members.updateMember(f.db, f.rayne, f.ids.mark, { isActive: true });
  assert.equal((await auth.login(f.db, { username: 'mark', password: PASSWORD, ip: '10.0.0.1' })).ok, true);
});

test('resetting a password sets a temporary one that must be changed, and ends their sessions', async () => {
  const f = await fixture();
  const login = await auth.login(f.db, { username: 'sarah', password: PASSWORD, ip: '10.0.0.1' });
  await members.resetPassword(f.db, f.rayne, f.ids.sarah, { password: 'a fresh temporary one' });
  assert.equal(auth.resolveSession(f.db, login.session.token), null);
  const again = await auth.login(f.db, { username: 'sarah', password: 'a fresh temporary one', ip: '10.0.0.1' });
  assert.equal(again.ok, true);
  assert.equal(auth.resolveSession(f.db, again.session.token).user.mustChangePassword, true);
  await assert.rejects(() => members.resetPassword(f.db, f.rayne, f.ids.josh, { password: 'a fresh temporary one' }), /not allowed/i);
  await assert.rejects(() => members.resetPassword(f.db, f.rayne, f.ids.sarah, { password: 'short' }), /at least 10/i);
  assert.ok(!/fresh temporary/.test(JSON.stringify(f.db.prepare("SELECT * FROM activity_logs WHERE action = 'member.reset_password'").all())));
});

test('another agency member id is treated as not found, for every action', async () => {
  const f = await fixture();
  await assert.rejects(async () => members.updateMember(f.db, f.josh, f.ids.zed, { role: 'employee' }), /not found/i);
  await assert.rejects(async () => members.updateMember(f.db, f.josh, f.ids.zed, { isActive: false }), /not found/i);
  await assert.rejects(() => members.resetPassword(f.db, f.josh, f.ids.zed, { password: PASSWORD }), /not found/i);
  await assert.rejects(async () => members.updateMember(f.db, f.josh, 99999, { role: 'employee' }), /not found/i);
  // and the other agency's Owner is untouched
  assert.equal(members.listMembers(f.db, f.zed).length, 1);
});
