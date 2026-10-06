// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const identities = require('../server/services/identities');
const members = require('../server/services/members');
const orgs = require('../server/services/organizations');
const auth = require('../server/services/auth');
const { listActivity } = require('../server/services/activity');
const { fixture, PASSWORD } = require('./fixture');

const link = (f, ctx, n) => identities.completeLink(f.db, ctx, { sub: `g-${n}`, email: `${n}@example.com`, name: n });
// Everyone but the Owner is linked or invited, so the setting may be switched on.
function ready(f) {
  link(f, f.rayne, 'rayne');
  link(f, f.mark, 'mark');
  identities.setInvite(f.db, f.josh, f.ids.sarah, 'sarah@example.com');
  identities.setInvite(f.db, f.josh, f.ids.cole, 'cole@example.com');
}
const passwordLogin = (f, username, password = PASSWORD) => auth.login(f.db, { username, password, ip: '5.5.5.5' });

test('only an Owner switches it, and only when the server can do Google and nobody would be locked out', async () => {
  const f = await fixture();
  for (const ctx of [f.rayne, f.mark, f.sarah, f.cole]) assert.throws(() => identities.setRequireGoogle(f.db, ctx, true, { googleAvailable: true }), /not allowed/i);
  assert.throws(() => identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: false }), /set up google sign-in first/i);
  // nobody is linked or invited yet: it says who needs an invitation and does not switch on
  assert.throws(() => identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true }), /Rayne, Mark, Sarah, Cole/);
  assert.equal(orgs.getOrganization(f.db, f.josh).requireGoogle, false);
  link(f, f.rayne, 'rayne');
  assert.throws(() => identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true }), /Mark, Sarah, Cole/);
  // deactivated people do not count
  members.updateMember(f.db, f.josh, f.ids.cole, { isActive: false });
  link(f, f.mark, 'mark');
  assert.throws(() => identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true }), /Sarah/);
  identities.setInvite(f.db, f.josh, f.ids.sarah, 'sarah@example.com');
  assert.equal(identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true }).requireGoogle, true);
  assert.equal(orgs.getOrganization(f.db, f.josh).requireGoogle, true);
  assert.equal(identities.setRequireGoogle(f.db, f.josh, false, { googleAvailable: false }).requireGoogle, false); // off needs nothing
});

test('while it is on, non-Owners are refused a correct password and Owners are not', async () => {
  const f = await fixture();
  ready(f);
  assert.equal((await passwordLogin(f, 'mark')).ok, true); // fine before it is on
  identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true });
  for (const u of ['rayne', 'mark', 'sarah', 'cole']) {
    const r = await passwordLogin(f, u);
    assert.deepEqual([r.ok, r.status], [false, 403], u);
    assert.match(r.error, /requires signing in with google/i);
  }
  assert.equal((await passwordLogin(f, 'josh')).ok, true);
  // a wrong password is still just "wrong", and says nothing about the setting
  assert.deepEqual([(await passwordLogin(f, 'mark', 'nope nope nope')).status, (await passwordLogin(f, 'nobody-here', 'x')).status], [401, 401]);
  // Google still works
  const g = identities.loginWithGoogle(f.db, { sub: 'g-mark', email: 'mark@example.com', name: 'Mark' }, { ip: '6.6.6.6', userAgent: 't' });
  assert.equal(g.ok, true);
  // and switching it off brings passwords back
  identities.setRequireGoogle(f.db, f.josh, false, { googleAvailable: true });
  assert.equal((await passwordLogin(f, 'mark')).ok, true);
});

test('switching it on ends the sessions of non-Owners, and not the Owner\'s', async () => {
  const f = await fixture();
  ready(f);
  const mark = await passwordLogin(f, 'mark');
  const josh = await passwordLogin(f, 'josh');
  identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true });
  assert.equal(auth.resolveSession(f.db, mark.session.token), null);
  assert.ok(auth.resolveSession(f.db, josh.session.token));
});

test('nobody can be locked out while it is on', async () => {
  const f = await fixture();
  ready(f);
  identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true });
  // a new non-Owner needs a Google email
  await assert.rejects(() => members.createMember(f.db, f.josh, { username: 'pwonly', displayName: 'P', role: 'employee', password: PASSWORD }), /google email/i);
  assert.equal((await members.createMember(f.db, f.josh, { username: 'withg1', displayName: 'G', role: 'employee', googleEmail: 'g1@example.com' })).role, 'employee');
  assert.equal((await members.createMember(f.db, f.josh, { username: 'owner2', displayName: 'O', role: 'owner', password: PASSWORD })).role, 'owner'); // another Owner may use a password
  // an Owner cannot be demoted to a role that needs Google unless they are linked or invited
  const o2 = members.listMembers(f.db, f.josh).find((m) => m.username === 'owner2');
  assert.throws(() => members.updateMember(f.db, f.josh, o2.id, { role: 'admin' }), /google/i);
  identities.setInvite(f.db, f.josh, o2.id, 'owner2@example.com');
  assert.equal(members.updateMember(f.db, f.josh, o2.id, { role: 'admin' }).role, 'admin');
  // non-Owners cannot unlink Google; Owners cannot turn off their own password
  assert.throws(() => identities.unlink(f.db, f.mark), /requires/i);
  link(f, f.josh, 'josh');
  assert.throws(() => identities.setPasswordLogin(f.db, f.josh, f.ids.josh, false), /owners keep password/i);
  identities.setRequireGoogle(f.db, f.josh, false, { googleAvailable: true });
  assert.equal(identities.setPasswordLogin(f.db, f.josh, f.ids.josh, false).passwordLogin, false); // allowed again once it is off
});

test('it applies to one agency only, and is logged', async () => {
  const f = await fixture();
  ready(f);
  identities.setRequireGoogle(f.db, f.josh, true, { googleAvailable: true });
  assert.equal(orgs.getOrganization(f.db, f.zed).requireGoogle, false);
  assert.equal((await passwordLogin(f, 'zed')).ok, true);
  identities.setRequireGoogle(f.db, f.josh, false, { googleAvailable: true });
  const rows = listActivity(f.db, f.josh).filter((a) => a.action === 'org.require_google');
  assert.deepEqual(rows.map((a) => [a.before.requireGoogle, a.after.requireGoogle]), [[true, false], [false, true]]);
});
