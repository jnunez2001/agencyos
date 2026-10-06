// Joshua Nunez
// Clients and their contacts. Every function takes a context, checks permission first, and scopes every query by
// the organization, so another agency's client is always "not found".
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanEmail, cleanDate, cleanTeamMember, diff } = require('./validate');
const { cleanServiceId } = require('./services');
const goals = require('./goals');
const perms = require('./permissions');

const STATUSES = ['lead', 'onboarding', 'active', 'paused', 'at_risk', 'completed', 'archived'];
const FIELDS = ['name', 'status', 'website', 'industry', 'notes', 'accountOwnerId', 'startDate'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT c.id, c.name, c.status, c.website, c.industry, c.notes, c.created_at AS createdAt, c.updated_at AS updatedAt,
         c.account_owner_id AS accountOwnerId, ao.display_name AS accountOwnerName, c.start_date AS startDate,
         (SELECT COUNT(*) FROM projects p WHERE p.organization_id = c.organization_id AND p.client_id = c.id AND p.status NOT IN ('completed','archived')) AS openProjects
    FROM clients c LEFT JOIN users ao ON ao.id = c.account_owner_id WHERE c.organization_id = ?`;

const servicesOf = (db, clientId) => db.prepare('SELECT s.id, s.name FROM client_services cs JOIN services s ON s.id = cs.service_id WHERE cs.client_id = ? ORDER BY s.name COLLATE NOCASE').all(clientId);

function find(db, organizationId, id) {
  const row = db.prepare(`${SELECT} AND c.id = ?`).get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Client not found');
  return { ...row, services: servicesOf(db, row.id) };
}

// A list of service ids from the agency's list. A service the client already has may stay even if it is inactive.
function cleanServiceIds(db, organizationId, value, currentIds) {
  if (!Array.isArray(value)) throw new ServiceError(400, 'Choose services from the list');
  return [...new Set(value.map((v) => cleanServiceId(db, organizationId, v, currentIds.includes(Number(v)) ? Number(v) : null)))].filter((v) => v !== null);
}

function setServices(db, clientId, ids) {
  db.prepare('DELETE FROM client_services WHERE client_id = ?').run(clientId);
  for (const id of ids) db.prepare('INSERT INTO client_services (client_id, service_id) VALUES (?, ?)').run(clientId, id);
}

function listClients(db, ctx, { status } = {}) {
  need(ctx, 'clients.view');
  if (status) cleanEnum(status, STATUSES, 'status');
  return db.prepare(`${SELECT} ${status ? 'AND c.status = ?' : ''} ORDER BY c.name COLLATE NOCASE`).all(...(status ? [ctx.organizationId, status] : [ctx.organizationId]))
    .map((r) => ({ ...r, services: servicesOf(db, r.id) }));
}

const contactShape = (r) => ({ id: r.id, clientId: r.client_id, name: r.name, email: r.email, phone: r.phone, roleTitle: r.role_title, isPrimary: !!r.is_primary });
const contacts = (db, organizationId, clientId) => db.prepare('SELECT * FROM client_contacts WHERE organization_id = ? AND client_id = ? ORDER BY id').all(organizationId, clientId).map(contactShape);

function getClient(db, ctx, id) {
  need(ctx, 'clients.view');
  const c = find(db, ctx.organizationId, id);
  const projects = db.prepare(
    `SELECT p.id, p.name, p.status, p.due_date AS dueDate, g.title AS goalTitle,
            (SELECT COUNT(*) FROM tasks t WHERE t.organization_id = p.organization_id AND t.project_id = p.id AND t.status != 'done') AS openTasks
       FROM projects p LEFT JOIN client_goals g ON g.id = p.goal_id WHERE p.organization_id = ? AND p.client_id = ? ORDER BY p.id DESC`
  ).all(ctx.organizationId, c.id);
  return { ...c, contacts: contacts(db, ctx.organizationId, c.id), projects, goals: goals.forClient(db, ctx.organizationId, c.id) };
}

function createClient(db, ctx, input = {}) {
  need(ctx, 'clients.manage');
  const next = {
    name: cleanText(input.name, 'Name', 1, 100),
    status: input.status === undefined ? 'active' : cleanEnum(input.status, STATUSES, 'status'),
    website: cleanOptional(input.website, 'Website', 200),
    industry: cleanOptional(input.industry, 'Industry', 80),
    notes: cleanOptional(input.notes, 'Notes', 5000),
    startDate: cleanDate(input.startDate, 'Start date'),
  };
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM clients WHERE organization_id = ? AND name = ?').get(ctx.organizationId, next.name)) throw new ServiceError(409, 'A client with that name already exists');
    const accountOwnerId = cleanTeamMember(db, ctx.organizationId, input.accountOwnerId);
    const serviceIds = input.serviceIds === undefined ? [] : cleanServiceIds(db, ctx.organizationId, input.serviceIds, []);
    const id = Number(db.prepare('INSERT INTO clients (organization_id, name, status, website, industry, notes, created_by, account_owner_id, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ctx.organizationId, next.name, next.status, next.website, next.industry, next.notes, ctx.actor.id, accountOwnerId, next.startDate).lastInsertRowid);
    setServices(db, id, serviceIds);
    logActivity(db, { ...logCtx(ctx), action: 'client.create', objectType: 'client', objectId: id, after: { name: next.name, status: next.status } });
    return find(db, ctx.organizationId, id);
  })();
}

function updateClient(db, ctx, id, patch = {}) {
  need(ctx, 'clients.manage');
  return db.transaction(() => {
    const current = find(db, ctx.organizationId, id);
    const next = { ...current };
    if (patch.name !== undefined) next.name = cleanText(patch.name, 'Name', 1, 100);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (patch.website !== undefined) next.website = cleanOptional(patch.website, 'Website', 200);
    if (patch.industry !== undefined) next.industry = cleanOptional(patch.industry, 'Industry', 80);
    if (patch.notes !== undefined) next.notes = cleanOptional(patch.notes, 'Notes', 5000);
    if (patch.startDate !== undefined) next.startDate = cleanDate(patch.startDate, 'Start date');
    if (patch.accountOwnerId !== undefined && Number(patch.accountOwnerId) !== current.accountOwnerId) next.accountOwnerId = cleanTeamMember(db, ctx.organizationId, patch.accountOwnerId);
    const currentIds = current.services.map((x) => x.id);
    const nextIds = patch.serviceIds === undefined ? currentIds : cleanServiceIds(db, ctx.organizationId, patch.serviceIds, currentIds);
    const servicesChanged = [...currentIds].sort().join() !== [...nextIds].sort().join();
    const d = diff(current, next, FIELDS);
    if (!d.changed && !servicesChanged) return current;
    if (d.after.name && db.prepare('SELECT 1 FROM clients WHERE organization_id = ? AND name = ? AND id != ?').get(ctx.organizationId, next.name, current.id)) throw new ServiceError(409, 'A client with that name already exists');
    db.prepare(`UPDATE clients SET name = ?, status = ?, website = ?, industry = ?, notes = ?, account_owner_id = ?, start_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(next.name, next.status, next.website, next.industry, next.notes, next.accountOwnerId, next.startDate, ctx.organizationId, current.id);
    if (servicesChanged) {
      setServices(db, current.id, nextIds);
      const names = (ids) => ids.map((i) => db.prepare('SELECT name FROM services WHERE id = ?').get(i).name).sort((a, b) => a.localeCompare(b));
      d.before.services = names(currentIds);
      d.after.services = names(nextIds);
    }
    logActivity(db, { ...logCtx(ctx), action: 'client.update', objectType: 'client', objectId: current.id, before: d.before, after: d.after });
    return find(db, ctx.organizationId, id);
  })();
}

