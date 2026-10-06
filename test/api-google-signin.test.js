// Joshua Nunez
// Sign in with Google over HTTP, with Google replaced by a fake. The browser's steps are done with plain requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setUp } = require('./support/http');
const { createHub } = require('../server/googlehub');

const APP = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'shh-secret' };

// A fake Google. `google.next` is who signs in next; the nonce is taken from the address the server built.
function setupGoogle() {
  const google = { next: { sub: 'g-1', email: 'josh@example.com', name: 'Josh' }, nonce: '' };
  const fetchImpl = async (url, init = {}) => {
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(init.body);
      if (form.get('code') === 'bad-code') return reply({ error: 'invalid_grant' }, 400);
      const claims = { iss: 'https://accounts.google.com', aud: APP.clientId, sub: google.next.sub, email: google.next.email, email_verified: google.next.verified !== false, name: google.next.name, nonce: google.nonce, exp: 9_999_999_999 };
      return reply({ id_token: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`, access_token: 'a' });
    }
    throw new Error(`unexpected request to ${url}`);
  };
  const factory = (db) => createHub({ db, oauthApp: APP, keyFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-gs-')), 'google-token.key'), fetchImpl });
  return { google, factory };
}

const cookieOf = (res, name) => {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const hit = all.find((c) => c && c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0] : '';
};

// Starts a sign-in as nobody (the login page) and returns what Google would send back.
async function startLogin(app, g) {
  const res = await fetch(`${app.base}/auth/google/start`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('location'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  g.nonce = url.searchParams.get('nonce');
  return { state: url.searchParams.get('state'), cookie: cookieOf(res, 'agencyos_gstate'), url };
}
const finishLogin = (app, { state, cookie }, code = 'good-code') => fetch(`${app.base}/auth/google/callback?code=${code}&state=${state}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

test('the login page offers Google only when the server can do it', async () => {
  const on = await setUp({ google: setupGoogle().factory });
  assert.equal((await on.client().call('GET', '/status')).data.googleSignIn, true);
  await on.close();
  const off = await setUp();
  assert.equal((await off.client().call('GET', '/status')).data.googleSignIn, false);
  const res = await fetch(`${off.base}/auth/google/start`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/#/signin-failed/setup');
  await off.close();
});

test('an invited member signs in with Google, and the session works like a password one', async () => {
  const { google, factory } = setupGoogle();
  const app = await setUp({ google: factory });
  const invited = await app.owner.call('POST', '/members', { username: 'newbie', displayName: 'New Person', role: 'employee', googleEmail: 'newbie@example.com' });
  assert.equal(invited.status, 200, JSON.stringify(invited.data));
  assert.equal(invited.data.passwordLogin, false);

  google.next = { sub: 'g-newbie', email: 'newbie@example.com', name: 'New Person' };
  const s = await startLogin(app, google);
  assert.match(s.cookie, /^agencyos_gstate=/);
  const res = await finishLogin(app, s);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const sid = cookieOf(res, 'agencyos_sid');
  assert.match(sid, /^agencyos_sid=/);
  const session = await (await fetch(`${app.base}/session`, { headers: { cookie: sid } })).json();
  assert.deepEqual([session.user.displayName, session.role, session.user.mustChangePassword], ['New Person', 'employee', false]);
  assert.ok(res.headers.getSetCookie().some((c) => c.startsWith('agencyos_gstate=;'))); // the state cookie is cleared

  // the next time it is the account id that counts, even if the email changed
  google.next = { sub: 'g-newbie', email: 'renamed@example.com', name: 'New Person' };
  const again = await finishLogin(app, await startLogin(app, google));
  assert.equal(again.headers.get('location'), '/');
  await app.close();
});

test('strangers, unverified emails, a missing cookie and a reused link all get nothing', async () => {
  const { google, factory } = setupGoogle();
  const app = await setUp({ google: factory });
  await app.owner.call('POST', '/members', { username: 'newbie', displayName: 'New Person', role: 'employee', googleEmail: 'newbie@example.com' });
  google.next = { sub: 'g-x', email: 'stranger@example.com', name: 'S' };
  assert.equal((await finishLogin(app, await startLogin(app, google))).headers.get('location'), '/#/signin-failed/no-account');
  google.next = { sub: 'g-y', email: 'newbie@example.com', name: 'N', verified: false };
  assert.equal((await finishLogin(app, await startLogin(app, google))).headers.get('location'), '/#/signin-failed/google'); // an unverified email is refused
  google.next = { sub: 'g-newbie', email: 'newbie@example.com', name: 'N' };
  const s = await startLogin(app, google);
  assert.equal((await finishLogin(app, { state: s.state, cookie: '' })).headers.get('location'), '/#/signin-failed/expired'); // another browser
  assert.equal((await finishLogin(app, { state: s.state, cookie: 'agencyos_gstate=other' })).headers.get('location'), '/#/signin-failed/expired');
  const ok = await startLogin(app, google);
  assert.equal((await finishLogin(app, ok)).headers.get('location'), '/');
  assert.equal((await finishLogin(app, ok)).headers.get('location'), '/#/signin-failed/expired'); // used once
  assert.equal((await finishLogin(app, await startLogin(app, google), 'bad-code')).headers.get('location'), '/#/signin-failed/google');
  assert.equal((await fetch(`${app.base}/auth/google/callback?error=access_denied&state=x`, { redirect: 'manual' })).headers.get('location'), '/#/signin-failed/denied');
  assert.equal((await app.owner.call('GET', '/members')).data.length, 6); // no account was created for anyone
  await app.close();
});

test('a deactivated member cannot sign in with Google', async () => {
  const { google, factory } = setupGoogle();
  const app = await setUp({ google: factory });
  const m = (await app.owner.call('POST', '/members', { username: 'newbie', displayName: 'New Person', role: 'employee', googleEmail: 'newbie@example.com' })).data;
  assert.equal((await app.owner.call('PATCH', `/members/${m.id}`, { isActive: false })).status, 200);
  google.next = { sub: 'g-newbie', email: 'newbie@example.com', name: 'N' };
  assert.equal((await finishLogin(app, await startLogin(app, google))).headers.get('location'), '/#/signin-failed/disabled');
  await app.close();
});

test('a signed-in person links Google from their profile; only they can finish it', async () => {
  const { google, factory } = setupGoogle();
  const app = await setUp({ google: factory });
  const sarah = app.client(); await sarah.signIn('sarah');
  const mark = app.client(); await mark.signIn('mark');
  assert.deepEqual((await sarah.call('GET', '/profile/google')).data, { linked: false, email: null, pendingEmail: null, passwordLogin: true, canUnlink: false, canTurnOffPassword: false });

  google.next = { sub: 'g-sarah', email: 'sarah@example.com', name: 'Sarah' };
  const start = await sarah.call('POST', '/profile/google/start', {}, { raw: true });
  assert.equal(start.res.status, 200);
  const url = new URL(start.data.url);
  google.nonce = url.searchParams.get('nonce');
  const gstate = cookieOf(start.res, 'agencyos_gstate');
  const state = url.searchParams.get('state');
  // someone else's session cannot finish her link
  assert.equal((await mark.raw('GET', `/auth/google/callback?code=c&state=${state}`, gstate)).headers.get('location'), '/#/google/link-failed/expired');
  // a new attempt, finished by her
  const again = await sarah.call('POST', '/profile/google/start', {}, { raw: true });
  const u2 = new URL(again.data.url);
  google.nonce = u2.searchParams.get('nonce');
  const done = await sarah.raw('GET', `/auth/google/callback?code=c&state=${u2.searchParams.get('state')}`, cookieOf(again.res, 'agencyos_gstate'));
  assert.equal(done.headers.get('location'), '/#/google/linked');
  assert.deepEqual((await sarah.call('GET', '/profile/google')).data, { linked: true, email: 'sarah@example.com', pendingEmail: null, passwordLogin: true, canUnlink: true, canTurnOffPassword: true });
  // her Google account now signs her in
  const login = await finishLogin(app, await startLogin(app, google));
  assert.equal(login.headers.get('location'), '/');
  const session = await (await fetch(`${app.base}/session`, { headers: { cookie: cookieOf(login, 'agencyos_sid') } })).json();
  assert.equal(session.user.username, 'sarah');
  // the same Google account cannot be linked to Mark too
  const m = await mark.call('POST', '/profile/google/start', {}, { raw: true });
  const mu = new URL(m.data.url);
  google.nonce = mu.searchParams.get('nonce');
  assert.equal((await mark.raw('GET', `/auth/google/callback?code=c&state=${mu.searchParams.get('state')}`, cookieOf(m.res, 'agencyos_gstate'))).headers.get('location'), '/#/google/link-failed/taken');
  await app.close();
});

test('invitations, Google only, and unlinking over HTTP, with the last-way-in rule', async () => {
  const { google, factory } = setupGoogle();
  const app = await setUp({ google: factory });
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');
  // who may invite
  assert.equal((await mark.call('PUT', '/members/4/google', { email: 'x@example.com' })).status, 403);
  assert.deepEqual((await o.call('PUT', '/members/4/google', { email: 'sarah@example.com' })).data, { email: 'sarah@example.com', pending: true });
  assert.equal((await sarah.call('GET', '/profile/google')).data.pendingEmail, 'sarah@example.com');
  google.next = { sub: 'g-sarah', email: 'sarah@example.com', name: 'Sarah' };
  assert.equal((await finishLogin(app, await startLogin(app, google))).headers.get('location'), '/'); // the invitation is used
  assert.equal((await sarah.call('GET', '/profile/google')).data.linked, true);
  // Google only: she can turn off her password, Mark cannot do it for her, an Owner can
  assert.equal((await mark.call('POST', '/members/4/password-login', { enabled: false })).status, 403);
  assert.equal((await mark.call('POST', '/profile/password-login', { enabled: false })).status, 400); // Mark has no Google linked
  assert.equal((await sarah.call('POST', '/profile/password-login', { enabled: false })).data.passwordLogin, false);
  assert.equal((await app.client().signIn('sarah')).status, 401); // her password no longer works
  assert.equal((await sarah.call('DELETE', '/profile/google')).status, 400); // she would be locked out
  assert.equal((await o.call('POST', '/members/4/reset-password', { password: 'brand new password 1' })).status, 200);
  const back = app.client();
  assert.equal((await back.signIn('sarah', 'brand new password 1')).status, 200);
  const must = (await back.call('GET', '/session')).data;
  assert.equal(must.user.mustChangePassword, true);
  await app.close();
});
