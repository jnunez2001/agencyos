// Joshua Nunez
// Follow-ups: small promises that come out of meetings. Anyone but a Contractor adds them. The assignee, the creator
// and Managers change them; a Contractor sees only the ones assigned to them.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, cleanTeamMember, diff } = require('./validate');
const clients = require('./clients');
const projects = require('./projects');
const { today } = require('./dates');
const perms = require('./permissions');
const notifications = require('./notifications');

const STATUSES = ['open', 'done', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const FIELDS = ['title', 'details', 'dueDate', 'assigneeId', 'status', 'clientId', 'projectId', 'priority', 'requestId', 'taskId'];
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const manages = (ctx) => perms.can(ctx.actor.role, 'followups.manage');
const seesAll = (ctx) => perms.can(ctx.actor.role, 'clients.view');

const SELECT = `
  SELECT f.id, f.title, f.details, f.due_date AS dueDate, f.assignee_id AS assigneeId, au.display_name AS assigneeName, f.status, f.priority, f.completed_at AS completedAt, f.request_id AS requestId, rq.title AS requestTitle, f.task_id AS taskId, tk.title AS taskTitle,
         f.client_id AS clientId, c.name AS clientName, f.project_id AS projectId, p.name AS projectName,
         f.source_note_id AS sourceNoteId, n.title AS sourceNoteTitle, f.created_by AS createdBy, cu.display_name AS createdByName, f.created_at AS createdAt, f.updated_at AS updatedAt
    FROM follow_ups f
    LEFT JOIN users au ON au.id = f.assignee_id
    LEFT JOIN clients c ON c.id = f.client_id AND c.organization_id = f.organization_id
    LEFT JOIN projects p ON p.id = f.project_id AND p.organization_id = f.organization_id
    LEFT JOIN meeting_notes n ON n.id = f.source_note_id AND n.organization_id = f.organization_id
    LEFT JOIN users cu ON cu.id = f.created_by
    LEFT JOIN client_requests rq ON rq.id = f.request_id AND rq.organization_id = f.organization_id
    LEFT JOIN tasks tk ON tk.id = f.task_id AND tk.organization_id = f.organization_id
   WHERE f.organization_id = ?`;

const scope = (ctx) => (seesAll(ctx) ? '' : ' AND f.assignee_id = ?');
const scopeParams = (ctx) => (seesAll(ctx) ? [] : [ctx.actor.id]);

function shape(db, ctx, row) {
  const mine = row.assigneeId === ctx.actor.id || row.createdBy === ctx.actor.id;
  const { clientName, projectName, requestTitle, taskTitle, ...rest } = row;
  return { ...rest, requestTitle: seesAll(ctx) ? requestTitle : null, taskTitle: seesAll(ctx) ? taskTitle : null, clientName: seesAll(ctx) ? clientName : null, projectName: seesAll(ctx) ? projectName : null,
    isOverdue: !!(row.dueDate && row.status === 'open' && row.dueDate < today(db, ctx)), canEdit: manages(ctx) || mine, canDelete: manages(ctx) };
}

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND f.id = ?${scope(ctx)}`).get(ctx.organizationId, Number(id), ...scopeParams(ctx));
  if (!row) throw new ServiceError(404, 'Follow-up not found');
  return row;
}
function getFollowUp(db, ctx, id) { need(ctx, 'followups.view'); return shape(db, ctx, find(db, ctx, id)); }

function listFollowUps(db, ctx, { clientId, projectId, requestId, taskId, priority, status, assigneeId, mine, overdue, q } = {}) {
  need(ctx, 'followups.view');
  const where = []; const params = [ctx.organizationId];
  if (clientId) { where.push('f.client_id = ?'); params.push(Number(clientId)); }
  if (projectId) { where.push('f.project_id = ?'); params.push(Number(projectId)); }
  if (requestId) { where.push('f.request_id = ?'); params.push(Number(requestId)); }
  if (taskId) { where.push('f.task_id = ?'); params.push(Number(taskId)); }
  if (priority) { where.push('f.priority = ?'); params.push(cleanEnum(priority, PRIORITIES, 'priority')); }
  if (status) { cleanEnum(status, STATUSES, 'status'); where.push('f.status = ?'); params.push(status); }
  if (assigneeId) { where.push('f.assignee_id = ?'); params.push(Number(assigneeId)); }
  if (mine) { where.push('f.assignee_id = ?'); params.push(ctx.actor.id); }
  if (overdue) { where.push("f.status = 'open' AND f.due_date < ?"); params.push(today(db, ctx)); }
  if (q) { where.push("f.title LIKE ? ESCAPE '\\'"); params.push(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`); }
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')}${scope(ctx)} ORDER BY (f.status != 'open'), f.due_date IS NULL, f.due_date, f.id DESC LIMIT 300`).all(...params, ...scopeParams(ctx)).map((r) => shape(db, ctx, r));
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

