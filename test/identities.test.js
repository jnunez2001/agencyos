// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const identities = require('../server/services/identities');
const members = require('../server/services/members');
const auth = require('../server/services/auth');
const { listActivity } = require('../server/services/activity');
const { fixture, PASSWORD } = require('./fixture');

const claims = (over = {}) => ({ sub: 'g-sub-1', email: 'newbie@example.com', name: 'New Person', ...over });
const invite = (f, ctx = f.josh, over = {}) => members.createMember(f.db, ctx, { username: 'newbie', displayName: 'New Person', role: 'employee', googleEmail: 'newbie@example.com', ...over });
const login = (f, c = claims(), ip = '127.0.0.1') => identities.loginWithGoogle(f.db, c, { ip, userAgent: 'test' });

test('a member can be invited with a Google email and no password; they cannot sign in with a password', async () => {
  const f = await fixture();
  const m = await invite(f);
  assert.deepEqual([m.username, m.role, m.passwordLogin, m.google], ['newbie', 'employee', false, { linked: false, email: 'newbie@example.com', pending: true }]);
  assert.equal(m.mustChangePassword, false);
  for (const guess of [PASSWORD, '', 'password1234', 'x'.repeat(40)]) assert.equal((await auth.login(f.db, { username: 'newbie', password: guess, ip: '1.1.1.1' })).ok, false);
  const listed = members.listMembers(f.db, f.josh).find((x) => x.username === 'newbie');
  assert.deepEqual(listed.google, { linked: false, email: 'newbie@example.com', pending: true });
  assert.equal(members.listMembers(f.db, f.sarah).find((x) => x.username === 'newbie').google, undefined); // staff do not see it
});

test('a member needs a password or a Google email; both is allowed; the email is checked', async () => {
  const f = await fixture();
  await assert.rejects(() => members.createMember(f.db, f.josh, { username: 'nobody1', displayName: 'N', role: 'employee' }), /password|google/i);
  await assert.rejects(() => invite(f, f.josh, { username: 'badmail', googleEmail: 'not an email' }), /email/i);
  const both = await invite(f, f.josh, { username: 'both1', googleEmail: 'both@example.com', password: PASSWORD });
  assert.deepEqual([both.passwordLogin, both.mustChangePassword], [true, true]);
  assert.equal((await auth.login(f.db, { username: 'both1', password: PASSWORD, ip: '1.1.1.1' })).ok, true);
});

test('an invited email belongs to one person, and only people who manage members may invite', async () => {
  const f = await fixture();
  await invite(f);
  await assert.rejects(() => invite(f, f.josh, { username: 'dupe1', googleEmail: 'NEWBIE@example.com' }), /already/i);
  for (const ctx of [f.mark, f.sarah, f.cole]) await assert.rejects(() => invite(f, ctx, { username: 'x12345' }), /not allowed/i);
  await assert.rejects(() => invite(f, f.rayne, { username: 'adm1234', role: 'admin', googleEmail: 'adm@example.com' }), /not allowed/i);
});

test('the first Google sign-in with an invited email links the account and signs the person in', async () => {
  const f = await fixture();
  const m = await invite(f);
  const out = await login(f);
  assert.equal(out.ok, true);
  const s = auth.resolveSession(f.db, out.session.token);
  assert.deepEqual([s.user.id, s.user.displayName, s.role, s.user.mustChangePassword, s.organization.id], [m.id, 'New Person', 'employee', false, f.orgId]);
  const row = f.db.prepare('SELECT * FROM user_identities WHERE user_id = ?').get(m.id);
  assert.deepEqual([row.subject, row.provider, !!row.linked_at], ['g-sub-1', 'google', true]);
  assert.deepEqual(members.listMembers(f.db, f.josh).find((x) => x.id === m.id).google, { linked: true, email: 'newbie@example.com', pending: false });
  // from then on the account id decides, even if the Google email changes
  const again = await login(f, claims({ email: 'renamed@example.com' }));
  assert.equal(again.ok, true);
  assert.equal(f.db.prepare('SELECT email FROM user_identities WHERE user_id = ?').get(m.id).email, 'renamed@example.com');
  const log = listActivity(f.db, f.josh).map((a) => a.action);
  assert.ok(log.includes('identity.link') && log.includes('login.success'));
});

