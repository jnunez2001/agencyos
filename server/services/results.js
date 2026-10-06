// Joshua Nunez
// Recorded results: measurements per client (a metric, a value, the date it applies to). Metrics are named
// series per client, matched ignoring case. Staff record them. Every query is scoped by the organization.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanDate, diff } = require('./validate');
const { today } = require('./dates');
const perms = require('./permissions');

const FIELDS = ['metric', 'value', 'unit', 'recordedOn', 'goalId', 'note'];
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT r.id, r.client_id AS clientId, r.metric, r.value, r.unit, r.recorded_on AS recordedOn, r.goal_id AS goalId, g.title AS goalTitle, r.note,
         r.created_by AS recordedById, u.display_name AS recordedByName, r.created_at AS createdAt
    FROM client_results r
    LEFT JOIN client_goals g ON g.id = r.goal_id
    LEFT JOIN users u ON u.id = r.created_by
   WHERE r.organization_id = ?`;

function findClient(db, organizationId, clientId) {
  const row = db.prepare('SELECT id FROM clients WHERE organization_id = ? AND id = ?').get(organizationId, Number(clientId));
  if (!row) throw new ServiceError(404, 'Client not found');
  return row.id;
}

function find(db, organizationId, id) {
  const row = db.prepare(`${SELECT} AND r.id = ?`).get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Result not found');
  return row;
}

function cleanValue(value) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new ServiceError(400, 'The value must be a number');
  return n;
}

// The goal must belong to the same client.
function cleanGoal(db, organizationId, clientId, goalId) {
  if (goalId === undefined || goalId === null || goalId === '') return null;
  const g = db.prepare('SELECT id, client_id AS clientId FROM client_goals WHERE organization_id = ? AND id = ?').get(organizationId, Number(goalId));
  if (!g) throw new ServiceError(404, 'Goal not found');
  if (g.clientId !== clientId) throw new ServiceError(400, 'The goal must belong to the same client');
  return g.id;
}

function listResults(db, ctx, clientId, { metric, from, to } = {}) {
  need(ctx, 'results.view');
  const cid = findClient(db, ctx.organizationId, clientId);
  const where = ['r.client_id = ?'];
  const params = [ctx.organizationId, cid];
  if (metric) { where.push('r.metric = ?'); params.push(String(metric)); }
  const f = cleanDate(from, 'From date');
  const t = cleanDate(to, 'To date');
  if (f) { where.push('r.recorded_on >= ?'); params.push(f); }
  if (t) { where.push('r.recorded_on <= ?'); params.push(t); }
  return db.prepare(`${SELECT} AND ${where.join(' AND ')} ORDER BY r.recorded_on DESC, r.id DESC LIMIT 1000`).all(...params);
}

// One line per metric: the latest value, the change from the one before it, and a short history for a trend line.
function metricsSummary(db, ctx, clientId) {
  need(ctx, 'results.view');
  const cid = findClient(db, ctx.organizationId, clientId);
  const rows = db.prepare('SELECT id, metric, value, unit, recorded_on AS recordedOn FROM client_results WHERE organization_id = ? AND client_id = ? ORDER BY recorded_on, id').all(ctx.organizationId, cid);
  const byMetric = new Map();
  for (const r of rows) {
    const key = r.metric.toLowerCase();
    if (!byMetric.has(key)) byMetric.set(key, []);
    byMetric.get(key).push(r);
  }
  return [...byMetric.values()].map((list) => {
    const latest = list[list.length - 1];
    const previous = list.length > 1 ? list[list.length - 2] : null;
    const change = previous ? Math.round((latest.value - previous.value) * 1e6) / 1e6 : null;
    const changePct = previous && previous.value !== 0 ? Math.round(((latest.value - previous.value) / Math.abs(previous.value)) * 1000) / 10 : null;
    return {
      metric: latest.metric, unit: latest.unit, count: list.length,
      latest: { id: latest.id, value: latest.value, recordedOn: latest.recordedOn },
      previous: previous ? { value: previous.value, recordedOn: previous.recordedOn } : null,
      change, changePct,
      history: list.slice(-12).map((r) => ({ id: r.id, recordedOn: r.recordedOn, value: r.value })),
    };
  }).sort((a, b) => a.metric.localeCompare(b.metric));
}

function recordResult(db, ctx, clientId, input = {}) {
  need(ctx, 'results.record');
  return db.transaction(() => {
    const cid = findClient(db, ctx.organizationId, clientId);
    const next = {
      metric: cleanText(input.metric, 'The metric name', 1, 80),
      value: cleanValue(input.value),
      unit: cleanOptional(input.unit, 'Unit', 20),
      recordedOn: cleanDate(input.recordedOn, 'Date') || today(db, ctx),
      goalId: cleanGoal(db, ctx.organizationId, cid, input.goalId),
      note: cleanOptional(input.note, 'Note', 500),
    };
    const id = Number(db.prepare('INSERT INTO client_results (organization_id, client_id, goal_id, metric, value, unit, recorded_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, cid, next.goalId, next.metric, next.value, next.unit, next.recordedOn, next.note, ctx.actor.id).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'result.create', objectType: 'result', objectId: id, after: { clientId: cid, metric: next.metric, value: next.value, recordedOn: next.recordedOn } });
    return find(db, ctx.organizationId, id);
  })();
}

// Someone may change or remove their own entries. A Manager or above may change anyone's.
function mayChange(ctx, row) {
  if (!perms.can(ctx.actor.role, 'reports.manage') && row.recordedById !== ctx.actor.id) throw new ServiceError(403, 'Not allowed');
}

function updateResult(db, ctx, id, patch = {}) {
  need(ctx, 'results.record');
  return db.transaction(() => {
    const current = find(db, ctx.organizationId, id);
    mayChange(ctx, current);
    const next = { ...current };
    if (patch.metric !== undefined) next.metric = cleanText(patch.metric, 'The metric name', 1, 80);
    if (patch.value !== undefined) next.value = cleanValue(patch.value);
    if (patch.unit !== undefined) next.unit = cleanOptional(patch.unit, 'Unit', 20);
    if (patch.recordedOn !== undefined) next.recordedOn = cleanDate(patch.recordedOn, 'Date') || current.recordedOn;
    if (patch.goalId !== undefined) next.goalId = cleanGoal(db, ctx.organizationId, current.clientId, patch.goalId);
    if (patch.note !== undefined) next.note = cleanOptional(patch.note, 'Note', 500);
    const d = diff(current, next, FIELDS);
    if (!d.changed) return current;
    db.prepare('UPDATE client_results SET metric = ?, value = ?, unit = ?, recorded_on = ?, goal_id = ?, note = ? WHERE organization_id = ? AND id = ?')
      .run(next.metric, next.value, next.unit, next.recordedOn, next.goalId, next.note, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'result.update', objectType: 'result', objectId: current.id, before: d.before, after: d.after });
    return find(db, ctx.organizationId, id);
  })();
}

function deleteResult(db, ctx, id) {
  need(ctx, 'results.record');
  db.transaction(() => {
    const current = find(db, ctx.organizationId, id);
    mayChange(ctx, current);
    db.prepare('DELETE FROM client_results WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'result.delete', objectType: 'result', objectId: current.id, before: { clientId: current.clientId, metric: current.metric, value: current.value, recordedOn: current.recordedOn } });
  })();
  return { ok: true };
}

module.exports = { listResults, metricsSummary, recordResult, updateResult, deleteResult };
