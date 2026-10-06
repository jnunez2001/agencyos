// Joshua Nunez
// Client goals: why the agency does the work. A goal belongs to a client. Projects and tasks can support a goal of
// their own client. Goals are achieved or dropped, never deleted. Every query is scoped by the organization.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, diff } = require('./validate');
const { cleanServiceId } = require('./services');
const perms = require('./permissions');

const STATUSES = ['active', 'achieved', 'dropped'];
const FIELDS = ['title', 'why', 'target', 'dueDate', 'serviceId', 'status'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };

const SELECT = `
  SELECT g.id, g.client_id AS clientId, g.title, g.why, g.target, g.due_date AS dueDate, g.service_id AS serviceId, sv.name AS serviceName, g.status,
         g.created_at AS createdAt, g.updated_at AS updatedAt,
         (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
           WHERE t.organization_id = g.organization_id AND COALESCE(t.goal_id, p.goal_id) = g.id) AS tasksTotal,
         (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
           WHERE t.organization_id = g.organization_id AND COALESCE(t.goal_id, p.goal_id) = g.id AND t.status = 'done') AS tasksDone,
         (SELECT COUNT(*) FROM projects p WHERE p.organization_id = g.organization_id AND p.goal_id = g.id) AS projectCount
    FROM client_goals g
    LEFT JOIN services sv ON sv.id = g.service_id
   WHERE g.organization_id = ?`;

const shape = ({ tasksTotal, tasksDone, projectCount, ...r }) => ({ ...r, progress: { tasksTotal, tasksDone, projects: projectCount } });

function findClient(db, organizationId, clientId) {
  const row = db.prepare('SELECT id, status FROM clients WHERE organization_id = ? AND id = ?').get(organizationId, Number(clientId));
  if (!row) throw new ServiceError(404, 'Client not found');
  return row;
}

function find(db, organizationId, id) {
  const row = db.prepare(`${SELECT} AND g.id = ?`).get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Goal not found');
  return row;
}

// Used by clients: the goals of one client, newest first within status order.
function forClient(db, organizationId, clientId, status) {
  return db.prepare(`${SELECT} AND g.client_id = ? ${status ? 'AND g.status = ?' : ''} ORDER BY (g.status != 'active'), g.id DESC`)
    .all(...(status ? [organizationId, clientId, status] : [organizationId, clientId])).map(shape);
}

function listGoals(db, ctx, clientId, { status } = {}) {
  need(ctx, 'clients.view');
  if (status) cleanEnum(status, STATUSES, 'status');
  findClient(db, ctx.organizationId, clientId);
  return forClient(db, ctx.organizationId, Number(clientId), status);
}

function createGoal(db, ctx, clientId, input = {}) {
  need(ctx, 'clients.manage');
  return db.transaction(() => {
    const client = findClient(db, ctx.organizationId, clientId);
    const next = {
      title: cleanText(input.title, 'The goal statement', 1, 200),
      why: cleanOptional(input.why, 'Why', 2000),
      target: cleanOptional(input.target, 'Target', 200),
      dueDate: cleanDate(input.dueDate, 'Target date'),
      serviceId: cleanServiceId(db, ctx.organizationId, input.serviceId),
      status: input.status === undefined ? 'active' : cleanEnum(input.status, STATUSES, 'status'),
    };
    const id = Number(db.prepare('INSERT INTO client_goals (organization_id, client_id, title, why, target, due_date, service_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, client.id, next.title, next.why, next.target, next.dueDate, next.serviceId, next.status, ctx.actor.id).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'goal.create', objectType: 'goal', objectId: id, after: { title: next.title, clientId: client.id, status: next.status } });
    return shape(find(db, ctx.organizationId, id));
  })();
}

function updateGoal(db, ctx, id, patch = {}) {
  need(ctx, 'clients.manage');
  return db.transaction(() => {
    const current = find(db, ctx.organizationId, id);
    const next = { ...current };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'The goal statement', 1, 200);
    if (patch.why !== undefined) next.why = cleanOptional(patch.why, 'Why', 2000);
    if (patch.target !== undefined) next.target = cleanOptional(patch.target, 'Target', 200);
    if (patch.dueDate !== undefined) next.dueDate = cleanDate(patch.dueDate, 'Target date');
    if (patch.serviceId !== undefined) next.serviceId = cleanServiceId(db, ctx.organizationId, patch.serviceId, current.serviceId);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    const d = diff(current, next, FIELDS);
    if (!d.changed) return shape(current);
    db.prepare("UPDATE client_goals SET title = ?, why = ?, target = ?, due_date = ?, service_id = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(next.title, next.why, next.target, next.dueDate, next.serviceId, next.status, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'goal.update', objectType: 'goal', objectId: current.id, before: d.before, after: d.after });
    return shape(find(db, ctx.organizationId, id));
  })();
}

// For projects and tasks: the goal must exist here, belong to the same client, and be active (unless it is
// the one already linked, which may stay while it is achieved or dropped).
function checkLinkable(db, organizationId, goalId, clientId, currentGoalId = null) {
  const g = db.prepare('SELECT id, client_id AS clientId, status FROM client_goals WHERE organization_id = ? AND id = ?').get(organizationId, Number(goalId));
  if (!g) throw new ServiceError(404, 'Goal not found');
  if (g.clientId !== clientId) throw new ServiceError(400, 'The goal must belong to the same client');
  if (g.status !== 'active' && g.id !== currentGoalId) throw new ServiceError(400, 'Only an active goal can be linked');
  return g.id;
}

module.exports = { STATUSES, listGoals, createGoal, updateGoal, forClient, checkLinkable, find };
