// Joshua Nunez
// Client requests: what a client asks for. They can come out of a meeting note and be converted into a task, and
// they keep the link to that task. Employees add requests and edit their own while they are New or Reviewing.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, cleanTeamMember, diff } = require('./validate');
const clients = require('./clients');
const projects = require('./projects');
const tasks = require('./tasks');
const perms = require('./permissions');
const notifications = require('./notifications');

const STATUSES = ['new', 'reviewing', 'approved', 'in_progress', 'waiting', 'completed', 'rejected'];
const STAFF_STATUSES = ['new', 'reviewing'];
const FIELDS = ['title', 'description', 'status', 'clientId', 'projectId', 'requestedBy', 'dueDate', 'ownerId'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const manages = (ctx) => perms.can(ctx.actor.role, 'requests.manage');

const SELECT = `
  SELECT r.id, r.title, r.description, r.status, r.client_id AS clientId, c.name AS clientName, r.project_id AS projectId, p.name AS projectName,
         r.requested_by AS requestedBy, r.due_date AS dueDate, r.owner_id AS ownerId, ou.display_name AS ownerName,
         r.source_note_id AS sourceNoteId, n.title AS sourceNoteTitle, r.task_id AS taskId, t.title AS taskTitle, t.status AS taskStatus,
         r.created_by AS createdBy, cu.display_name AS createdByName, r.created_at AS createdAt, r.updated_at AS updatedAt
    FROM client_requests r
    JOIN clients c ON c.id = r.client_id AND c.organization_id = r.organization_id
    LEFT JOIN projects p ON p.id = r.project_id AND p.organization_id = r.organization_id
    LEFT JOIN users ou ON ou.id = r.owner_id
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN meeting_notes n ON n.id = r.source_note_id AND n.organization_id = r.organization_id
    LEFT JOIN tasks t ON t.id = r.task_id AND t.organization_id = r.organization_id
   WHERE r.organization_id = ?`;

function shape(ctx, row) {
  const own = row.createdBy === ctx.actor.id && STAFF_STATUSES.includes(row.status);
  return { ...row, canEdit: manages(ctx) || own, canManage: manages(ctx), canConvert: manages(ctx) && !row.taskId && !['completed', 'rejected'].includes(row.status) };
}

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND r.id = ?`).get(ctx.organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Request not found');
  return row;
}

function getRequest(db, ctx, id) { need(ctx, 'requests.view'); return shape(ctx, find(db, ctx, id)); }

function listRequests(db, ctx, { clientId, projectId, status, open, q } = {}) {
  need(ctx, 'requests.view');
  const where = []; const params = [ctx.organizationId];
  if (clientId) { where.push('r.client_id = ?'); params.push(Number(clientId)); }
  if (projectId) { where.push('r.project_id = ?'); params.push(Number(projectId)); }
  if (status) { cleanEnum(status, STATUSES, 'status'); where.push('r.status = ?'); params.push(status); }
  if (open) where.push("r.status NOT IN ('completed','rejected')");
  if (q) { where.push("r.title LIKE ? ESCAPE '\\'"); params.push(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`); }
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY r.id DESC LIMIT 300`).all(...params).map((r) => shape(ctx, r));
}

function cleanLinks(db, ctx, clientId, projectId) {
  const client = clients.find(db, ctx.organizationId, clientId);
  let project = null;
  if (projectId != null && projectId !== '') {
    project = projects.find(db, ctx.organizationId, projectId);
    if (project.clientId !== client.id) throw new ServiceError(400, 'That project belongs to another client');
  }
  return { clientId: client.id, projectId: project ? project.id : null };
}

// `sourceNoteId` is only ever set by the code that creates records from a meeting note.
function createRequest(db, ctx, input = {}, { sourceNoteId = null } = {}) {
  need(ctx, 'requests.create');
  return db.transaction(() => {
    const status = input.status === undefined ? 'new' : cleanEnum(input.status, STATUSES, 'status');
    if (!manages(ctx) && !STAFF_STATUSES.includes(status)) throw new ServiceError(403, 'Only a manager can set that status');
    const next = {
      title: cleanText(input.title, 'Title', 1, 200), description: cleanOptional(input.description, 'Description', 10000), status,
      requestedBy: cleanOptional(input.requestedBy, 'Requested by', 120), dueDate: cleanDate(input.dueDate, 'Due date'),
      ownerId: cleanTeamMember(db, ctx.organizationId, input.ownerId), ...cleanLinks(db, ctx, input.clientId, input.projectId),
    };
    const id = Number(db.prepare('INSERT INTO client_requests (organization_id, client_id, project_id, title, description, status, requested_by, due_date, owner_id, source_note_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, next.clientId, next.projectId, next.title, next.description, next.status, next.requestedBy, next.dueDate, next.ownerId, sourceNoteId, ctx.actor.id).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'request.create', objectType: 'client_request', objectId: id, after: { title: next.title, clientId: next.clientId, status: next.status, ...(sourceNoteId ? { sourceNoteId } : {}) } });
    const accountOwner = db.prepare('SELECT account_owner_id AS id FROM clients WHERE organization_id = ? AND id = ?').get(ctx.organizationId, next.clientId);
    notifications.notify(db, ctx, { userIds: [accountOwner && accountOwner.id], type: 'request_new', title: `New client request: ${next.title}`, link: `#/requests/${id}`, objectType: 'client_request', objectId: id, dedupeKey: `request_new:${id}` });
    notifications.notify(db, ctx, { userIds: next.ownerId, type: 'request_assigned', title: `Client request for you: ${next.title}`, link: `#/requests/${id}`, objectType: 'client_request', objectId: id, dedupeKey: `request_assigned:${id}` });
    return getRequest(db, ctx, id);
  })();
}