test('a Google account that is not linked and not invited gets nothing, and repeated tries are throttled', async () => {
  const f = await fixture();
  await invite(f);
  const stranger = claims({ sub: 'g-other', email: 'stranger@example.com' });
  for (let i = 0; i < 5; i += 1) assert.deepEqual(await login(f, stranger, '9.9.9.9'), { ok: false, reason: 'no-account' });
  assert.deepEqual(await login(f, stranger, '9.9.9.9'), { ok: false, reason: 'locked' });
  assert.equal((await login(f, claims(), '8.8.8.8')).ok, true); // other addresses are not affected
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 7); // nobody was created (6 people and the invited one)
  // an invited email does not work for a different Google account that merely shares a name
  assert.equal((await login(f, claims({ sub: 'g-3', email: 'someone-else@example.com' }), '7.7.7.7')).ok, false);
});

test('deactivated people cannot sign in with Google, and an invite is not used up by them', async () => {
  const f = await fixture();
  const m = await invite(f);
  members.updateMember(f.db, f.josh, m.id, { isActive: false });
  assert.deepEqual(await login(f), { ok: false, reason: 'disabled' });
  assert.equal(f.db.prepare('SELECT subject FROM user_identities WHERE user_id = ?').get(m.id).subject, null);
  members.updateMember(f.db, f.josh, m.id, { isActive: true });
  assert.equal((await login(f)).ok, true);
  members.updateMember(f.db, f.josh, m.id, { isActive: false });
  assert.deepEqual(await login(f), { ok: false, reason: 'disabled' });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(m.id).n, 0);
});

test('a signed-in person links their own Google account', async () => {
  const f = await fixture();
  assert.deepEqual(identities.getMine(f.db, f.sarah), { linked: false, email: null, pendingEmail: null, passwordLogin: true, canUnlink: false, canTurnOffPassword: false });
  const r = identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'sarah@example.com' }));
  assert.equal(r.email, 'sarah@example.com');
  assert.deepEqual(identities.getMine(f.db, f.sarah), { linked: true, email: 'sarah@example.com', pendingEmail: null, passwordLogin: true, canUnlink: true, canTurnOffPassword: true });
  assert.equal((await login(f, claims({ sub: 'g-sarah', email: 'sarah@example.com' }))).ok, true);
  assert.equal(identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'sarah@example.com' })).email, 'sarah@example.com'); // again is fine
  assert.throws(() => identities.completeLink(f.db, f.sarah, claims({ sub: 'g-another', email: 'other@example.com' })), /different Google account is already linked/i);
  assert.throws(() => identities.completeLink(f.db, f.mark, claims({ sub: 'g-sarah', email: 'sarah@example.com' })), /already linked to someone else/i);
  await invite(f);
  assert.throws(() => identities.completeLink(f.db, f.mark, claims({ sub: 'g-mark', email: 'newbie@example.com' })), /invited for another member/i);
});

test('linking an invited member to their own email through the profile uses up the invite', async () => {
  const f = await fixture();
  members.updateMember(f.db, f.josh, f.ids.sarah, {});
  const inv = identities.setInvite(f.db, f.josh, f.ids.sarah, 'sarah@example.com');
  assert.deepEqual([inv.email, inv.pending], ['sarah@example.com', true]);
  identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'sarah@example.com' }));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?').get(f.ids.sarah).n, 1);
  assert.equal(identities.getMine(f.db, f.sarah).linked, true);
});

test('Owner and Admin set, change or clear the invitation of people they manage', async () => {
  const f = await fixture();
  assert.equal(identities.setInvite(f.db, f.rayne, f.ids.sarah, 'a@example.com').email, 'a@example.com');
  assert.equal(identities.setInvite(f.db, f.rayne, f.ids.sarah, 'b@example.com').email, 'b@example.com');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?').get(f.ids.sarah).n, 1);
  assert.equal(identities.setInvite(f.db, f.rayne, f.ids.sarah, null).pending, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_identities').get().n, 0);
  for (const ctx of [f.mark, f.sarah, f.cole]) assert.throws(() => identities.setInvite(f.db, ctx, f.ids.cole, 'x@example.com'), /not allowed/i);
  assert.throws(() => identities.setInvite(f.db, f.rayne, f.ids.josh, 'josh@example.com'), /not allowed/i); // an Admin cannot manage the Owner
  assert.throws(() => identities.setInvite(f.db, f.josh, f.ids.sarah, 'not an email'), /email/i);
  identities.setInvite(f.db, f.josh, f.ids.sarah, 'taken@example.com');
  assert.throws(() => identities.setInvite(f.db, f.josh, f.ids.cole, 'TAKEN@example.com'), /already/i);
  assert.throws(() => identities.setInvite(f.db, f.zed, f.ids.sarah, 'z@example.com'), /not found/i);
  identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'taken@example.com' }));
  assert.throws(() => identities.setInvite(f.db, f.josh, f.ids.sarah, 'new@example.com'), /already linked/i);
});

