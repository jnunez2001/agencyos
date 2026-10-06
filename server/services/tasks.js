// Joshua Nunez
// Tasks and their comments. A Contractor sees only tasks assigned to them: any other task is "not found" for them,
// in lists, in details and in comments. An Employee or Contractor may change only the status of their own task.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, cleanTeamMember, diff } = require('./validate');
const { today } = require('./dates');
const perms = require('./permissions');

const STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const FIELDS = ['title', 'description', 'status', 'priority', 'assigneeId', 'dueDate', 'estimateHours', 'projectId'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const seesOnlyOwn = (ctx) => !perms.can(ctx.actor.role, 'clients.view');

const SELECT = `
  SELECT t.id, t.project_id AS projectId, p.name AS projectName, p.client_id AS clientId, c.name AS clientName, p.status AS projectStatus,
         t.title, t.description, t.status, t.priority, t.assignee_id AS assigneeId, au.display_name AS assigneeName,
         t.due_date AS dueDate, t.estimate_hours AS estimateHours, t.completed_at AS completedAt,
         t.created_at AS createdAt, t.updated_at AS updatedAt
    FROM tasks t
    JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
    JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
    LEFT JOIN users au ON au.id = t.assignee_id
   WHERE t.organization_id = ?`;

function shape(db, ctx, row, todayDate) {
  const manage = perms.can(ctx.actor.role, 'tasks.manage');
  const { projectStatus, ...rest } = row;
  return {
    ...rest,
    isOverdue: !!(row.dueDate && row.status !== 'done' && row.dueDate < todayDate),
    // What this viewer may do with it, so the screens never need their own copy of the rule.
    canEdit: manage,
    canChangeStatus: manage || row.assigneeId === ctx.actor.id,
  };
}

function find(db, ctx, id) {
  const where = seesOnlyOwn(ctx) ? ' AND t.assignee_id = ?' : '';
  const row = db.prepare(`${SELECT} AND t.id = ?${where}`).get(...[ctx.organizationId, Number(id), ...(seesOnlyOwn(ctx) ? [ctx.actor.id] : [])]);
  if (!row) throw new ServiceError(404, 'Task not found');
  return row;
}

function listTasks(db, ctx, q = {}) {
  need(ctx, 'tasks.view');
  const todayDate = today(db, ctx);
  const where = [];
  const params = [ctx.organizationId];
  if (seesOnlyOwn(ctx)) { where.push('t.assignee_id = ?'); params.push(ctx.actor.id); }
  if (q.projectId) { where.push('t.project_id = ?'); params.push(Number(q.projectId)); }
  if (q.assigneeId) { where.push('t.assignee_id = ?'); params.push(Number(q.assigneeId)); }
  if (q.mine) { where.push('t.assignee_id = ?'); params.push(ctx.actor.id); }
  if (q.status) { where.push('t.status = ?'); params.push(cleanEnum(q.status, STATUSES, 'status')); }
  if (q.overdue) { where.push("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ?"); params.push(todayDate); }
  if (q.q) { where.push("t.title LIKE ? ESCAPE '\\'"); params.push(`%${String(q.q).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`); }
  const rows = db.prepare(
    `${SELECT} ${where.map((w) => `AND ${w}`).join(' ')}
      ORDER BY (t.status = 'done'),
               (CASE WHEN t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ? THEN 0 ELSE 1 END),
               CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               (t.due_date IS NULL), t.due_date, t.id
      LIMIT 500`
  ).all(...params, todayDate);
  return rows.map((r) => shape(db, ctx, r, todayDate));
}

function getTask(db, ctx, id) {
  need(ctx, 'tasks.view');
  return shape(db, ctx, find(db, ctx, id), today(db, ctx));
}

// The project must be this agency's and not archived.
function cleanProject(db, organizationId, value) {
  const p = db.prepare('SELECT id, status FROM projects WHERE organization_id = ? AND id = ?').get(organizationId, Number(value));
  if (!p) throw new ServiceError(404, 'Project not found');
  if (p.status === 'archived') throw new ServiceError(400, 'This project is archived. Make it active before adding tasks');
  return p.id;
}

function cleanEstimate(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000) throw new ServiceError(400, 'Estimate must be a number of hours from 0 to 1000');
  return Math.round(n * 100) / 100;
}

