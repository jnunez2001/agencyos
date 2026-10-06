// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const gs = require('../server/services/googlesync');
const results = require('../server/services/results');
const reports = require('../server/services/reports');
const clients = require('../server/services/clients');
const { GoogleError } = require('../server/google');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

const EMAIL = 'agencyos@project.iam.gserviceaccount.com';

// A fake Google. Numbers depend on the month so tests can tell months apart.
function fakeGoogle(over = {}) {
  const month = (d) => Number(d.slice(5, 7));
  const calls = { gsc: 0, ga4: 0 };
  return {
    email: EMAIL, calls,
    listSites: async () => [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteRestrictedUser' }],
    listProperties: async () => [{ id: '111', name: 'Acme site', account: 'Acme' }],
    searchAnalytics: async (site, { startDate, endDate }) => { calls.gsc += 1; return { clicks: month(startDate) * 10, impressions: month(startDate) * 1000, ctr: 0.0312345, position: 8.456 }; },
    ga4Totals: async (id, { startDate, endDate }) => { calls.ga4 += 1; return { sessions: month(startDate) * 100, users: month(startDate) * 80, conversions: month(startDate), organicSessions: month(startDate) * 40 }; },
    ...over,
  };
}

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: '2026-10-10' };
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.google = fakeGoogle();
  return f;
}
const LINK = { gscSiteUrl: 'sc-domain:acme.example', ga4PropertyId: '111' };
const rows = (f, where = '') => f.db.prepare(`SELECT metric, value, unit, recorded_on AS recordedOn, source, note FROM client_results WHERE organization_id = ? ${where} ORDER BY recorded_on, metric`).all(f.orgId);

test('status says whether Google is set up, and shows the account email only to people who connect clients', async () => {
  const f = await setup();
  const full = (email, accounts = false) => ({ configured: true, email, serviceAccount: { configured: true, email }, signIn: { configured: false }, accounts: [], canManageAccounts: accounts });
  assert.deepEqual(gs.overview(f.db, f.mark, f.google), full(EMAIL));
  assert.deepEqual(gs.overview(f.db, f.rayne, f.google), full(EMAIL, true));
  assert.deepEqual(gs.overview(f.db, f.sarah, f.google), full(null));
  assert.deepEqual(gs.overview(f.db, f.mark, null), { configured: false, email: null, serviceAccount: { configured: false, email: null }, signIn: { configured: false }, accounts: [], canManageAccounts: false });
  assert.throws(() => gs.overview(f.db, f.cole, f.google), /not allowed/i);
});