function updateRequest(db, ctx, id, patch = {}) {
  need(ctx, 'requests.view');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    const row = shape(ctx, current);
    if (!row.canEdit) throw new ServiceError(403, 'Not allowed');
    const next = { ...current };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.description !== undefined) next.description = cleanOptional(patch.description, 'Description', 10000);
    if (patch.status !== undefined) {
      next.status = cleanEnum(patch.status, STATUSES, 'status');
      if (!manages(ctx) && !STAFF_STATUSES.includes(next.status)) throw new ServiceError(403, 'Only a manager can set that status');
    }
    if (patch.requestedBy !== undefined) next.requestedBy = cleanOptional(patch.requestedBy, 'Requested by', 120);
    if (patch.dueDate !== undefined) next.dueDate = cleanDate(patch.dueDate, 'Due date');
    if (patch.ownerId !== undefined) next.ownerId = cleanTeamMember(db, ctx.organizationId, patch.ownerId);
    if (patch.clientId !== undefined || patch.projectId !== undefined) {
      const clientId = patch.clientId !== undefined ? patch.clientId : current.clientId;
      const projectId = patch.projectId !== undefined ? patch.projectId : (patch.clientId !== undefined && Number(patch.clientId) !== current.clientId ? null : current.projectId);
      Object.assign(next, cleanLinks(db, ctx, clientId, projectId));
    }
    const d = diff(current, next, FIELDS);
    if (!d.changed) return row;
    db.prepare("UPDATE client_requests SET title = ?, description = ?, status = ?, client_id = ?, project_id = ?, requested_by = ?, due_date = ?, owner_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(next.title, next.description, next.status, next.clientId, next.projectId, next.requestedBy, next.dueDate, next.ownerId, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'request.update', objectType: 'client_request', objectId: current.id, before: d.before, after: d.after });
    if (d.after.ownerId) notifications.notify(db, ctx, { userIds: next.ownerId, type: 'request_assigned', title: `Client request for you: ${next.title}`, link: `#/requests/${current.id}`, objectType: 'client_request', objectId: current.id, dedupeKey: `request_assigned:${current.id}` });
    return getRequest(db, ctx, id);
  })();
}

// Turn a request into a task. The request keeps the link and moves to In progress. Managers only.
function convertToTask(db, ctx, id, input = {}) {
  need(ctx, 'requests.manage');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    if (current.taskId) throw new ServiceError(400, 'This request already has a task');
    if (['completed', 'rejected'].includes(current.status)) throw new ServiceError(400, `A ${current.status} request cannot become a task`);
    const projectId = input.projectId || current.projectId;
    if (!projectId) throw new ServiceError(400, 'Choose a project for the task');
    const project = projects.find(db, ctx.organizationId, projectId);
    if (project.clientId !== current.clientId) throw new ServiceError(400, 'That project belongs to another client');
    const task = tasks.createTask(db, ctx, {
      projectId: project.id, title: input.title === undefined ? current.title : input.title,
      description: input.description === undefined ? [current.description, `From the client request #${current.id}.`].filter(Boolean).join('\n\n') : input.description,
      assigneeId: input.assigneeId === undefined ? current.ownerId : input.assigneeId, dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
      priority: input.priority, estimateHours: input.estimateHours,
    });
    const status = ['new', 'reviewing', 'approved'].includes(current.status) ? 'in_progress' : current.status;
    db.prepare("UPDATE client_requests SET task_id = ?, project_id = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(task.id, project.id, status, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'request.convert', objectType: 'client_request', objectId: current.id, before: { status: current.status }, after: { status, taskId: task.id } });
    return { request: getRequest(db, ctx, id), task };
  })();
}

function deleteRequest(db, ctx, id) {
  need(ctx, 'requests.manage');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    db.prepare('DELETE FROM client_requests WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'request.delete', objectType: 'client_request', objectId: current.id, before: { title: current.title, status: current.status } });
    return { deleted: true };
  })();
}

module.exports = { STATUSES, listRequests, getRequest, createRequest, updateRequest, convertToTask, deleteRequest };
