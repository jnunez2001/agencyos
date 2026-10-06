// Joshua Nunez
// Projects. Each belongs to a client of the same agency. Every query is scoped by the organization.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, cleanTeamMember, diff } = require('./validate');
const clients = require('./clients');
const goals = require('./goals');
const { cleanServiceId } = require('./services');
const perms = require('./permissions');

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'];
const FIELDS = ['name', 'description', 'status', 'startDate', 'dueDate', 'managerId', 'clientId', 'serviceId', 'goalId'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT p.id, p.client_id AS clientId, c.name AS clientName, p.name, p.description, p.status,
         p.start_date AS startDate, p.due_date AS dueDate, p.manager_id AS managerId, mu.display_name AS managerName,
         p.service_id AS serviceId, sv.name AS serviceName, p.goal_id AS goalId, g.title AS goalTitle,
         p.created_at AS createdAt, p.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM tasks t WHERE t.organization_id = p.organization_id AND t.project_id = p.id AND t.status != 'done') AS openTasks,
         (SELECT COUNT(*) FROM tasks t WHERE t.organization_id = p.organization_id AND t.project_id = p.id AND t.status = 'done') AS doneTasks
    FROM projects p
    JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
    LEFT JOIN users mu ON mu.id = p.manager_id
    LEFT JOIN services sv ON sv.id = p.service_id
    LEFT JOIN client_goals g ON g.id = p.goal_id
   WHERE p.organization_id = ?`;

function find(db, organizationId, id) {
  const row = db.prepare(`${SELECT} AND p.id = ?`).get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Project not found');
  return row;
}

function listProjects(db, ctx, { clientId, status } = {}) {
  need(ctx, 'projects.view');
  if (status) cleanEnum(status, STATUSES, 'status');
  const where = [];
  const params = [ctx.organizationId];
  if (clientId) { where.push('p.client_id = ?'); params.push(Number(clientId)); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE`).all(...params);
}

function getProject(db, ctx, id) {
  need(ctx, 'projects.view');
  return find(db, ctx.organizationId, id);
}

function checkDates(startDate, dueDate) {
  if (startDate && dueDate && dueDate < startDate) throw new ServiceError(400, 'Due date cannot be before the start date');
}

function createProject(db, ctx, input = {}) {
  need(ctx, 'projects.manage');
  return db.transaction(() => {
    const client = clients.find(db, ctx.organizationId, input.clientId);
    if (client.status === 'archived') throw new ServiceError(400, 'This client is archived. Make it active before adding a project');
    const next = {
      name: cleanText(input.name, 'Name', 1, 120),
      description: cleanOptional(input.description, 'Description', 5000),
      status: input.status === undefined ? 'planning' : cleanEnum(input.status, STATUSES, 'status'),
      startDate: cleanDate(input.startDate, 'Start date'),
      dueDate: cleanDate(input.dueDate, 'Due date'),
      managerId: cleanTeamMember(db, ctx.organizationId, input.managerId),
      serviceId: cleanServiceId(db, ctx.organizationId, input.serviceId),
      goalId: input.goalId == null || input.goalId === '' ? null : goals.checkLinkable(db, ctx.organizationId, input.goalId, client.id),
    };
    checkDates(next.startDate, next.dueDate);
    const id = Number(db.prepare('INSERT INTO projects (organization_id, client_id, name, description, status, start_date, due_date, manager_id, created_by, service_id, goal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, client.id, next.name, next.description, next.status, next.startDate, next.dueDate, next.managerId, ctx.actor.id, next.serviceId, next.goalId).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'project.create', objectType: 'project', objectId: id, after: { name: next.name, clientId: client.id, status: next.status } });
    return find(db, ctx.organizationId, id);
  })();
}

function updateProject(db, ctx, id, patch = {}) {
  need(ctx, 'projects.manage');
  return db.transaction(() => {
    const current = find(db, ctx.organizationId, id);
    const next = { ...current };
    if (patch.name !== undefined) next.name = cleanText(patch.name, 'Name', 1, 120);
    if (patch.description !== undefined) next.description = cleanOptional(patch.description, 'Description', 5000);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (patch.startDate !== undefined) next.startDate = cleanDate(patch.startDate, 'Start date');
    if (patch.dueDate !== undefined) next.dueDate = cleanDate(patch.dueDate, 'Due date');
    if (patch.managerId !== undefined) next.managerId = cleanTeamMember(db, ctx.organizationId, patch.managerId);
    if (patch.clientId !== undefined && Number(patch.clientId) !== current.clientId) {
      const client = clients.find(db, ctx.organizationId, patch.clientId);
      if (client.status === 'archived') throw new ServiceError(400, 'That client is archived');
      next.clientId = client.id;
    }
    if (patch.serviceId !== undefined) next.serviceId = cleanServiceId(db, ctx.organizationId, patch.serviceId, current.serviceId);
    if (patch.goalId !== undefined) {
      next.goalId = patch.goalId == null || patch.goalId === '' ? null : goals.checkLinkable(db, ctx.organizationId, patch.goalId, next.clientId, current.goalId);
    } else if (next.goalId && next.clientId !== current.clientId) {
      throw new ServiceError(400, 'Choose a goal of the new client. The current goal belongs to another client');
    }
    checkDates(next.startDate, next.dueDate);
    const d = diff(current, next, FIELDS);
    if (!d.changed) return current;
    db.prepare(`UPDATE projects SET client_id = ?, name = ?, description = ?, status = ?, start_date = ?, due_date = ?, manager_id = ?, service_id = ?, goal_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(next.clientId, next.name, next.description, next.status, next.startDate, next.dueDate, next.managerId, next.serviceId, next.goalId, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'project.update', objectType: 'project', objectId: current.id, before: d.before, after: d.after });
    return find(db, ctx.organizationId, id);
  })();
}

module.exports = { STATUSES, listProjects, getProject, createProject, updateProject, find };
