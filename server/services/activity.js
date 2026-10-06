// Joshua Nunez
// Reading the activity log. Only an Owner or Admin may, and only their own agency's rows.
const { ServiceError } = require('./errors');
const perms = require('./permissions');

const parse = (json) => (json ? JSON.parse(json) : null);

function listActivity(db, ctx, { actorId, action, limit = 50 } = {}) {
  if (!perms.can(ctx.actor.role, 'activity.view')) throw new ServiceError(403, 'Not allowed');
  const where = ['a.organization_id = ?'];
  const params = [ctx.organizationId];
  if (actorId) { where.push('a.actor_user_id = ?'); params.push(Number(actorId)); }
  if (action) { where.push('a.action = ?'); params.push(String(action)); }
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = db.prepare(
    `SELECT a.id, a.action, a.object_type AS objectType, a.object_id AS objectId, a.actor_user_id AS actorId, u.display_name AS actorName,
            a.before_json, a.after_json, a.source, a.ip, a.created_at AS createdAt
       FROM activity_logs a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`
  ).all(...params, cap);
  return rows.map((r) => ({ id: r.id, action: r.action, objectType: r.objectType, objectId: r.objectId, actorId: r.actorId, actorName: r.actorName || 'System', before: parse(r.before_json), after: parse(r.after_json), source: r.source, ip: r.ip, createdAt: r.createdAt }));
}

module.exports = { listActivity };
