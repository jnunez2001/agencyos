// Joshua Nunez
// Client retainers: the hours a client has paid for each month. Only billable time that is approved or locked counts
// as used; submitted time is shown as pending. Managers and above manage retainers, which are deactivated, never deleted.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanDate, diff } = require('./validate');
const clients = require('./clients');
const { today, addDays } = require('./dates');
const perms = require('./permissions');
const notifications = require('./notifications');

const FIELDS = ['hoursAllocated', 'startDate', 'isActive'];
const WARN_AT = 80;
const OVER_AT = 100;
const round2 = (n) => Math.round(n * 100) / 100;

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT r.id, r.client_id AS clientId, c.name AS clientName, r.period, r.hours_allocated AS hoursAllocated, r.start_date AS startDate, r.is_active AS isActive,
         r.created_at AS createdAt, r.updated_at AS updatedAt
    FROM client_retainers r JOIN clients c ON c.id = r.client_id AND c.organization_id = r.organization_id
   WHERE r.organization_id = ?`;

const shape = (row) => ({ ...row, isActive: !!row.isActive });

// The date that starts period number `k`: the start date's day of the month, or the last day of a shorter month.
function anchor(start, k) {
  const [y, m, d] = start.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + k, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10);
}

// The monthly period that holds `date`. Before the start date, the first period.
function periodFor(start, date) {
  const [sy, sm] = start.split('-').map(Number);
  const [ty, tm] = date.split('-').map(Number);
  let k = (ty - sy) * 12 + (tm - sm);
  if (date < anchor(start, k)) k -= 1;
  if (k < 0) k = 0;
  return { from: anchor(start, k), to: addDays(anchor(start, k + 1), -1) };
}

function usageOf(db, ctx, r) {
  const todayDate = today(db, ctx);
  const period = periodFor(r.startDate, todayDate);
  const sum = (statuses) => db.prepare(`SELECT COALESCE(SUM(minutes), 0) AS n FROM time_entries WHERE organization_id = ? AND client_id = ? AND time_type = 'billable' AND status IN (${statuses.map(() => '?').join(',')}) AND entry_date BETWEEN ? AND ?`).get(ctx.organizationId, r.clientId, ...statuses, period.from, period.to).n;
  const used = round2(sum(['approved', 'locked']) / 60);
  const pending = round2(sum(['submitted']) / 60);
  const percent = Math.round((used / r.hoursAllocated) * 100);
  const level = used > r.hoursAllocated ? 'over' : used >= (r.hoursAllocated * WARN_AT) / 100 ? 'warning' : 'ok';
  const message = level === 'over' ? `Over the retainer by ${round2(used - r.hoursAllocated)} hours`
    : level === 'warning' ? `${percent} percent of the retainer is used, ${round2(r.hoursAllocated - used)} hours left` : '';
  return { retainerId: r.id, clientId: r.clientId, clientName: r.clientName, period: { from: period.from, to: period.to }, startDate: r.startDate, started: todayDate >= r.startDate, allocatedHours: r.hoursAllocated, usedHours: used, remainingHours: round2(Math.max(0, r.hoursAllocated - used)), overHours: round2(Math.max(0, used - r.hoursAllocated)), pendingHours: pending, percent, level, message };
}

const active = (db, ctx, clientId) => db.prepare(`${SELECT} AND r.client_id = ? AND r.is_active = 1`).get(ctx.organizationId, Number(clientId));

// The client's retainer (the active one, or the latest) with this period's usage.
function getRetainer(db, ctx, clientId) {
  need(ctx, 'retainers.view');
  const c = clients.find(db, ctx.organizationId, clientId);
  const row = active(db, ctx, c.id);
  if (!row) return { clientId: c.id, retainer: null, usage: null, canManage: perms.can(ctx.actor.role, 'retainers.manage') };
  return { clientId: c.id, retainer: shape(row), usage: usageOf(db, ctx, row), canManage: perms.can(ctx.actor.role, 'retainers.manage') };
}

function cleanHours(value) {
  const n = Number(value);
  if (value === '' || value === null || !Number.isFinite(n) || n <= 0 || n > 10000) throw new ServiceError(400, 'Hours must be a number above 0 and up to 10000');
  return Math.round(n * 100) / 100;
}

// Creates the client's retainer, or changes the active one. Setting isActive false switches it off.
function saveRetainer(db, ctx, clientId, input = {}) {
  need(ctx, 'retainers.manage');
  return db.transaction(() => {
    const c = clients.find(db, ctx.organizationId, clientId);
    const current = active(db, ctx, c.id);
    if (input.period !== undefined && input.period !== 'monthly') throw new ServiceError(400, 'Only monthly retainers are supported');
    if (!current) {
      if (input.isActive === false) throw new ServiceError(400, 'This client has no retainer to switch off');
      const next = { hoursAllocated: cleanHours(input.hoursAllocated), startDate: cleanDate(input.startDate === undefined ? today(db, ctx) : input.startDate, 'Start date') };
      if (!next.startDate) throw new ServiceError(400, 'Start date is required');
      const id = Number(db.prepare('INSERT INTO client_retainers (organization_id, client_id, period, hours_allocated, start_date, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(ctx.organizationId, c.id, 'monthly', next.hoursAllocated, next.startDate, ctx.actor.id).lastInsertRowid);
      logActivity(db, { ...logCtx(ctx), action: 'retainer.create', objectType: 'retainer', objectId: id, after: { clientId: c.id, hoursAllocated: next.hoursAllocated, startDate: next.startDate } });
      return getRetainer(db, ctx, c.id);
    }
    const cur = shape(current);
    const next = { ...cur };
    if (input.hoursAllocated !== undefined) next.hoursAllocated = cleanHours(input.hoursAllocated);
    if (input.startDate !== undefined) { next.startDate = cleanDate(input.startDate, 'Start date'); if (!next.startDate) throw new ServiceError(400, 'Start date is required'); }
    if (input.isActive !== undefined) next.isActive = !!input.isActive;
    const d = diff(cur, next, FIELDS);
    if (!d.changed) return getRetainer(db, ctx, c.id);
    db.prepare("UPDATE client_retainers SET hours_allocated = ?, start_date = ?, is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(next.hoursAllocated, next.startDate, next.isActive ? 1 : 0, ctx.organizationId, cur.id);
    logActivity(db, { ...logCtx(ctx), action: 'retainer.update', objectType: 'retainer', objectId: cur.id, before: d.before, after: d.after });
    return getRetainer(db, ctx, c.id);
  })();
}

// Usage for every active retainer (or one client), worst first.
function listUsage(db, ctx, { clientId } = {}) {
  need(ctx, 'retainers.view');
  const rows = db.prepare(`${SELECT} AND r.is_active = 1 ${clientId ? 'AND r.client_id = ?' : ''} ORDER BY c.name COLLATE NOCASE`).all(...(clientId ? [ctx.organizationId, Number(clientId)] : [ctx.organizationId]));
  return rows.map((r) => usageOf(db, ctx, r)).sort((a, b) => b.percent - a.percent);
}

// Called when billable time is approved. Tells managers and the client's account owner once per period when the retainer
// reaches 80 percent and once when it reaches 100 percent. Time from an earlier period does not count here.
function notifyUsage(db, ctx, clientId, entryDate) {
  const row = active(db, ctx, clientId);
  if (!row) return 0;
  const u = usageOf(db, ctx, row);
  if (!u.started || entryDate < u.period.from || entryDate > u.period.to) return 0;
  const level = u.usedHours >= u.allocatedHours ? OVER_AT : u.usedHours * 100 >= u.allocatedHours * WARN_AT ? WARN_AT : 0;
  if (!level) return 0;
  const owner = db.prepare('SELECT account_owner_id AS id FROM clients WHERE organization_id = ? AND id = ?').get(ctx.organizationId, row.clientId);
  const title = level === OVER_AT ? `${u.clientName} has used all of its retainer hours` : `${u.clientName} has used ${u.percent} percent of its retainer`;
  const body = level === OVER_AT ? `${u.usedHours} of ${u.allocatedHours} hours used this period` : `${u.usedHours} of ${u.allocatedHours} hours used, ${u.remainingHours} left this period`;
  return notifications.notify(db, ctx, { userIds: [...notifications.peopleWith(db, ctx.organizationId, 'retainers.manage'), owner && owner.id], type: 'retainer_limit', title, body, link: `#/clients/${row.clientId}`, objectType: 'client', objectId: row.clientId, dedupeKey: `retainer:${row.clientId}:${u.period.from}:${level}`, once: true });
}

module.exports = { notifyUsage, WARN_AT, OVER_AT, periodFor, getRetainer, saveRetainer, listUsage };
