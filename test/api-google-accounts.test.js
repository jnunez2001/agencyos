// Joshua Nunez
// Sign in with Google over HTTP, with Google replaced by a fake. The browser steps are done with plain requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setUp } = require('./support/http');
const { createHub } = require('../server/googlehub');

const APP = { clientId: 'client-123.apps.googleusercontent.com', clientSecret: 'shh-secret' };

// A fake Google that knows one account, josh@example.com, with one site and one property.
function fakeFetch(options = {}) {
  const month = (d) => Number(d.slice(5, 7));
  return async (url, init = {}) => {
    const u = String(url);
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (u.includes('oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'authorization_code') return form.get('code') === 'good-code' ? reply({ access_token: 'at', refresh_token: 'rt-1', scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly openid email' }) : reply({ error: 'invalid_grant' }, 400);
      return options.withdrawn ? reply({ error: 'invalid_grant' }, 400) : reply({ access_token: 'at-refreshed', expires_in: 3600 });
    }
    if (u.includes('openidconnect.googleapis.com')) return reply({ email: 'josh@example.com' });
    if (u.includes('/revoke')) return reply({});
    if (u.includes('searchAnalytics')) return reply({ rows: [{ clicks: month(JSON.parse(init.body).startDate) * 10, impressions: 1000, ctr: 0.03, position: 8 }] });
    if (u.includes('webmasters/v3/sites')) return reply({ siteEntry: [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteOwner' }, { siteUrl: 'https://beta.example/', permissionLevel: 'siteFullUser' }] });
    if (u.includes('accountSummaries')) return reply({ accountSummaries: [{ displayName: 'Acme', propertySummaries: [{ property: 'properties/111', displayName: 'Acme site' }] }] });
    if (u.includes(':runReport')) return reply({ rows: [{ metricValues: [{ value: '500' }, { value: '300' }, { value: '9' }] }] });
    throw new Error(`unexpected request to ${u}`);
  };
}
const hubFor = (options) => (db) => createHub({ db, oauthApp: APP, keyFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-gh-')), 'google-token.key'), fetchImpl: fakeFetch(options) });

// Starts the sign-in as `who` and returns the state Google would send back.
async function begin(who, returnTo = 'settings') {
  const r = await who.call('POST', '/integrations/google/accounts/start', { returnTo });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const url = new URL(r.data.url);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  return url.searchParams.get('state');
}
const callback = (who, state, code = 'good-code') => who.raw('GET', `/integrations/google/callback?code=${code}&state=${state}`);
const where = (res) => res.headers.get('location');

test('adding a Google account: start, approve, and the account shows in the picker', async () => {
  const app = await setUp({ google: hubFor() });
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');

  assert.equal((await mark.call('POST', '/integrations/google/accounts/start', {})).status, 403); // Owner and Admin add accounts
  const off = (await o.call('GET', '/integrations/google')).data;
  assert.deepEqual([off.signIn, off.accounts, off.canManageAccounts, off.configured], [{ configured: true }, [], true, false]);

  const state = await begin(o, 'clients-1');
  const res = await callback(o, state);
  assert.equal(res.status, 302);
  assert.equal(where(res), '/#/google/ok/clients-1');
  const seen = (await o.call('GET', '/integrations/google')).data;
  assert.deepEqual(seen.accounts.map((a) => [a.email, a.status, a.clients]), [['josh@example.com', 'ok', 0]]);
  assert.equal(seen.configured, true);
  assert.deepEqual((await mark.call('GET', '/integrations/google')).data.accounts.map((a) => a.email), ['josh@example.com']); // managers see it to connect clients
  assert.deepEqual((await sarah.call('GET', '/integrations/google')).data.accounts, []);

  const choices = (await mark.call('GET', '/integrations/google/choices')).data;
  assert.equal(choices.length, 1);
  assert.deepEqual([choices[0].label, choices[0].kind, choices[0].sites.map((s) => s.siteUrl), choices[0].properties.map((p) => p.id), choices[0].problems], ['josh@example.com', 'account', ['sc-domain:acme.example', 'https://beta.example/'], ['111'], []]);
  assert.equal((await sarah.call('GET', '/integrations/google/choices')).status, 403);

  const log = (await o.call('GET', '/activity?limit=50')).data.map((a) => a.action);
  assert.ok(log.includes('integration.account_add'));
  await app.close();
});

test('the callback only works for the person who started it, once, and says what went wrong', async () => {
  const app = await setUp({ google: hubFor() });
  const o = app.owner;
  const rayne = app.client(); await rayne.signIn('rayne');
  const state = await begin(o);
  assert.equal(where(await callback(rayne, state)), '/#/google/failed/expired'); // someone else's link
  assert.equal(where(await callback(o, state)), '/#/google/ok/settings');
  assert.equal(where(await callback(o, state)), '/#/google/failed/expired'); // used once
  assert.equal(where(await callback(o, 'made-up')), '/#/google/failed/expired');
  assert.equal(where(await o.raw('GET', '/integrations/google/callback?error=access_denied&state=x')), '/#/google/failed/denied');
  assert.equal(where(await callback(o, await begin(o), 'bad-code')), '/#/google/failed/google');
  assert.equal((await app.client().raw('GET', '/integrations/google/callback?code=x&state=y')).status, 401);
  assert.equal((await o.call('POST', '/integrations/google/accounts/start', { returnTo: 'https://evil.example' })).status, 200); // sanitized, never trusted
  await app.close();
});

test('a manager connects a client through the account, the numbers sync, and removing the account disconnects it', async () => {
  const app = await setUp({ google: hubFor() });
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const c = (await mark.call('POST', '/clients', { name: 'Acme' })).data;
  await callback(o, await begin(o));
  const account = (await o.call('GET', '/integrations/google')).data.accounts[0];

  assert.equal((await mark.call('PUT', `/clients/${c.id}/google`, { source: '999', gscSiteUrl: 'sc-domain:acme.example' })).status, 400);
  const nope = await mark.call('PUT', `/clients/${c.id}/google`, { source: String(account.id), gscSiteUrl: 'https://not-mine.example/' });
  assert.equal(nope.status, 400);
  assert.match(nope.data.error, /not available to josh@example\.com/);
  const done = (await mark.call('PUT', `/clients/${c.id}/google`, { source: String(account.id), gscSiteUrl: 'sc-domain:acme.example', ga4PropertyId: '111' })).data;
  assert.deepEqual([done.link.source, done.link.accountEmail, done.sync.status, done.sync.recorded > 0], [String(account.id), 'josh@example.com', 'ok', true]);
  assert.ok((await mark.call('GET', `/clients/${c.id}/metrics`)).data.some((m) => m.metric === 'Search clicks'));
  assert.equal((await mark.call('POST', `/clients/${c.id}/google/sync`, { months: 2 })).data.status, 'ok');
  assert.equal((await o.call('GET', '/integrations/google')).data.accounts[0].clients, 1);

  assert.equal((await mark.call('DELETE', `/integrations/google/accounts/${account.id}`)).status, 403);
  assert.equal((await o.call('DELETE', `/integrations/google/accounts/${account.id}`)).data.disconnected, 1);
  assert.equal((await mark.call('GET', `/clients/${c.id}/google`)).data, null);
  assert.ok((await mark.call('GET', `/clients/${c.id}/metrics`)).data.length > 0); // numbers stay
  assert.deepEqual((await o.call('GET', '/integrations/google')).data.accounts, []);
  assert.equal((await o.call('DELETE', `/integrations/google/accounts/${account.id}`)).status, 404);
  const log = (await o.call('GET', '/activity?limit=100')).data.map((a) => a.action);
  assert.ok(log.includes('integration.account_remove'));
  await app.close();
});

test('withdrawn access shows as needing a reconnect and in the sync result', async () => {
  const app = await setUp({ google: hubFor({ withdrawn: true }) });
  const o = app.owner;
  const c = (await o.call('POST', '/clients', { name: 'Acme' })).data;
  await callback(o, await begin(o));
  const account = (await o.call('GET', '/integrations/google')).data.accounts[0];
  const choices = (await o.call('GET', '/integrations/google/choices')).data;
  assert.match(choices[0].problems.join(' '), /withdrawn or has expired/);
  assert.equal((await o.call('GET', '/integrations/google')).data.accounts[0].status, 'needs_reconnect');
  const r = await o.call('PUT', `/clients/${c.id}/google`, { source: String(account.id), ga4PropertyId: '111' });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /Reconnect/);
  // signing in again repairs it
  await callback(o, await begin(o));
  assert.equal((await o.call('GET', '/integrations/google')).data.accounts[0].status, 'ok');
  await app.close();
});

test('a server without a Google OAuth client says so', async () => {
  const none = await setUp({ google: (db) => createHub({ db, keyFile: path.join(os.tmpdir(), 'agencyos-none.key') }) });
  const r = await none.owner.call('POST', '/integrations/google/accounts/start', {});
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not set up/);
  assert.deepEqual((await none.owner.call('GET', '/integrations/google/choices')).data, []);
  await none.close();
});
