// Joshua Nunez
// The activity log. One row per important action, written in the same transaction as the change.
// `before` and `after` are small plain objects. Never put passwords, tokens or hashes in them.
const SOURCES = ['web', 'api', 'ai', 'system'];

function logActivity(db, { organizationId = null, actorUserId = null, action, objectType = null, objectId = null, before = null, after = null, source = 'web', ip = null }) {
  if (!SOURCES.includes(source)) throw new Error(`Unknown activity source: ${source}`);
  db.prepare(
    `INSERT INTO activity_logs (organization_id, actor_user_id, action, object_type, object_id, before_json, after_json, source, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(organizationId, actorUserId, action, objectType, objectId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, source, ip);
}

module.exports = { logActivity, SOURCES };
