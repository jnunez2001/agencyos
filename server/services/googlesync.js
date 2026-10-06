// Joshua Nunez
// Google Search Console and Analytics data for clients. A client links one site and one property (chosen from what the
// service account can see). Monthly numbers for completed months are written as results with a source, so repeated
// syncs update rather than duplicate, and hand-typed results are never touched. Every query is scoped by the organization.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { todayIn } = require('./dates');
const { GoogleError } = require('../google');
const perms = require('./permissions');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIRST_SYNC_MONTHS = 12;
const DAILY_MONTHS = 2;
const MAX_MONTHS = 24;
const DUE_AFTER_HOURS = 20;

const round = (n, places) => Math.round(Number(n) * 10 ** places) / 10 ** places;
// What is recorded from each source, and how.
const GSC_METRICS = [['Search clicks', (d) => d.clicks, ''], ['Search impressions', (d) => d.impressions, ''], ['Search CTR', (d) => round(d.ctr * 100, 2), '%'], ['Average position', (d) => round(d.position, 2), '']];
const GA4_METRICS = [['Sessions', (d) => d.sessions, ''], ['Organic sessions', (d) => d.organicSessions, ''], ['Users', (d) => d.users, ''], ['Conversions', (d) => d.conversions, '']];

const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const needGoogle = (google) => { if (!google) throw new ServiceError(400, 'Google is not set up on this server'); };
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });

function findClient(db, organizationId, clientId) {
  const row = db.prepare('SELECT id, name FROM clients WHERE organization_id = ? AND id = ?').get(organizationId, Number(clientId));
  if (!row) throw new ServiceError(404, 'Client not found');
  return row;
}

const linkRow = (db, organizationId, clientId) => db.prepare(
  `SELECT g.*, u.display_name AS connectedByName FROM client_google g LEFT JOIN users u ON u.id = g.connected_by WHERE g.organization_id = ? AND g.client_id = ?`
).get(organizationId, Number(clientId)) || null;

const shape = (g) => g && ({ gscSiteUrl: g.gsc_site_url, ga4PropertyId: g.ga4_property_id, connectedAt: g.connected_at, connectedByName: g.connectedByName, lastSyncAt: g.last_sync_at, lastSyncStatus: g.last_sync_status, lastSyncError: g.last_sync_error });

async function viaGoogle(fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof GoogleError) throw new ServiceError(502, err.message);
    throw err;
  }
}

function status(db, ctx, google) {
  need(ctx, 'results.view');
  return { configured: !!google, email: google && perms.can(ctx.actor.role, 'integrations.manage') ? google.email : null };
}

function getLink(db, ctx, clientId) {
  need(ctx, 'results.view');
  findClient(db, ctx.organizationId, clientId);
  return shape(linkRow(db, ctx.organizationId, clientId));
}

// What the service account can see, for the person choosing a site and a property.
async function available(db, ctx, google) {
  need(ctx, 'integrations.manage');
  needGoogle(google);
  const problems = [];
  const attempt = async (fn, label) => { try { return await fn(); } catch (err) { if (!(err instanceof GoogleError)) throw err; problems.push(`${label}: ${err.message}`); return []; } };
  const [sites, properties] = await Promise.all([attempt(() => google.listSites(), 'Search Console'), attempt(() => google.listProperties(), 'Google Analytics')]);
  return problems.length ? { sites, properties, problems } : { sites, properties };
}

// ---- months ----

