// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');
const { GoogleError } = require('../server/google');

const EMAIL = 'agencyos@project.iam.gserviceaccount.com';
function fakeGoogle() {
  const month = (d) => Number(d.slice(5, 7));
  return {
    email: EMAIL,
    listSites: async () => [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteRestrictedUser' }],
    listProperties: async () => [{ id: '111', name: 'Acme site', account: 'Acme' }],
    searchAnalytics: async (site, { startDate }) => ({ clicks: month(startDate) * 10, impressions: 1000, ctr: 0.03, position: 8 }),
    ga4Totals: async (id, { startDate }) => ({ sessions: month(startDate) * 100, users: 50, conversions: 2, organicSessions: 40 }),
  };
}

test('Google over HTTP: status, choose, connect, numbers appear, sync, disconnect', async () => {
  const app = await setUp({ google: fakeGoogle() });
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const c = (await mark.call('POST', '/clients', { name: 'Acme' })).data;

  assert.deepEqual((await mark.call('GET', '/integrations/google')).data, { configured: true, email: EMAIL });
  assert.deepEqual((await sarah.call('GET', '/integrations/google')).data, { configured: true, email: null });
  assert.equal((await cole.call('GET', '/integrations/google')).status, 403);
  assert.equal((await sarah.call('GET', '/integrations/google/available')).status, 403);
  const avail = (await mark.call('GET', '/integrations/google/available')).data;
  assert.deepEqual([avail.sites[0].siteUrl, avail.properties[0].id], ['sc-domain:acme.example', '111']);

  assert.equal((await mark.call('GET', `/clients/${c.id}/google`)).data, null);
  assert.equal((await sarah.call('PUT', `/clients/${c.id}/google`, { gscSiteUrl: 'sc-domain:acme.example' })).status, 403);
  assert.equal((await mark.call('PUT', `/clients/${c.id}/google`, {})).status, 400);
  assert.equal((await mark.call('PUT', `/clients/${c.id}/google`, { gscSiteUrl: 'https://nope.example/' })).status, 400);
  const out = (await mark.call('PUT', `/clients/${c.id}/google`, { gscSiteUrl: 'sc-domain:acme.example', ga4PropertyId: '111' })).data;
  assert.deepEqual([out.link.gscSiteUrl, out.link.ga4PropertyId, out.sync.status, out.sync.recorded > 0], ['sc-domain:acme.example', '111', 'ok', true]);
  assert.equal((await sarah.call('GET', `/clients/${c.id}/google`)).data.lastSyncStatus, 'ok');

  const metrics = (await sarah.call('GET', `/clients/${c.id}/metrics`)).data;
  assert.ok(metrics.some((m) => m.metric === 'Search clicks') && metrics.some((m) => m.metric === 'Organic sessions'));
  const synced = (await sarah.call('GET', `/clients/${c.id}/results?metric=Search%20clicks`)).data[0];
  assert.deepEqual([synced.source, synced.recordedByName], ['gsc', null]);
  assert.equal((await mark.call('PATCH', `/results/${synced.id}`, { value: 1 })).status, 400);

  assert.equal((await mark.call('POST', `/clients/${c.id}/google/sync`, { months: 2 })).data.months, 2);
  assert.equal((await mark.call('POST', `/clients/${c.id}/google/sync`, { months: 99 })).status, 400);
  assert.equal((await sarah.call('POST', `/clients/${c.id}/google/sync`, {})).status, 403);
  assert.equal((await mark.call('DELETE', `/clients/${c.id}/google`)).status, 200);
  assert.equal((await mark.call('GET', `/clients/${c.id}/google`)).data, null);
  assert.ok((await sarah.call('GET', `/clients/${c.id}/metrics`)).data.length > 0); // numbers stay
  const log = (await o.call('GET', '/activity?limit=100')).data.map((a) => a.action);
  for (const a of ['integration.connect', 'integration.sync', 'integration.disconnect']) assert.ok(log.includes(a), a);
  for (const [m, path] of [['GET', '/integrations/google'], ['GET', '/clients/1/google'], ['PUT', '/clients/1/google'], ['POST', '/clients/1/google/sync'], ['DELETE', '/clients/1/google']]) assert.equal((await app.client().call(m, path, ['PUT', 'POST'].includes(m) ? {} : undefined)).status, 401, `${m} ${path}`);
  await app.close();
});

test('a Google problem comes back as a plain message, and a server without a key says so', async () => {
  const broken = fakeGoogle();
  broken.listSites = async () => { throw new GoogleError(`Google refused access. Add ${EMAIL} as a read-only user (a viewer) for this property`); };
  const app = await setUp({ google: broken });
  const c = (await app.owner.call('POST', '/clients', { name: 'Acme' })).data;
  const avail = (await app.owner.call('GET', '/integrations/google/available')).data;
  assert.deepEqual(avail.sites, []);
  assert.match(avail.problems[0], /Search Console: Google refused access/);
  const r = await app.owner.call('PUT', `/clients/${c.id}/google`, { gscSiteUrl: 'sc-domain:acme.example' });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /refused access/);
  await app.close();

  const none = await setUp();
  assert.deepEqual((await none.owner.call('GET', '/integrations/google')).data, { configured: false, email: null });
  assert.equal((await none.owner.call('GET', '/integrations/google/available')).status, 400);
  assert.equal((await none.owner.call('PUT', '/clients/1/google', { ga4PropertyId: '1' })).status, 400);
  await none.close();
});