function createTask(db, ctx, input = {}) {
  need(ctx, 'tasks.manage');
  return db.transaction(() => {
    const next = {
      projectId: cleanProject(db, ctx.organizationId, input.projectId),
      title: cleanText(input.title, 'Title', 1, 200),
      description: cleanOptional(input.description, 'Description', 10000),
      status: input.status === undefined ? 'todo' : cleanEnum(input.status, STATUSES, 'status'),
      priority: input.priority === undefined ? 'normal' : cleanEnum(input.priority, PRIORITIES, 'priority'),
      assigneeId: cleanTeamMember(db, ctx.organizationId, input.assigneeId),
      dueDate: cleanDate(input.dueDate, 'Due date'),
      estimateHours: cleanEstimate(input.estimateHours),
    };
    const id = Number(db.prepare(
      `INSERT INTO tasks (organization_id, project_id, title, description, status, priority, assignee_id, due_date, estimate_hours, completed_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${next.status === 'done' ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'}, ?)`
    ).run(ctx.organizationId, next.projectId, next.title, next.description, next.status, next.priority, next.assigneeId, next.dueDate, next.estimateHours, ctx.actor.id).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'task.create', objectType: 'task', objectId: id, after: { title: next.title, projectId: next.projectId, assigneeId: next.assigneeId } });
    return shape(db, ctx, find(db, ctx, id), today(db, ctx));
  })();
}

function updateTask(db, ctx, id, patch = {}) {
  need(ctx, 'tasks.work');
  return db.transaction(() => {
    const manage = perms.can(ctx.actor.role, 'tasks.manage');
    // Someone who may only do the work can change nothing but the status, and only of their own task.
    if (!manage && Object.keys(patch).some((k) => k !== 'status')) throw new ServiceError(403, 'Not allowed');
    const row = find(db, ctx, id);
    if (!manage && row.assigneeId !== ctx.actor.id) throw new ServiceError(403, 'Not allowed');
    const current = { ...row };
    const next = { ...row };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.description !== undefined) next.description = cleanOptional(patch.description, 'Description', 10000);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (patch.priority !== undefined) next.priority = cleanEnum(patch.priority, PRIORITIES, 'priority');
    if (patch.assigneeId !== undefined) next.assigneeId = cleanTeamMember(db, ctx.organizationId, patch.assigneeId);
    if (patch.dueDate !== undefined) next.dueDate = cleanDate(patch.dueDate, 'Due date');
    if (patch.estimateHours !== undefined) next.estimateHours = cleanEstimate(patch.estimateHours);
    if (patch.projectId !== undefined && Number(patch.projectId) !== row.projectId) next.projectId = cleanProject(db, ctx.organizationId, patch.projectId);
    const d = diff(current, next, FIELDS);
    if (!d.changed) return shape(db, ctx, row, today(db, ctx));
    const completed = d.after.status ? (next.status === 'done' ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL') : 'completed_at';
    db.prepare(
      `UPDATE tasks SET project_id = ?, title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, due_date = ?, estimate_hours = ?,
              completed_at = ${completed}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE organization_id = ? AND id = ?`
    ).run(next.projectId, next.title, next.description, next.status, next.priority, next.assigneeId, next.dueDate, next.estimateHours, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'task.update', objectType: 'task', objectId: row.id, before: d.before, after: d.after });
    return shape(db, ctx, find(db, ctx, id), today(db, ctx));
  })();
}

function deleteTask(db, ctx, id) {
  need(ctx, 'tasks.manage');
  db.transaction(() => {
    const row = find(db, ctx, id);
    db.prepare('DELETE FROM tasks WHERE organization_id = ? AND id = ?').run(ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'task.delete', objectType: 'task', objectId: row.id, before: { title: row.title, projectId: row.projectId, status: row.status, assigneeId: row.assigneeId } });
  })();
  return { ok: true };
}

const commentShape = (r) => ({ id: r.id, taskId: r.task_id, authorId: r.author_id, authorName: r.authorName || 'Former member', body: r.body, createdAt: r.created_at });

function listComments(db, ctx, taskId) {
  need(ctx, 'tasks.view');
  const task = find(db, ctx, taskId);
  return db.prepare('SELECT c.*, u.display_name AS authorName FROM task_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.organization_id = ? AND c.task_id = ? ORDER BY c.id').all(ctx.organizationId, task.id).map(commentShape);
}

function addComment(db, ctx, taskId, input = {}) {
  need(ctx, 'tasks.work');
  return db.transaction(() => {
    const task = find(db, ctx, taskId);
    const body = cleanText(input.body, 'Comment', 1, 5000);
    const id = Number(db.prepare('INSERT INTO task_comments (organization_id, task_id, author_id, body) VALUES (?, ?, ?, ?)').run(ctx.organizationId, task.id, ctx.actor.id, body).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'task.comment', objectType: 'task', objectId: task.id, after: { commentId: id } });
    return commentShape(db.prepare('SELECT c.*, u.display_name AS authorName FROM task_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?').get(id));
  })();
}

module.exports = { STATUSES, PRIORITIES, listTasks, getTask, createTask, updateTask, deleteTask, listComments, addComment };