// The completed months before `today`, oldest first, as { start, end, label }.
function completedMonths(today, count) {
  const [y, m] = today.split('-').map(Number);
  const out = [];
  for (let i = count; i >= 1; i -= 1) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const last = new Date(Date.UTC(y, m - i, 0));
    out.push({ start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10), label: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}` });
  }
  return out;
}

function upsert(db, { organizationId, clientId, metric, value, unit, recordedOn, source, note }) {
  const existing = db.prepare('SELECT id FROM client_results WHERE client_id = ? AND metric = ? AND recorded_on = ? AND source = ?').get(clientId, metric, recordedOn, source);
  if (existing) db.prepare('UPDATE client_results SET value = ?, unit = ?, note = ? WHERE id = ?').run(value, unit, note, existing.id);
  else db.prepare('INSERT INTO client_results (organization_id, client_id, metric, value, unit, recorded_on, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(organizationId, clientId, metric, value, unit, recordedOn, note, source);
}

// The sync itself. Returns { status, months, recorded, errors }. A source that fails is not retried for the other
// months, and the other source carries on.
async function runSync(db, google, { organizationId, clientId, today, months, actorId, source, now = new Date() }) {
  const link = linkRow(db, organizationId, clientId);
  const list = completedMonths(today, months);
  let recorded = 0;
  const errors = [];

  const pull = async (sourceKey, label, enabled, metrics, fetchMonth) => {
    if (!enabled) return;
    for (const month of list) {
      let data;
      try { data = await fetchMonth(month); } catch (err) {
        if (!(err instanceof GoogleError)) throw err;
        errors.push({ source: sourceKey, message: `${label}: ${err.message}` });
        return;
      }
      if (!data) continue;
      db.transaction(() => {
        for (const [metric, pick, unit] of metrics) {
          upsert(db, { organizationId, clientId, metric, value: pick(data), unit, recordedOn: month.end, source: sourceKey, note: `${label === 'Search Console' ? 'Google Search Console' : 'Google Analytics'}, ${month.label}` });
          recorded += 1;
        }
      })();
    }
  };
  await pull('gsc', 'Search Console', !!link.gsc_site_url, GSC_METRICS, (m) => google.searchAnalytics(link.gsc_site_url, { startDate: m.start, endDate: m.end }));
  await pull('ga4', 'Google Analytics', !!link.ga4_property_id, GA4_METRICS, (m) => google.ga4Totals(link.ga4_property_id, { startDate: m.start, endDate: m.end }));

  const configured = (link.gsc_site_url ? 1 : 0) + (link.ga4_property_id ? 1 : 0);
  const outcome = errors.length === 0 ? 'ok' : errors.length < configured ? 'partial' : 'failed';
  db.transaction(() => {
    db.prepare('UPDATE client_google SET last_sync_at = ?, last_sync_status = ?, last_sync_error = ? WHERE organization_id = ? AND client_id = ?').run(now.toISOString(), outcome, errors.map((e) => e.message).join(' | ').slice(0, 500), organizationId, clientId);
    logActivity(db, { organizationId, actorUserId: actorId, action: 'integration.sync', objectType: 'client', objectId: clientId, after: { status: outcome, recorded, months: list.length }, source });
  })();
  return { status: outcome, months: list.length, recorded, errors };
}

const cleanMonths = (months, fallback) => {
  const n = months === undefined ? fallback : Number(months);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MONTHS) throw new ServiceError(400, `Sync between 1 and ${MAX_MONTHS} months`);
  return n;
};

async function sync(db, ctx, google, clientId, { months } = {}) {
  need(ctx, 'integrations.manage');
  needGoogle(google);
  findClient(db, ctx.organizationId, clientId);
  const count = cleanMonths(months, FIRST_SYNC_MONTHS);
  if (!linkRow(db, ctx.organizationId, clientId)) throw new ServiceError(400, 'Google is not connected for this client');
  const today = ctx.today || todayIn((db.prepare('SELECT timezone FROM organizations WHERE id = ?').get(ctx.organizationId) || {}).timezone);
  return runSync(db, google, { organizationId: ctx.organizationId, clientId: Number(clientId), today, months: count, actorId: ctx.actor.id, source: ctx.source || 'web' });
}

async function connect(db, ctx, google, clientId, input = {}) {
  need(ctx, 'integrations.manage');
  needGoogle(google);
  const client = findClient(db, ctx.organizationId, clientId);
  const site = typeof input.gscSiteUrl === 'string' && input.gscSiteUrl.trim() ? input.gscSiteUrl.trim() : null;
  const property = input.ga4PropertyId === undefined || input.ga4PropertyId === null || String(input.ga4PropertyId).trim() === '' ? null : String(input.ga4PropertyId).trim();
  if (!site && !property) throw new ServiceError(400, 'Choose a Search Console site or an Analytics property');
  if (site && site.length > 300) throw new ServiceError(400, 'That site address is too long');
  if (property && !/^\d+$/.test(property)) throw new ServiceError(400, 'The Analytics property id must be a number');
  // Only what Google can actually see is accepted, so a typo or a missing share is caught here.
  const seen = await viaGoogle(async () => ({ sites: site ? await google.listSites() : [], properties: property ? await google.listProperties() : [] }));
  if (site && !seen.sites.some((s) => s.siteUrl === site)) throw new ServiceError(400, `That Search Console site is not shared with ${google.email}`);
  if (property && !seen.properties.some((p) => p.id === property)) throw new ServiceError(400, `That Analytics property is not shared with ${google.email}`);
  db.transaction(() => {
    db.prepare('DELETE FROM client_google WHERE client_id = ?').run(client.id);
    db.prepare('INSERT INTO client_google (client_id, organization_id, gsc_site_url, ga4_property_id, connected_by) VALUES (?, ?, ?, ?, ?)').run(client.id, ctx.organizationId, site, property, ctx.actor.id);
    logActivity(db, { ...logCtx(ctx), action: 'integration.connect', objectType: 'client', objectId: client.id, after: { gscSiteUrl: site, ga4PropertyId: property } });
  })();
  const result = await sync(db, ctx, google, client.id, { months: FIRST_SYNC_MONTHS });
  return { link: shape(linkRow(db, ctx.organizationId, client.id)), sync: result };
}

function disconnect(db, ctx, clientId) {
  need(ctx, 'integrations.manage');
  const client = findClient(db, ctx.organizationId, clientId);
  const link = linkRow(db, ctx.organizationId, client.id);
  if (!link) throw new ServiceError(400, 'Google is not connected for this client');
  db.transaction(() => {
    db.prepare('DELETE FROM client_google WHERE client_id = ?').run(client.id);
    logActivity(db, { ...logCtx(ctx), action: 'integration.disconnect', objectType: 'client', objectId: client.id, before: { gscSiteUrl: link.gsc_site_url, ga4PropertyId: link.ga4_property_id } });
  })();
  return { ok: true };
}

// The daily job: every link not synced for a while, refreshed for the last couple of months, as the system.
async function syncDue(db, google, { now = new Date(), today } = {}) {
  if (!google) return { clients: 0 };
  const cutoff = new Date(now.getTime() - DUE_AFTER_HOURS * 3600 * 1000).toISOString();
  const due = db.prepare('SELECT g.client_id AS clientId, g.organization_id AS organizationId, o.timezone FROM client_google g JOIN organizations o ON o.id = g.organization_id WHERE g.last_sync_at IS NULL OR g.last_sync_at < ?').all(cutoff);
  let done = 0;
  for (const d of due) {
    try {
      await runSync(db, google, { organizationId: d.organizationId, clientId: d.clientId, today: today || todayIn(d.timezone, now), months: DAILY_MONTHS, actorId: null, source: 'system', now });
      done += 1;
    } catch (err) {
      console.error('Google sync failed for client', d.clientId, err.message);
    }
  }
  return { clients: done };
}

module.exports = { status, getLink, available, connect, sync, disconnect, syncDue, completedMonths };