test('nobody can remove their last way to sign in', async () => {
  const f = await fixture();
  identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'sarah@example.com' }));
  // password sign-in cannot be turned off without a linked account
  assert.throws(() => identities.setPasswordLogin(f.db, f.mark, f.ids.mark, false), /link a google account first/i);
  assert.equal(identities.setPasswordLogin(f.db, f.sarah, f.ids.sarah, false).passwordLogin, false);
  assert.equal((await auth.login(f.db, { username: 'sarah', password: PASSWORD, ip: '1.1.1.1' })).ok, false);
  assert.equal((await login(f, claims({ sub: 'g-sarah', email: 'sarah@example.com' }))).ok, true);
  // and Google cannot be unlinked while password sign-in is off
  assert.throws(() => identities.unlink(f.db, f.sarah), /keep a way to sign in/i);
  // an Owner or Admin resetting the password turns it back on
  await members.resetPassword(f.db, f.rayne, f.ids.sarah, { password: 'brand new password 1' });
  assert.equal(identities.getMine(f.db, f.sarah).passwordLogin, true);
  assert.equal((await auth.login(f.db, { username: 'sarah', password: 'brand new password 1', ip: '1.1.1.1' })).ok, true);
  assert.equal(identities.unlink(f.db, f.sarah).linked, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?').get(f.ids.sarah).n, 0);
  assert.throws(() => identities.unlink(f.db, f.sarah), /not linked/i);
  assert.throws(() => identities.setPasswordLogin(f.db, f.sarah, f.ids.sarah, true), /reset/i);
});

test('turning off password sign-in for someone else follows the management rules and ends their sessions', async () => {
  const f = await fixture();
  identities.completeLink(f.db, f.mark, claims({ sub: 'g-mark', email: 'mark@example.com' }));
  const s = await auth.login(f.db, { username: 'mark', password: PASSWORD, ip: '1.1.1.1' });
  assert.equal(auth.resolveSession(f.db, s.session.token).user.id, f.ids.mark);
  assert.throws(() => identities.setPasswordLogin(f.db, f.sarah, f.ids.mark, false), /not allowed/i);
  assert.throws(() => identities.setPasswordLogin(f.db, f.mark, f.ids.rayne, false), /not allowed/i);
  assert.equal(identities.setPasswordLogin(f.db, f.rayne, f.ids.mark, false).passwordLogin, false);
  assert.equal(auth.resolveSession(f.db, s.session.token), null);
  assert.throws(() => identities.setPasswordLogin(f.db, f.zed, f.ids.mark, false), /not found/i);
});

test('a Google account linked in one agency cannot be used in another, and nothing leaks across', async () => {
  const f = await fixture();
  identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'sarah@example.com' }));
  assert.throws(() => identities.completeLink(f.db, f.zed, claims({ sub: 'g-sarah', email: 'sarah@example.com' })), /already linked to someone else/i);
  assert.deepEqual(members.listMembers(f.db, f.zed).map((m) => m.google), [{ linked: false, email: null, pending: false }]);
  const out = await login(f, claims({ sub: 'g-sarah', email: 'sarah@example.com' }));
  assert.equal(auth.resolveSession(f.db, out.session.token).organization.id, f.orgId);
});

test('linking, unlinking and invitations are logged without secrets', async () => {
  const f = await fixture();
  identities.setInvite(f.db, f.josh, f.ids.sarah, 'sarah@example.com');
  identities.completeLink(f.db, f.sarah, claims({ sub: 'g-sarah', email: 'sarah@example.com' }));
  identities.unlink(f.db, f.sarah);
  const rows = listActivity(f.db, f.josh).filter((a) => a.action.startsWith('identity.')).map((a) => a.action);
  assert.deepEqual(rows, ['identity.unlink', 'identity.link', 'identity.invite']);
  assert.ok(!JSON.stringify(listActivity(f.db, f.josh)).includes('g-sarah'));
});
