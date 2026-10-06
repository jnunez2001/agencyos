// Joshua Nunez
const crypto = require('crypto');
const config = require('../config');
const { verifyPassword, verifyAgainstDummy, hashPassword, passwordProblem } = require('./passwords');
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');

const iso = (d) => d.toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- login throttling ----

function windowStart() {
  return iso(new Date(Date.now() - config.login.windowMinutes * 60 * 1000));
}

function failuresFor(db, key) {
  return db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND created_at >= ?').get(key, windowStart()).n;
}

function isLockedOut(db, username, ip) {
  return failuresFor(db, `u:${String(username).toLowerCase()}`) >= config.login.maxPerUsername || failuresFor(db, `ip:${ip}`) >= config.login.maxPerIp;
}

function recordFailure(db, username, ip) {
  const stmt = db.prepare('INSERT INTO login_attempts (key) VALUES (?)');
  stmt.run(`u:${String(username).toLowerCase()}`);
  stmt.run(`ip:${ip}`);
}

function pruneAttempts(db) {
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(windowStart());
}

// ---- sessions ----

function createSession(db, { userId, organizationId, ip, userAgent }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, csrf_token, user_id, organization_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), csrf, userId, organizationId, ip, String(userAgent || '').slice(0, 200), iso(expires));
  return { token, expires };
}

// Returns the signed-in person, their agency and role, or null. The role is read live, so a change applies at once.
function resolveSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id AS user_id, u.username, u.display_name, u.is_active, u.must_change_password,
              o.id AS organization_id, o.name AS organization_name, o.timezone, m.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN organization_members m ON m.user_id = u.id AND m.organization_id = s.organization_id
         JOIN organizations o ON o.id = s.organization_id
        WHERE s.token_hash = ?`
    )
    .get(sha256(token));
  if (!row || !row.is_active || row.expires_at <= iso(new Date())) return null;
  return {
    sessionId: row.session_id,
    csrf: row.csrf_token,
    user: { id: row.user_id, username: row.username, displayName: row.display_name, mustChangePassword: !!row.must_change_password },
    organization: { id: row.organization_id, name: row.organization_name, timezone: row.timezone },
    role: row.role,
  };
}

function touchSession(db, sessionId) {
  db.prepare("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(sessionId);
}

function destroySession(db, sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function destroyUserSessions(db, userId, exceptSessionId = null) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(userId, exceptSessionId);
}

function pruneSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso(new Date()));
}

// ---- login ----

// Result: { ok: true, session } | { ok: false, status, error }
async function login(db, { username, password, ip, userAgent }) {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return { ok: false, status: 400, error: 'Enter username and password' };
  }
  if (isLockedOut(db, username, ip)) {
    logActivity(db, { action: 'login.locked', source: 'system', ip, after: { username: username.slice(0, 40) } });
    return { ok: false, status: 429, error: 'Too many attempts. Try again later' };
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // A person who signs in only with Google has password sign-in turned off: it fails the same way as a wrong password.
  const valid = user && user.password_login ? await verifyPassword(password, user.password_hash) : await verifyAgainstDummy(password);
  const member = user && db.prepare('SELECT organization_id FROM organization_members WHERE user_id = ?').get(user.id);
  if (!user || !valid || !user.is_active || !member) {
    recordFailure(db, username, ip);
    logActivity(db, { actorUserId: user ? user.id : null, action: 'login.failed', source: 'system', ip, after: { username: username.slice(0, 40) } });
    return { ok: false, status: 401, error: 'Wrong username or password' };
  }
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(`u:${username.toLowerCase()}`);
  const session = createSession(db, { userId: user.id, organizationId: member.organization_id, ip, userAgent });
  logActivity(db, { organizationId: member.organization_id, actorUserId: user.id, action: 'login.success', ip });
  return { ok: true, session };
}

// The person changes their own password. This clears the "must change" flag and ends their other sessions.
async function changePassword(db, ctx, { current, next, keepSessionId = null }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.actor.id);
  if (!user || !(await verifyPassword(String(current || ''), user.password_hash))) throw new ServiceError(400, 'Your current password is not right');
  const problem = passwordProblem(next);
  if (problem) throw new ServiceError(400, problem);
  if (next === current) throw new ServiceError(400, 'Choose a different password');
  const hash = await hashPassword(next);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hash, user.id);
    destroyUserSessions(db, user.id, keepSessionId);
    logActivity(db, { organizationId: ctx.organizationId, actorUserId: user.id, action: 'password.change', objectType: 'member', objectId: user.id, source: ctx.source || 'web', ip: ctx.ip || null });
  })();
  return { ok: true };
}

module.exports = { login, recordFailure, changePassword, createSession, resolveSession, touchSession, destroySession, destroyUserSessions, pruneSessions, pruneAttempts, isLockedOut };
