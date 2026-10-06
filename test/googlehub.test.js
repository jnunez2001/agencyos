// Joshua Nunez
// The hub of Google credentials, with Google replaced by a fake and a real in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../server/db');
const { createHub, loadOAuthApp } = require('../server/googlehub');
const orgs = require('../server/services/organizations');

const APP = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'shh-secret' };
const ORIGIN = 'https://agency.example';

function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body, headers: init.headers || {} });
    for (const [match, answer] of Object.entries(handlers)) {
      if (String(url).includes(match)) {
        const out = typeof answer === 'function' ? answer(init, calls) : answer;
        return { ok: (out.status || 200) < 400, status: out.status || 200, json: async () => out.body, text: async () => JSON.stringify(out.body) };
      }
    }
    throw new Error(`unexpected request to ${url}`);
  };
  return { calls, fetchImpl };
}
const SIGN_IN = {
  'oauth2.googleapis.com/token': (init) => (new URLSearchParams(init.body).get('grant_type') === 'authorization_code'
    ? { body: { access_token: 'at', refresh_token: 'rt-secret-1', scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly openid email' } }
    : { body: { access_token: 'at-refreshed', expires_in: 3600 } }),
  'openidconnect.googleapis.com': { body: { email: 'josh@example.com' } },
  'oauth2.googleapis.com/revoke': { body: {} },
  'webmasters/v3/sites': { body: { siteEntry: [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteOwner' }] } },
};

async function setup(handlers = SIGN_IN, hubOver = {}) {
  const db = openDb(':memory:');
  const a = await orgs.createOrganization(db, { organizationName: 'A', displayName: 'Josh', username: 'josh', password: 'correct horse battery' });
  const b = await orgs.createOrganization(db, { organizationName: 'B', displayName: 'Zed', username: 'zed', password: 'correct horse battery' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-hub-'));
  const f = fakeFetch(handlers);
  const hub = createHub({ db, oauthApp: APP, keyFile: path.join(dir, 'google-token.key'), fetchImpl: f.fetchImpl, ...hubOver });
  return { db, hub, f, dir, a, b };
}
const signIn = async (t, who = t.a) => {
  const url = new URL(t.hub.startSignIn({ origin: ORIGIN, userId: who.userId, organizationId: who.organizationId, returnTo: 'settings' }));
  return t.hub.finishSignIn({ origin: ORIGIN, code: 'the-code', state: url.searchParams.get('state'), userId: who.userId, organizationId: who.organizationId });
};

test('signing in: the address carries a state, and the account is stored with its token encrypted', async () => {
  const t = await setup();
  const url = new URL(t.hub.startSignIn({ origin: ORIGIN, userId: t.a.userId, organizationId: t.a.organizationId, returnTo: 'clients-12' }));
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/integrations/google/callback`);
  assert.equal(url.searchParams.get('client_id'), APP.clientId);
  const out = await t.hub.finishSignIn({ origin: ORIGIN, code: 'the-code', state: url.searchParams.get('state'), userId: t.a.userId, organizationId: t.a.organizationId });
  assert.deepEqual([out.email, out.returnTo, out.reconnected], ['josh@example.com', 'clients-12', false]);
  const row = t.db.prepare('SELECT * FROM google_accounts').get();
  assert.ok(!row.refresh_token_enc.includes('rt-secret-1'));
  assert.ok(!JSON.stringify(t.db.prepare('SELECT * FROM google_accounts').all()).includes('rt-secret-1'));
  assert.equal(t.hub._decrypt(row.refresh_token_enc), 'rt-secret-1');
  assert.deepEqual(t.hub.listAccounts(t.a.organizationId).map((x) => [x.email, x.status, x.clients, x.connectedByName]), [['josh@example.com', 'ok', 0, 'Josh']]);
  assert.deepEqual(t.hub.listAccounts(t.b.organizationId), []);
});

test('the encryption key is its own private file, made on first use and reused after', async () => {
  const t = await setup();
  await signIn(t);
  const keyFile = path.join(t.dir, 'google-token.key');
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(keyFile, 'utf8').length, 64);
  const again = createHub({ db: t.db, oauthApp: APP, keyFile, fetchImpl: t.f.fetchImpl });
  assert.equal(again._decrypt(t.db.prepare('SELECT refresh_token_enc FROM google_accounts').get().refresh_token_enc), 'rt-secret-1');
  // a different key cannot read it
  const other = createHub({ db: t.db, oauthApp: APP, keyFile: path.join(t.dir, 'other.key'), fetchImpl: t.f.fetchImpl });
  assert.throws(() => other._decrypt(t.db.prepare('SELECT refresh_token_enc FROM google_accounts').get().refresh_token_enc));
  assert.equal(other.get(String(t.db.prepare('SELECT id FROM google_accounts').get().id), t.a.organizationId), null);
});

test('the state is random, single use, short lived, and only works for the person and agency that started it', async () => {
  let t0 = 1_000_000_000_000;
  const t = await setup(SIGN_IN, { now: () => t0 });
  const start = (who = t.a) => new URL(t.hub.startSignIn({ origin: ORIGIN, userId: who.userId, organizationId: who.organizationId })).searchParams.get('state');
  const finish = (state, who = t.a, code = 'c') => t.hub.finishSignIn({ origin: ORIGIN, code, state, userId: who.userId, organizationId: who.organizationId });
  const s1 = start();
  assert.notEqual(s1, start());
  await finish(s1);
  await assert.rejects(() => finish(s1), /expired or does not belong/i); // used once
  await assert.rejects(() => finish('made-up'), /expired or does not belong/i);
  await assert.rejects(() => finish(undefined), /expired or does not belong/i);
  await assert.rejects(() => finish(start(), t.b), /expired or does not belong/i); // someone else's session
  const old = start();
  t0 += 11 * 60 * 1000;
  await assert.rejects(() => finish(old), /expired or does not belong/i);
  await assert.rejects(() => finish(start(), t.a, ''), /sign-in code/i);
});

test('signing in again with the same account replaces the token instead of adding a second account', async () => {
  const t = await setup();
  const first = await signIn(t);
  const second = await signIn(t);
  assert.deepEqual([second.accountId, second.reconnected], [first.accountId, true]);
  assert.equal(t.hub.listAccounts(t.a.organizationId).length, 1);
  t.db.prepare("UPDATE google_accounts SET status = 'needs_reconnect'").run();
  await signIn(t);
  assert.equal(t.hub.listAccounts(t.a.organizationId)[0].status, 'ok');
  // the same email in another agency is a separate account
  await signIn(t, t.b);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM google_accounts').get().n, 2);
});

test('an account becomes a Google client that refreshes its own token; the service account is a separate source', async () => {
  const service = { email: 'robot@project.iam.gserviceaccount.com' };
  const t = await setup(SIGN_IN, { serviceClient: service });
  const { accountId } = await signIn(t);
  assert.equal(t.hub.get('service', t.a.organizationId), service);
  assert.equal(t.hub.serviceEmail, service.email);
  const client = t.hub.get(String(accountId), t.a.organizationId);
  assert.equal(client.email, 'josh@example.com');
  assert.equal((await client.listSites())[0].siteUrl, 'sc-domain:acme.example');
  assert.equal(t.hub.get(accountId, t.a.organizationId), client); // reused
  const refresh = t.f.calls.find((c) => c.url.includes('oauth2.googleapis.com/token') && new URLSearchParams(c.body).get('grant_type') === 'refresh_token');
  assert.equal(new URLSearchParams(refresh.body).get('refresh_token'), 'rt-secret-1');
  // another agency cannot use it, and unknown sources give nothing
  assert.equal(t.hub.get(accountId, t.b.organizationId), null);
  assert.equal(t.hub.get('999', t.a.organizationId), null);
  assert.equal(t.hub.get('nonsense', t.a.organizationId), null);
});

test('when Google withdraws access the account is marked as needing a reconnect', async () => {
  const t = await setup({ ...SIGN_IN, 'oauth2.googleapis.com/token': (init) => (new URLSearchParams(init.body).get('grant_type') === 'authorization_code' ? SIGN_IN['oauth2.googleapis.com/token'](init) : { status: 400, body: { error: 'invalid_grant' } }) });
  const { accountId } = await signIn(t);
  await assert.rejects(() => t.hub.get(accountId, t.a.organizationId).listSites(), /withdrawn or has expired/i);
  assert.equal(t.hub.listAccounts(t.a.organizationId)[0].status, 'needs_reconnect');
});

test('removing an account revokes the token at Google, forgets it, and disconnects the clients that used it', async () => {
  const t = await setup();
  const { accountId } = await signIn(t);
  t.db.prepare("INSERT INTO clients (id, organization_id, name) VALUES (1, ?, 'Acme')").run(t.a.organizationId);
  t.db.prepare('INSERT INTO client_google (client_id, organization_id, ga4_property_id, google_account_id) VALUES (1, ?, ?, ?)').run(t.a.organizationId, '111', accountId);
  await assert.rejects(() => t.hub.removeAccount(t.b.organizationId, accountId), /not found/i);
  const out = await t.hub.removeAccount(t.a.organizationId, accountId);
  assert.deepEqual(out, { email: 'josh@example.com', disconnected: 1 });
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM google_accounts').get().n, 0);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM client_google').get().n, 0);
  const revoke = t.f.calls.find((c) => c.url.includes('/revoke'));
  assert.equal(new URLSearchParams(revoke.body).get('token'), 'rt-secret-1');
  assert.equal(t.hub.get(accountId, t.a.organizationId), null);
});

test('sign in with Google is off when there is no OAuth client, and the OAuth client file is read in Google\'s own format', async () => {
  const none = await setup(SIGN_IN, { oauthApp: null });
  assert.equal(none.hub.oauthConfigured, false);
  assert.throws(() => none.hub.startSignIn({ origin: ORIGIN, userId: 1, organizationId: 1 }), /not set up/i);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-oauth-'));
  const plain = path.join(dir, 'plain.json');
  fs.writeFileSync(plain, JSON.stringify({ client_id: 'id1', client_secret: 's1' }));
  const wrapped = path.join(dir, 'wrapped.json');
  fs.writeFileSync(wrapped, JSON.stringify({ web: { client_id: 'id2', client_secret: 's2', redirect_uris: ['x'] } }));
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{nope');
  assert.deepEqual(loadOAuthApp(plain), { clientId: 'id1', clientSecret: 's1' });
  assert.deepEqual(loadOAuthApp(wrapped), { clientId: 'id2', clientSecret: 's2' });
  assert.equal(loadOAuthApp(broken), null);
  assert.equal(loadOAuthApp(path.join(dir, 'missing.json')), null);
  assert.equal(loadOAuthApp(''), null);
});

test('a return target is only ever Settings or a client page', async () => {
  const t = await setup();
  for (const bad of ['https://evil.example', '//evil.example', 'clients-1/../x', 'javascript:alert(1)', 'dashboard']) {
    const url = new URL(t.hub.startSignIn({ origin: ORIGIN, userId: t.a.userId, organizationId: t.a.organizationId, returnTo: bad }));
    const out = await t.hub.finishSignIn({ origin: ORIGIN, code: 'c', state: url.searchParams.get('state'), userId: t.a.userId, organizationId: t.a.organizationId });
    assert.equal(out.returnTo, 'settings', bad);
  }
});

// ---- signing in to AgencyOS ----

test('sign-in to AgencyOS: a state, a nonce and a verifier per attempt, and the claims come back with who started it', async () => {
  let nonce = '';
  const t = await setup({
    'oauth2.googleapis.com/token': (init) => ({ body: { id_token: `h.${Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: APP.clientId, sub: 'g-1', email: 'josh@example.com', email_verified: true, name: 'Josh', nonce, exp: 9_999_999_999 })).toString('base64url')}.s`, access_token: 'a' } }),
  });
  const start = (purpose = 'login', who = {}) => {
    const out = t.hub.startIdentity({ origin: ORIGIN, purpose, ...who });
    const q = new URL(out.url).searchParams;
    nonce = q.get('nonce');
    return { out, q };
  };
  const { out, q } = start('link', { userId: 7, organizationId: 3 });
  assert.equal(q.get('redirect_uri'), `${ORIGIN}/api/auth/google/callback`);
  assert.deepEqual([q.get('scope'), q.get('code_challenge_method'), q.get('state') === out.state], ['openid email profile', 'S256', true]);
  const done = await t.hub.finishIdentity({ origin: ORIGIN, code: 'c', state: out.state });
  assert.deepEqual([done.purpose, done.userId, done.organizationId, done.claims], ['link', 7, 3, { sub: 'g-1', email: 'josh@example.com', name: 'Josh' }]);
  // the code goes with the verifier whose challenge was sent
  const sent = new URLSearchParams(t.f.calls.find((c) => c.url.includes('oauth2.googleapis.com/token')).body);
  assert.equal(require('crypto').createHash('sha256').update(sent.get('code_verifier')).digest('base64url'), q.get('code_challenge'));
  // single use, unknown, and missing code
  await assert.rejects(() => t.hub.finishIdentity({ origin: ORIGIN, code: 'c', state: out.state }), /expired/i);
  await assert.rejects(() => t.hub.finishIdentity({ origin: ORIGIN, code: 'c', state: 'made-up' }), /expired/i);
  const second = start();
  await assert.rejects(() => t.hub.finishIdentity({ origin: ORIGIN, code: '', state: second.out.state }), /sign-in code/i);
  assert.notEqual(start().out.state, start().out.state);
});

test('a sign-in to AgencyOS that takes too long, or that Google refuses, is explained', async () => {
  let t0 = 1_000_000_000_000;
  const t = await setup({ 'oauth2.googleapis.com/token': { status: 400, body: {} } }, { now: () => t0 });
  const a = t.hub.startIdentity({ origin: ORIGIN, purpose: 'login' });
  await assert.rejects(() => t.hub.finishIdentity({ origin: ORIGIN, code: 'c', state: a.state }), (e) => e.status === 502 && /did not accept/i.test(e.message));
  const b = t.hub.startIdentity({ origin: ORIGIN, purpose: 'login' });
  t0 += 11 * 60 * 1000;
  await assert.rejects(() => t.hub.finishIdentity({ origin: ORIGIN, code: 'c', state: b.state }), /expired/i);
  const none = await setup(SIGN_IN, { oauthApp: null });
  assert.throws(() => none.hub.startIdentity({ origin: ORIGIN, purpose: 'login' }), /not set up/i);
});