// A linked request or task must be this agency's and, when the follow-up has a client, that client's. With no client
// yet, the link gives it one.
function cleanRefs(db, ctx, links, requestId, taskId) {
  let clientId = links.clientId;
  let reqId = null; let taskRef = null;
  if (requestId != null && requestId !== '') {
    const r = db.prepare('SELECT id, client_id AS clientId FROM client_requests WHERE organization_id = ? AND id = ?').get(ctx.organizationId, Number(requestId));
    if (!r) throw new ServiceError(404, 'Request not found');
    if (clientId && r.clientId !== clientId) throw new ServiceError(400, 'That request belongs to another client');
    clientId = clientId || r.clientId; reqId = r.id;
  }
  if (taskId != null && taskId !== '') {
    const t = db.prepare('SELECT t.id, p.client_id AS clientId FROM tasks t JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id WHERE t.organization_id = ? AND t.id = ?').get(ctx.organizationId, Number(taskId));
    if (!t) throw new ServiceError(404, 'Task not found');
    if (clientId && t.clientId !== clientId) throw new ServiceError(400, 'That task belongs to another client');
    clientId = clientId || t.clientId; taskRef = t.id;
  }
  return { ...links, clientId, requestId: reqId, taskId: taskRef };
}

function createFollowUp(db, ctx, input = {}, { sourceNoteId = null } = {}) {
  need(ctx, 'followups.create');
  return db.transaction(() => {
    const next = { title: cleanText(input.title, 'Title', 1, 200), details: cleanOptional(input.details, 'Details', 10000), dueDate: cleanDate(input.dueDate, 'Due date'),
      assigneeId: cleanTeamMember(db, ctx.organizationId, input.assigneeId), priority: input.priority === undefined ? 'normal' : cleanEnum(input.priority, PRIORITIES, 'priority'),
      ...cleanRefs(db, ctx, cleanLinks(db, ctx, input.clientId, input.projectId), input.requestId, input.taskId) };
    const id = Number(db.prepare('INSERT INTO follow_ups (organization_id, client_id, project_id, title, details, due_date, assignee_id, source_note_id, created_by, priority, request_id, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, next.clientId, next.projectId, next.title, next.details, next.dueDate, next.assigneeId, sourceNoteId, ctx.actor.id, next.priority, next.requestId, next.taskId).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'followup.create', objectType: 'follow_up', objectId: id, after: { title: next.title, assigneeId: next.assigneeId, dueDate: next.dueDate, ...(sourceNoteId ? { sourceNoteId } : {}) } });
    notifications.notify(db, ctx, { userIds: next.assigneeId, type: 'followup_assigned', title: `Follow-up for you: ${next.title}`, link: '#/meetings/follow-ups', objectType: 'follow_up', objectId: id, dedupeKey: `followup_assigned:${id}` });
    return getFollowUp(db, ctx, id);
  })();
}

function updateFollowUp(db, ctx, id, patch = {}) {
  need(ctx, 'followups.view');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    if (!shape(db, ctx, current).canEdit) throw new ServiceError(403, 'Not allowed');
    // Someone who is not a manager may only mark a follow-up done, cancelled or open again.
    if (!manages(ctx) && Object.keys(patch).some((k) => k !== 'status') && current.createdBy !== ctx.actor.id) throw new ServiceError(403, 'Not allowed');
    const next = { ...current };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.details !== undefined) next.details = cleanOptional(patch.details, 'Details', 10000);
    if (patch.dueDate !== undefined) next.dueDate = cleanDate(patch.dueDate, 'Due date');
    if (patch.assigneeId !== undefined) next.assigneeId = cleanTeamMember(db, ctx.organizationId, patch.assigneeId);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (patch.priority !== undefined) next.priority = cleanEnum(patch.priority, PRIORITIES, 'priority');
    if (patch.clientId !== undefined || patch.projectId !== undefined) {
      const clientId = patch.clientId !== undefined ? patch.clientId : current.clientId;
      const projectId = patch.projectId !== undefined ? patch.projectId : (patch.clientId !== undefined && patch.clientId !== current.clientId ? null : current.projectId);
      Object.assign(next, cleanLinks(db, ctx, clientId, projectId));
    }
    if (patch.requestId !== undefined || patch.taskId !== undefined || patch.clientId !== undefined) {
      Object.assign(next, cleanRefs(db, ctx, { clientId: next.clientId, projectId: next.projectId },
        patch.requestId !== undefined ? patch.requestId : current.requestId, patch.taskId !== undefined ? patch.taskId : current.taskId));
    }
    const d = diff(current, next, FIELDS);
    if (!d.changed) return shape(db, ctx, current);
    const completing = next.status === 'done' && current.status !== 'done';
    db.prepare("UPDATE follow_ups SET title = ?, details = ?, due_date = ?, assignee_id = ?, status = ?, client_id = ?, project_id = ?, priority = ?, request_id = ?, task_id = ?, completed_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(next.title, next.details, next.dueDate, next.assigneeId, next.status, next.clientId, next.projectId, next.priority, next.requestId, next.taskId, next.status === 'done' ? (completing ? new Date().toISOString() : current.completedAt) : null, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'followup.update', objectType: 'follow_up', objectId: current.id, before: d.before, after: d.after });
    if (d.after.assigneeId) notifications.notify(db, ctx, { userIds: next.assigneeId, type: 'followup_assigned', title: `Follow-up for you: ${next.title}`, link: '#/meetings/follow-ups', objectType: 'follow_up', objectId: current.id, dedupeKey: `followup_assigned:${current.id}` });
    return getFollowUp(db, ctx, id);
  })();
}

function deleteFollowUp(db, ctx, id) {
  need(ctx, 'followups.manage');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    db.prepare('DELETE FROM follow_ups WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'followup.delete', objectType: 'follow_up', objectId: current.id, before: { title: current.title } });
    return { deleted: true };
  })();
}

module.exports = { STATUSES, PRIORITIES, listFollowUps, getFollowUp, createFollowUp, updateFollowUp, deleteFollowUp };