function findContact(db, organizationId, id) {
  const row = db.prepare('SELECT * FROM client_contacts WHERE organization_id = ? AND id = ?').get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Contact not found');
  return row;
}

function addContact(db, ctx, clientId, input = {}) {
  need(ctx, 'clients.manage');
  return db.transaction(() => {
    const client = find(db, ctx.organizationId, clientId);
    const c = { name: cleanText(input.name, 'Name', 1, 80), email: cleanEmail(input.email), phone: cleanOptional(input.phone, 'Phone', 40), roleTitle: cleanOptional(input.roleTitle, 'Role', 80), isPrimary: !!input.isPrimary };
    if (c.isPrimary) db.prepare('UPDATE client_contacts SET is_primary = 0 WHERE organization_id = ? AND client_id = ?').run(ctx.organizationId, client.id);
    const id = Number(db.prepare('INSERT INTO client_contacts (organization_id, client_id, name, email, phone, role_title, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ctx.organizationId, client.id, c.name, c.email, c.phone, c.roleTitle, c.isPrimary ? 1 : 0).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'contact.create', objectType: 'contact', objectId: id, after: { clientId: client.id, name: c.name } });
    return contactShape(findContact(db, ctx.organizationId, id));
  })();
}

function updateContact(db, ctx, id, patch = {}) {
  need(ctx, 'clients.manage');
  return db.transaction(() => {
    const row = findContact(db, ctx.organizationId, id);
    const current = contactShape(row);
    const next = { ...current };
    if (patch.name !== undefined) next.name = cleanText(patch.name, 'Name', 1, 80);
    if (patch.email !== undefined) next.email = cleanEmail(patch.email);
    if (patch.phone !== undefined) next.phone = cleanOptional(patch.phone, 'Phone', 40);
    if (patch.roleTitle !== undefined) next.roleTitle = cleanOptional(patch.roleTitle, 'Role', 80);
    if (patch.isPrimary !== undefined) next.isPrimary = !!patch.isPrimary;
    const d = diff(current, next, ['name', 'email', 'phone', 'roleTitle', 'isPrimary']);
    if (!d.changed) return current;
    if (next.isPrimary) db.prepare('UPDATE client_contacts SET is_primary = 0 WHERE organization_id = ? AND client_id = ?').run(ctx.organizationId, row.client_id);
    db.prepare('UPDATE client_contacts SET name = ?, email = ?, phone = ?, role_title = ?, is_primary = ? WHERE organization_id = ? AND id = ?').run(next.name, next.email, next.phone, next.roleTitle, next.isPrimary ? 1 : 0, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'contact.update', objectType: 'contact', objectId: row.id, before: d.before, after: d.after });
    return contactShape(findContact(db, ctx.organizationId, id));
  })();
}

function deleteContact(db, ctx, id) {
  need(ctx, 'clients.manage');
  db.transaction(() => {
    const row = findContact(db, ctx.organizationId, id);
    db.prepare('DELETE FROM client_contacts WHERE organization_id = ? AND id = ?').run(ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'contact.delete', objectType: 'contact', objectId: row.id, before: { clientId: row.client_id, name: row.name } });
  })();
  return { ok: true };
}

module.exports = { STATUSES, listClients, getClient, createClient, updateClient, addContact, updateContact, deleteContact, find };
