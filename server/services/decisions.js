// Joshua Nunez
// Decisions: what was decided, when, and where it came from. Managers write them; Owner to Employee read them.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, diff } = require('./validate');
const clients = require('./clients');
const projects = require('./projects');
const perms = require('./permissions');
const notifications = require('./notifications');
const { pageOf } = require('./paging');

const STATUSES = ['active', 'reversed'];
const FIELDS = ['title', 'details', 'decidedOn', 'status', 'clientId', 'projectId', 'peopleInvolved'];
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT d.id, d.title, d.details, d.people_involved AS peopleInvolved, d.decided_on AS decidedOn, d.status, d.client_id AS clientId, c.name AS clientName, d.project_id AS projectId, p.name AS projectName,
         d.source_note_id AS sourceNoteId, n.title AS sourceNoteTitle, d.created_by AS createdBy, cu.display_name AS createdByName, d.created_at AS createdAt, d.updated_at AS updatedAt
    FROM decisions d
    LEFT JOIN clients c ON c.id = d.client_id AND c.organization_id = d.organization_id
    LEFT JOIN projects p ON p.id = d.project_id AND p.organization_id = d.organization_id
    LEFT JOIN meeting_notes n ON n.id = d.source_note_id AND n.organization_id = d.organization_id
    LEFT JOIN users cu ON cu.id = d.created_by
   WHERE d.organization_id = ?`;

const shape = (ctx, row) => ({ ...row, canEdit: perms.can(ctx.actor.role, 'decisions.manage') });

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND d.id = ?`).get(ctx.organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Decision not found');
  return row;
}
function getDecision(db, ctx, id) { need(ctx, 'decisions.view'); return shape(ctx, find(db, ctx, id)); }

function listDecisions(db, ctx, { clientId, projectId, status, q, limit, offset } = {}) {
  need(ctx, 'decisions.view');
  const where = []; const params = [ctx.organizationId];
  if (clientId) { where.push('d.client_id = ?'); params.push(Number(clientId)); }
  if (projectId) { where.push('d.project_id = ?'); params.push(Number(projectId)); }
  if (status) { cleanEnum(status, STATUSES, 'status'); where.push('d.status = ?'); params.push(status); }
  if (q) { where.push("d.title LIKE ? ESCAPE '\\'"); params.push(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`); }
  const page = pageOf({ limit, offset }, 300);
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY d.decided_on DESC, d.id DESC LIMIT ? OFFSET ?`).all(...params, page.limit, page.offset).map((r) => shape(ctx, r));
}

function cleanLinks(db, ctx, clientId, projectId) {
  let client = null; let project = null;
  if (projectId != null && projectId !== '') project = projects.find(db, ctx.organizationId, projectId);
  if (clientId != null && clientId !== '') client = clients.find(db, ctx.organizationId, clientId);
  if (project) {
    if (client && client.id !== project.clientId) throw new ServiceError(400, 'That project belongs to another client');
    client = client || clients.find(db, ctx.organizationId, project.clientId);
  }
  return { clientId: client ? client.id : null, projectId: project ? project.id : null };
}

// The client's account owner is told about a decision that is made or reversed (never the person who did it).
function tellOwner(db, ctx, { id, clientId, title }, verb) {
  if (!clientId) return;
  const owner = db.prepare('SELECT account_owner_id AS id FROM clients WHERE organization_id = ? AND id = ?').get(ctx.organizationId, clientId);
  notifications.notify(db, ctx, { userIds: [owner && owner.id], type: `decision_${verb}`, title: `Decision ${verb}: ${title}`, link: '#/meetings/decisions', objectType: 'decision', objectId: id, dedupeKey: `decision_${verb}:${id}` });
}

function createDecision(db, ctx, input = {}, { sourceNoteId = null } = {}) {
  need(ctx, 'decisions.manage');
  return db.transaction(() => {
    const decidedOn = cleanDate(input.decidedOn, 'Decided on');
    if (!decidedOn) throw new ServiceError(400, 'Decided on is required');
    const next = { title: cleanText(input.title, 'Title', 1, 200), details: cleanOptional(input.details, 'Details', 10000), peopleInvolved: cleanOptional(input.peopleInvolved, 'People involved', 500), decidedOn, status: input.status === undefined ? 'active' : cleanEnum(input.status, STATUSES, 'status'), ...cleanLinks(db, ctx, input.clientId, input.projectId) };
    const id = Number(db.prepare('INSERT INTO decisions (organization_id, client_id, project_id, title, details, people_involved, decided_on, status, source_note_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, next.clientId, next.projectId, next.title, next.details, next.peopleInvolved, next.decidedOn, next.status, sourceNoteId, ctx.actor.id).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'decision.create', objectType: 'decision', objectId: id, after: { title: next.title, decidedOn: next.decidedOn, ...(sourceNoteId ? { sourceNoteId } : {}) } });
    if (next.status === 'active') tellOwner(db, ctx, { id, clientId: next.clientId, title: next.title }, 'made');
    return getDecision(db, ctx, id);
  })();
}

function updateDecision(db, ctx, id, patch = {}) {
  need(ctx, 'decisions.manage');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    const next = { ...current };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.details !== undefined) next.details = cleanOptional(patch.details, 'Details', 10000);
    if (patch.peopleInvolved !== undefined) next.peopleInvolved = cleanOptional(patch.peopleInvolved, 'People involved', 500);
    if (patch.decidedOn !== undefined) { next.decidedOn = cleanDate(patch.decidedOn, 'Decided on'); if (!next.decidedOn) throw new ServiceError(400, 'Decided on is required'); }
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (patch.clientId !== undefined || patch.projectId !== undefined) {
      const clientId = patch.clientId !== undefined ? patch.clientId : current.clientId;
      const projectId = patch.projectId !== undefined ? patch.projectId : (patch.clientId !== undefined && patch.clientId !== current.clientId ? null : current.projectId);
      Object.assign(next, cleanLinks(db, ctx, clientId, projectId));
    }
    const d = diff(current, next, FIELDS);
    if (!d.changed) return shape(ctx, current);
    db.prepare("UPDATE decisions SET title = ?, details = ?, people_involved = ?, decided_on = ?, status = ?, client_id = ?, project_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(next.title, next.details, next.peopleInvolved, next.decidedOn, next.status, next.clientId, next.projectId, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'decision.update', objectType: 'decision', objectId: current.id, before: d.before, after: d.after });
    if (d.after.status === 'reversed') tellOwner(db, ctx, { id: current.id, clientId: next.clientId, title: next.title }, 'reversed');
    return getDecision(db, ctx, id);
  })();
}

function deleteDecision(db, ctx, id) {
  need(ctx, 'decisions.manage');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    db.prepare('DELETE FROM decisions WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'decision.delete', objectType: 'decision', objectId: current.id, before: { title: current.title } });
    return { deleted: true };
  })();
}

module.exports = { STATUSES, listDecisions, getDecision, createDecision, updateDecision, deleteDecision };
