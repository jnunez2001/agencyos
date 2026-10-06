// Joshua Nunez
// The Google client, with Google replaced by a fake. A real RSA key proves the sign-in token is signed correctly.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGoogle, loadGoogle, GoogleError } = require('../server/google');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const KEY = { client_email: 'agencyos@project.iam.gserviceaccount.com', private_key: privateKey };

// A fake Google: records requests and answers by URL.
function fake(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    for (const [match, answer] of Object.entries(handlers)) {
      if (String(url).includes(match)) {
        const out = typeof answer === 'function' ? answer(init, calls.length) : answer;
        return { ok: out.status === undefined || out.status < 400, status: out.status || 200, json: async () => out.body, text: async () => JSON.stringify(out.body) };
      }
    }
    throw new Error(`unexpected request to ${url}`);
  };
  return { calls, fetchImpl };
}
const TOKEN = { 'oauth2.googleapis.com/token': { body: { access_token: 'tok-1', expires_in: 3600 } } };

test('the sign-in token is a correctly signed service account assertion, and is reused until it expires', async () => {
  let t = 1_000_000_000_000;
  const f = fake({ ...TOKEN, 'webmasters/v3/sites': { body: { siteEntry: [] } } });
  const g = createGoogle({ key: KEY, fetchImpl: f.fetchImpl, now: () => t });
  await g.listSites();
  await g.listSites();
  const tokenCalls = f.calls.filter((c) => c.url.includes('oauth2'));
  assert.equal(tokenCalls.length, 1);
  const form = new URLSearchParams(tokenCalls[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, p, sig] = form.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual([claims.iss, claims.aud, claims.iat, claims.exp - claims.iat], [KEY.client_email, 'https://oauth2.googleapis.com/token', 1_000_000_000, 3600]);
  assert.match(claims.scope, /webmasters\.readonly/);
  assert.match(claims.scope, /analytics\.readonly/);
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url')));
  assert.equal(f.calls.find((c) => c.url.includes('webmasters')).headers.authorization, 'Bearer tok-1');
  t += 3_550_000; // inside the last minute before expiry: a fresh token is fetched
  await g.listSites();
  assert.equal(f.calls.filter((c) => c.url.includes('oauth2')).length, 2);
});

test('sites and properties come back as simple lists; unverified sites are left out', async () => {
  const f = fake({
    ...TOKEN,
    'webmasters/v3/sites': { body: { siteEntry: [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'https://old.example/', permissionLevel: 'siteUnverifiedUser' }, { siteUrl: 'https://beta.example/', permissionLevel: 'siteFullUser' }] } },
    'accountSummaries': { body: { accountSummaries: [{ displayName: 'Acme account', propertySummaries: [{ property: 'properties/111', displayName: 'Acme site' }, { property: 'properties/222', displayName: 'Acme app' }] }, { displayName: 'Beta', propertySummaries: [{ property: 'properties/333', displayName: 'Beta site' }] }] } },
  });
  const g = createGoogle({ key: KEY, fetchImpl: f.fetchImpl });
  assert.deepEqual(await g.listSites(), [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'https://beta.example/', permissionLevel: 'siteFullUser' }]);
  assert.deepEqual(await g.listProperties(), [{ id: '111', name: 'Acme site', account: 'Acme account' }, { id: '222', name: 'Acme app', account: 'Acme account' }, { id: '333', name: 'Beta site', account: 'Beta' }]);
  assert.equal(g.email, KEY.client_email);
});

test('Search Console: one row of totals for a date range, or nothing when Google has no data', async () => {
  const f = fake({ ...TOKEN, 'searchAnalytics/query': (init, n) => (n > 2 ? { body: {} } : { body: { rows: [{ clicks: 120, impressions: 4000, ctr: 0.03, position: 8.4567 }] } }) });
  const g = createGoogle({ key: KEY, fetchImpl: f.fetchImpl });
  const r = await g.searchAnalytics('sc-domain:acme.example', { startDate: '2026-09-01', endDate: '2026-09-30' });
  assert.deepEqual(r, { clicks: 120, impressions: 4000, ctr: 0.03, position: 8.4567 });
  const call = f.calls.find((c) => c.url.includes('searchAnalytics'));
  assert.ok(call.url.includes(encodeURIComponent('sc-domain:acme.example')));
  assert.deepEqual(JSON.parse(call.body), { startDate: '2026-09-01', endDate: '2026-09-30' });
  assert.equal(await g.searchAnalytics('sc-domain:acme.example', { startDate: '2020-01-01', endDate: '2020-01-31' }), null);
});

