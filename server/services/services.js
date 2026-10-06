// Joshua Nunez
// The agency's list of services (SEO, Web Development and so on). Owner and Admin change it; staff read it.
// A service is renamed or deactivated, never deleted, so the work that has it keeps it.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, diff } = require('./validate');
const perms = require('./permissions');

const DEFAULTS = ['SEO', 'Content Marketing', 'Web Development', 'Web Design', 'Social Media', 'Paid Ads', 'Email Marketing', 'Branding', 'Graphic Design', 'Video'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const shape = (r) => ({ id: r.id, name: r.name, isActive: !!r.is_active });

function find(db, organizationId, id) {
  const row = db.prepare('SELECT * FROM services WHERE organization_id = ? AND id = ?').get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Service not found');
  return row;
}

// Inactive services are for Owner and Admin only, and only when asked for.
function listServices(db, ctx, { all } = {}) {
  need(ctx, 'services.view');
  const showAll = all && perms.can(ctx.actor.role, 'services.manage');
  return db.prepare(`SELECT * FROM services WHERE organization_id = ? ${showAll ? '' : 'AND is_active = 1'} ORDER BY name COLLATE NOCASE`).all(ctx.organizationId).map(shape);
}

function insert(db, ctx, name) {
  if (db.prepare('SELECT 1 FROM services WHERE organization_id = ? AND name = ?').get(ctx.organizationId, name)) throw new ServiceError(409, 'A service with that name already exists');
  const id = Number(db.prepare('INSERT INTO services (organization_id, name) VALUES (?, ?)').run(ctx.organizationId, name).lastInsertRowid);
  logActivity(db, { ...logCtx(ctx), action: 'service.create', objectType: 'service', objectId: id, after: { name } });
  return id;
}

function createService(db, ctx, input = {}) {
  need(ctx, 'services.manage');
  const name = cleanText(input.name, 'Name', 1, 60);
  return db.transaction(() => shape(find(db, ctx.organizationId, insert(db, ctx, name))))();
}

function updateService(db, ctx, id, patch = {}) {
  need(ctx, 'services.manage');
  return db.transaction(() => {
    const row = find(db, ctx.organizationId, id);
    const current = { name: row.name, isActive: !!row.is_active };
    const next = { ...current };
    if (patch.name !== undefined) next.name = cleanText(patch.name, 'Name', 1, 60);
    if (patch.isActive !== undefined) next.isActive = !!patch.isActive;
    const d = diff(current, next, ['name', 'isActive']);
    if (!d.changed) return shape(row);
    if (d.after.name && db.prepare('SELECT 1 FROM services WHERE organization_id = ? AND name = ? AND id != ?').get(ctx.organizationId, next.name, row.id)) throw new ServiceError(409, 'A service with that name already exists');
    db.prepare('UPDATE services SET name = ?, is_active = ? WHERE organization_id = ? AND id = ?').run(next.name, next.isActive ? 1 : 0, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'service.update', objectType: 'service', objectId: row.id, before: d.before, after: d.after });
    return shape(find(db, ctx.organizationId, id));
  })();
}

function addDefaultServices(db, ctx) {
  need(ctx, 'services.manage');
  db.transaction(() => {
    for (const name of DEFAULTS) {
      if (!db.prepare('SELECT 1 FROM services WHERE organization_id = ? AND name = ?').get(ctx.organizationId, name)) insert(db, ctx, name);
    }
  })();
  return listServices(db, ctx, { all: true });
}

// For clients, projects and goals: a service id that exists in this agency and is active.
// A record that already has an inactive service may keep it (pass it as `keepId`).
function cleanServiceId(db, organizationId, value, keepId = null) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  const row = Number.isInteger(id) && db.prepare('SELECT is_active FROM services WHERE organization_id = ? AND id = ?').get(organizationId, id);
  if (!row || (!row.is_active && id !== keepId)) throw new ServiceError(400, 'Choose a service from the list');
  return id;
}

module.exports = { DEFAULTS, listServices, createService, updateService, addDefaultServices, cleanServiceId, find };
