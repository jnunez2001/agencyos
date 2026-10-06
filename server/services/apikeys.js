// Joshua Nunez
// API keys for AI access. A key acts as the person who made it, with that person's role read live on every call.
// The token is shown once; only its hash is stored.
const crypto = require('crypto');
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanEnum, diff } = require('./validate');
const perms = require('./permissions');

const ACCESS = ['read', 'propose', 'direct'];
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx) => { if (!perms.can(ctx.actor.role, 'ai.use')) throw new ServiceError(403, 'Not allowed'); };
// Everyone sees and changes their own connections. Owner and Admin see all of the agency's.
const seesAll = (ctx) => perms.can(ctx.actor.role, 'ai.manage');

const SELECT = `
  SELECT k.id, k.name, k.access, k.prefix, k.kind, k.user_id AS userId, u.display_name AS ownerName,
         k.created_at AS createdAt, k.last_used_at AS lastUsedAt, k.revoked_at AS revokedAt
    FROM api_keys k JOIN users u ON u.id = k.user_id
   WHERE k.organization_id = ?`;
const shape = (r) => ({ id: r.id, name: r.name, access: r.access, prefix: r.prefix, kind: r.kind, userId: r.userId, ownerName: r.ownerName, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revoked: !!r.revokedAt });

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND k.id = ?`).get(ctx.organizationId, Number(id));
  if (!row || (!seesAll(ctx) && row.userId !== ctx.actor.id)) throw new ServiceError(404, 'Key not found');
  return row;
}

function listKeys(db, ctx) {
  need(ctx);
  return db.prepare(`${SELECT} ${seesAll(ctx) ? '' : 'AND k.user_id = ?'} ORDER BY k.id DESC`).all(...(seesAll(ctx) ? [ctx.organizationId] : [ctx.organizationId, ctx.actor.id])).map(shape);
}

function createKey(db, ctx, input = {}) {
  need(ctx);
  const name = cleanText(input.name, 'Name', 1, 60);
  const access = cleanEnum(input.access, ACCESS, 'access level');
  const token = `aos_${crypto.randomBytes(24).toString('base64url')}`;
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO api_keys (organization_id, user_id, name, access, token_hash, prefix) VALUES (?, ?, ?, ?, ?, ?)').run(ctx.organizationId, ctx.actor.id, name, access, sha256(token), token.slice(0, 8)).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'apikey.create', objectType: 'api_key', objectId: id, after: { name, access } });
    // The token is returned here and nowhere else.
    return { ...shape(find(db, ctx, id)), token };
  })();
}

function updateKey(db, ctx, id, patch = {}) {
  need(ctx);
  return db.transaction(() => {
    const current = find(db, ctx, id);
    if (current.revokedAt) throw new ServiceError(400, 'This key is revoked');
    const next = { name: current.name, access: current.access };
    if (patch.name !== undefined) next.name = cleanText(patch.name, 'Name', 1, 60);
    if (patch.access !== undefined) next.access = cleanEnum(patch.access, ACCESS, 'access level');
    const d = diff({ name: current.name, access: current.access }, next, ['name', 'access']);
    if (!d.changed) return shape(current);
    db.prepare('UPDATE api_keys SET name = ?, access = ? WHERE organization_id = ? AND id = ?').run(next.name, next.access, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'apikey.update', objectType: 'api_key', objectId: current.id, before: d.before, after: d.after });
    return shape(find(db, ctx, id));
  })();
}

function revokeKey(db, ctx, id) {
  need(ctx);
  db.transaction(() => {
    const current = find(db, ctx, id);
    if (current.revokedAt) return;
    db.prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'apikey.revoke', objectType: 'api_key', objectId: current.id, before: { name: current.name } });
  })();
  return { ok: true };
}

const touch = (db, row) => {
  if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > 60 * 1000) {
    db.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  }
};
const KEY_COLUMNS = `k.id, k.access, k.organization_id AS organizationId, k.last_used_at AS lastUsedAt, u.id AS userId, m.role`;
const KEY_JOINS = `JOIN users u ON u.id = k.user_id AND u.is_active = 1
       JOIN organization_members m ON m.user_id = u.id AND m.organization_id = k.organization_id`;

// The person and agency behind a token, or null. Revoked keys and deactivated people do not authenticate.
// The role is read live, so demoting someone limits their keys at once. Two kinds of token work here: a key
// (aos_) made on the AI page, and an access token (aot_) from the OAuth sign-in used by claude.ai.
function authenticate(db, token) {
  if (typeof token !== 'string') return null;
  let row = null;
  if (/^aos_[A-Za-z0-9_-]{20,64}$/.test(token)) {
    row = db.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys k ${KEY_JOINS} WHERE k.token_hash = ? AND k.revoked_at IS NULL`).get(sha256(token));
  } else if (/^aot_[A-Za-z0-9_-]{20,64}$/.test(token)) {
    row = db.prepare(
      `SELECT ${KEY_COLUMNS} FROM oauth_tokens t JOIN api_keys k ON k.id = t.key_id ${KEY_JOINS}
        WHERE t.access_hash = ? AND t.access_expires_at > ? AND k.revoked_at IS NULL`
    ).get(sha256(token), new Date().toISOString());
  }
  if (!row) return null;
  touch(db, row);
  return { keyId: row.id, access: row.access, organizationId: row.organizationId, actor: { id: row.userId, role: row.role } };
}

module.exports = { ACCESS, listKeys, createKey, updateKey, revokeKey, authenticate, sha256 };