test('Analytics: totals and the Organic Search channel for a date range', async () => {
  const f = fake({ ...TOKEN, 'analyticsdata.googleapis.com/v1beta/properties/111:runReport': (init) => {
    const body = JSON.parse(init.body);
    if (body.dimensionFilter) return { body: { rows: [{ metricValues: [{ value: '640' }] }] } };
    return { body: { rows: [{ metricValues: [{ value: '1500' }, { value: '1100' }, { value: '37' }] }] } };
  } });
  const g = createGoogle({ key: KEY, fetchImpl: f.fetchImpl });
  assert.deepEqual(await g.ga4Totals('111', { startDate: '2026-09-01', endDate: '2026-09-30' }), { sessions: 1500, users: 1100, conversions: 37, organicSessions: 640 });
  const bodies = f.calls.filter((c) => c.url.includes('runReport')).map((c) => JSON.parse(c.body));
  assert.deepEqual(bodies[0].metrics.map((m) => m.name), ['sessions', 'totalUsers', 'keyEvents']);
  assert.deepEqual(bodies[0].dateRanges, [{ startDate: '2026-09-01', endDate: '2026-09-30' }]);
  assert.deepEqual(bodies[1].dimensionFilter.filter, { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } });
  await assert.rejects(() => g.ga4Totals('abc', { startDate: '2026-09-01', endDate: '2026-09-30' }), /property/i);
});

test('Analytics: no rows means no data; an empty organic channel is zero', async () => {
  const none = fake({ ...TOKEN, 'runReport': { body: {} } });
  assert.equal(await createGoogle({ key: KEY, fetchImpl: none.fetchImpl }).ga4Totals('111', { startDate: '2020-01-01', endDate: '2020-01-31' }), null);
  const noOrganic = fake({ ...TOKEN, 'runReport': (init) => (JSON.parse(init.body).dimensionFilter ? { body: {} } : { body: { rows: [{ metricValues: [{ value: '5' }, { value: '4' }, { value: '0' }] }] } }) });
  assert.deepEqual(await createGoogle({ key: KEY, fetchImpl: noOrganic.fetchImpl }).ga4Totals('111', { startDate: '2026-09-01', endDate: '2026-09-30' }), { sessions: 5, users: 4, conversions: 0, organicSessions: 0 });
});

test('Google problems become plain messages that say what to do', async () => {
  const email = KEY.client_email;
  const deny = createGoogle({ key: KEY, fetchImpl: fake({ ...TOKEN, 'searchAnalytics': { status: 403, body: { error: { message: 'User does not have sufficient permission' } } } }).fetchImpl });
  await assert.rejects(() => deny.searchAnalytics('sc-domain:x.example', { startDate: '2026-09-01', endDate: '2026-09-30' }), (e) => e instanceof GoogleError && e.message.includes(email) && /read-only|viewer/i.test(e.message));
  const missing = createGoogle({ key: KEY, fetchImpl: fake({ ...TOKEN, 'runReport': { status: 404, body: {} } }).fetchImpl });
  await assert.rejects(() => missing.ga4Totals('999', { startDate: '2026-09-01', endDate: '2026-09-30' }), /could not find/i);
  const slow = createGoogle({ key: KEY, fetchImpl: fake({ ...TOKEN, 'runReport': { status: 429, body: {} } }).fetchImpl });
  await assert.rejects(() => slow.ga4Totals('999', { startDate: '2026-09-01', endDate: '2026-09-30' }), /slow down/i);
  const broken = createGoogle({ key: KEY, fetchImpl: fake({ ...TOKEN, 'runReport': { status: 500, body: {} } }).fetchImpl });
  await assert.rejects(() => broken.ga4Totals('999', { startDate: '2026-09-01', endDate: '2026-09-30' }), /error \(500\)/);
  const offline = createGoogle({ key: KEY, fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(() => offline.listSites(), /could not reach google/i);
  const badKey = createGoogle({ key: KEY, fetchImpl: fake({ 'oauth2.googleapis.com/token': { status: 400, body: { error: 'invalid_grant' } } }).fetchImpl });
  await assert.rejects(() => badKey.listSites(), /sign in to google|key/i);
});

test('the key file is loaded and checked; a missing or broken file means Google is not set up', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-google-'));
  const good = path.join(dir, 'key.json');
  fs.writeFileSync(good, JSON.stringify({ type: 'service_account', ...KEY }));
  assert.equal(loadGoogle(good).email, KEY.client_email);
  assert.equal(loadGoogle(''), null);
  assert.equal(loadGoogle(path.join(dir, 'missing.json')), null);
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{not json');
  assert.equal(loadGoogle(broken), null);
  const incomplete = path.join(dir, 'incomplete.json');
  fs.writeFileSync(incomplete, JSON.stringify({ client_email: 'x@y.z' }));
  assert.equal(loadGoogle(incomplete), null);
});