test('only Manager and above connect, choose, sync and disconnect; staff can see the connection', async () => {
  const f = await setup();
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  for (const ctx of [f.sarah, f.cole]) {
    await assert.rejects(() => gs.connect(f.db, ctx, f.google, f.client.id, LINK), /not allowed/i);
    await assert.rejects(() => gs.available(f.db, ctx, f.google), /not allowed/i);
    await assert.rejects(() => gs.sync(f.db, ctx, f.google, f.client.id), /not allowed/i);
    assert.throws(() => gs.disconnect(f.db, ctx, f.client.id), /not allowed/i);
  }
  assert.equal(gs.getLink(f.db, f.sarah, f.client.id).gscSiteUrl, 'sc-domain:acme.example');
  assert.throws(() => gs.getLink(f.db, f.cole, f.client.id), /not allowed/i);
  assert.deepEqual(await gs.available(f.db, f.rayne, f.google), { sites: [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteRestrictedUser' }], properties: [{ id: '111', name: 'Acme site', account: 'Acme' }] });
});

test('connecting needs a site or a property that Google can see, and a client of this agency', async () => {
  const f = await setup();
  const conn = (input, g = f.google, ctx = f.mark) => gs.connect(f.db, ctx, g, f.client.id, input);
  await assert.rejects(() => conn({}), /search console site or an analytics property/i);
  await assert.rejects(() => conn({ gscSiteUrl: 'https://other.example/' }), new RegExp(`not shared with ${EMAIL}`.replace(/[.@]/g, '\\$&')));
  await assert.rejects(() => conn({ ga4PropertyId: '999' }), /not shared with/i);
  await assert.rejects(() => conn({ ga4PropertyId: 'abc' }), /number/i);
  await assert.rejects(() => conn(LINK, null), /not set up/i);
  await assert.rejects(() => gs.connect(f.db, f.mark, f.google, 99999, LINK), /not found/i);
  await assert.rejects(() => gs.connect(f.db, f.zed, f.google, f.client.id, LINK), /not found/i);
  assert.equal(gs.getLink(f.db, f.mark, f.client.id), null);
  const only = await conn({ gscSiteUrl: 'sc-domain:acme.example' });
  assert.deepEqual([only.link.gscSiteUrl, only.link.ga4PropertyId], ['sc-domain:acme.example', null]);
});

test('connecting fetches the last 12 completed months for both sources', async () => {
  const f = await setup();
  const out = await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  assert.deepEqual([out.sync.status, out.sync.months, out.sync.recorded, out.sync.errors], ['ok', 12, 96, []]);
  const all = rows(f);
  assert.equal(all.length, 96);
  assert.equal(all[0].recordedOn, '2025-10-31'); // the oldest completed month
  assert.ok(all.every((r) => r.recordedOn <= '2026-09-30')); // the month in progress is not recorded
  const sep = Object.fromEntries(rows(f, "AND recorded_on = '2026-09-30'").map((r) => [r.metric, r]));
  assert.deepEqual(Object.keys(sep).sort(), ['Average position', 'Conversions', 'Organic sessions', 'Search CTR', 'Search clicks', 'Search impressions', 'Sessions', 'Users']);
  assert.deepEqual([sep['Search clicks'].value, sep['Search clicks'].source, sep['Search clicks'].note, sep['Search clicks'].unit], [90, 'gsc', 'Google Search Console, Sep 2026', '']);
  assert.deepEqual([sep['Search CTR'].value, sep['Search CTR'].unit, sep['Average position'].value], [3.12, '%', 8.46]);
  assert.deepEqual([sep.Sessions.value, sep.Sessions.source, sep.Sessions.note, sep['Organic sessions'].value, sep.Users.value, sep.Conversions.value], [900, 'ga4', 'Google Analytics, Sep 2026', 360, 720, 9]);
  const link = gs.getLink(f.db, f.sarah, f.client.id);
  assert.deepEqual([link.lastSyncStatus, link.lastSyncError, link.connectedByName], ['ok', '', 'Mark']);
  assert.ok(link.lastSyncAt);
  // the numbers feed straight into trends and reports
  const sum = results.metricsSummary(f.db, f.mark, f.client.id).find((m) => m.metric === 'Search clicks');
  assert.deepEqual([sum.latest.value, sum.previous.value, sum.change], [90, 80, 10]);
  const data = reports.reportData(f.db, f.mark, f.client.id, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual([data.results.find((r) => r.metric === 'Search clicks').latest.value, data.results.find((r) => r.metric === 'Search clicks').change], [90, 10]);
});

test('syncing again updates numbers and never duplicates; the daily refresh covers the last 2 months', async () => {
  const f = await setup();
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  const before = rows(f).length;
  f.google.calls.gsc = f.google.calls.ga4 = 0;
  const again = await gs.sync(f.db, f.mark, f.google, f.client.id, { months: 2 });
  assert.deepEqual([again.months, again.recorded, f.google.calls.gsc, f.google.calls.ga4], [2, 16, 2, 2]);
  assert.equal(rows(f).length, before);
  // Google finalises late: the same month now has a different number
  f.google.searchAnalytics = async () => ({ clicks: 777, impressions: 1, ctr: 0.5, position: 1 });
  await gs.sync(f.db, f.mark, f.google, f.client.id, { months: 1 });
  assert.equal(rows(f, "AND metric = 'Search clicks' AND recorded_on = '2026-09-30'")[0].value, 777);
  assert.equal(rows(f, "AND metric = 'Search clicks'").length, 12);
  await assert.rejects(() => gs.sync(f.db, f.mark, f.google, f.client.id, { months: 99 }), /months/i);
});

test('months Google has no data for are skipped', async () => {
  const f = await setup();
  f.google.searchAnalytics = async (s, { startDate }) => (startDate < '2026-07-01' ? null : { clicks: 5, impressions: 50, ctr: 0.1, position: 3 });
  const out = await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  assert.equal(rows(f, "AND source = 'gsc'").length, 3 * 4);
  assert.equal(rows(f, "AND source = 'ga4'").length, 12 * 4);
  assert.equal(out.sync.status, 'ok');
});

test('when one source fails the other still works, and the problem is said plainly', async () => {
  const f = await setup();
  f.google.searchAnalytics = async () => { throw new GoogleError(`Google refused access. Add ${EMAIL} as a read-only user (a viewer) for this property`); };
  const out = await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  assert.equal(out.sync.status, 'partial');
  assert.equal(out.sync.errors.length, 1);
  assert.match(out.sync.errors[0].message, /Search Console.*Google refused access/i);
  assert.equal(rows(f, "AND source = 'ga4'").length, 48);
  assert.equal(rows(f, "AND source = 'gsc'").length, 0);
  const link = gs.getLink(f.db, f.mark, f.client.id);
  assert.deepEqual([link.lastSyncStatus, /refused access/.test(link.lastSyncError)], ['partial', true]);
  // a failing source is not retried for every month
  const f2 = await setup();
  let tries = 0;
  f2.google.ga4Totals = async () => { tries += 1; throw new GoogleError('Google returned an error (500)'); };
  f2.google.searchAnalytics = async () => { throw new GoogleError('Google returned an error (500)'); };
  const both = await gs.connect(f2.db, f2.mark, f2.google, f2.client.id, LINK);
  assert.deepEqual([both.sync.status, tries, both.sync.recorded], ['failed', 1, 0]);
});

test('hand-typed results are never touched, and synced ones cannot be edited by hand', async () => {
  const f = await setup();
  results.recordResult(f.db, f.sarah, f.client.id, { metric: 'Sessions', value: 1, recordedOn: '2026-09-30', note: 'typed by hand' });
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  const sessions = rows(f, "AND metric = 'Sessions' AND recorded_on = '2026-09-30'");
  assert.deepEqual(sessions.map((r) => [r.source, r.value]), [['manual', 1], ['ga4', 900]]);
  await gs.sync(f.db, f.mark, f.google, f.client.id, { months: 2 });
  assert.equal(rows(f, "AND metric = 'Sessions' AND recorded_on = '2026-09-30'").length, 2);
  const synced = results.listResults(f.db, f.mark, f.client.id, { metric: 'Search clicks' })[0];
  assert.deepEqual([synced.source, synced.recordedByName], ['gsc', null]);
  assert.throws(() => results.updateResult(f.db, f.josh, synced.id, { value: 1 }), /Google/i);
  assert.throws(() => results.deleteResult(f.db, f.josh, synced.id), /Google/i);
  const manual = results.listResults(f.db, f.mark, f.client.id, { metric: 'Sessions' }).find((r) => r.source === 'manual');
  assert.equal(results.updateResult(f.db, f.sarah, manual.id, { value: 2 }).value, 2);
});

test('disconnecting stops syncing and keeps the numbers', async () => {
  const f = await setup();
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  const count = rows(f).length;
  gs.disconnect(f.db, f.mark, f.client.id);
  assert.equal(gs.getLink(f.db, f.mark, f.client.id), null);
  assert.equal(rows(f).length, count);
  await assert.rejects(() => gs.sync(f.db, f.mark, f.google, f.client.id), /not connected/i);
  assert.throws(() => gs.disconnect(f.db, f.mark, f.client.id), /not connected/i);
});

test('connecting again replaces the link; another agency never sees or changes it', async () => {
  const f = await setup();
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  const out = await gs.connect(f.db, f.rayne, f.google, f.client.id, { ga4PropertyId: '111' });
  assert.deepEqual([out.link.gscSiteUrl, out.link.ga4PropertyId], [null, '111']);
  assert.throws(() => gs.getLink(f.db, f.zed, f.client.id), /not found/i);
  assert.throws(() => gs.disconnect(f.db, f.zed, f.client.id), /not found/i);
  await assert.rejects(() => gs.sync(f.db, f.zed, f.google, f.client.id), /not found/i);
});

test('the daily sync covers links never synced or older than a day, as the system', async () => {
  const f = await setup();
  const other = clients.createClient(f.db, f.mark, { name: 'Beta' });
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  await gs.connect(f.db, f.mark, f.google, other.id, { ga4PropertyId: '111' });
  // one was synced long ago, the other just now
  f.db.prepare("UPDATE client_google SET last_sync_at = '2026-10-08T00:00:00.000Z' WHERE client_id = ?").run(f.client.id);
  f.db.prepare("UPDATE client_google SET last_sync_at = '2026-10-10T01:00:00.000Z' WHERE client_id = ?").run(other.id);
  f.google.calls.gsc = f.google.calls.ga4 = 0;
  const out = await gs.syncDue(f.db, f.google, { now: new Date('2026-10-10T03:30:00Z'), today: '2026-10-10' });
  assert.deepEqual([out.clients, f.google.calls.gsc, f.google.calls.ga4], [1, 2, 2]);
  assert.equal((await gs.syncDue(f.db, f.google, { now: new Date('2026-10-10T04:00:00Z'), today: '2026-10-10' })).clients, 0);
  assert.equal((await gs.syncDue(f.db, null, { now: new Date() })).clients, 0); // no Google set up: nothing to do
  const log = listActivity(f.db, f.josh).find((a) => a.action === 'integration.sync' && a.source === 'system');
  assert.ok(log);
});

test('connect, sync and disconnect are written to the activity log', async () => {
  const f = await setup();
  await gs.connect(f.db, f.mark, f.google, f.client.id, LINK);
  gs.disconnect(f.db, f.mark, f.client.id);
  const rowsLog = listActivity(f.db, f.josh).filter((a) => a.action.startsWith('integration.'));
  assert.deepEqual(rowsLog.map((a) => a.action), ['integration.disconnect', 'integration.sync', 'integration.connect']);
  assert.ok(!JSON.stringify(rowsLog).includes('private_key'));
});
