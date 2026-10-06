// Joshua Nunez
// The people in an agency. Every function takes a context ({ organizationId, actor: { id, role }, ip, source }),
// checks the actor's permission first, and scopes every query by the organization, so another agency's member
// is always "not found".
const { hashPassword, passwordProblem } = require('./passwords');
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanUsername } = require('./validate');
const perms = require('./permissions');
const { destroyUserSessions } = require('./auth');
const store = require('./identityStore');
const crypto = require('crypto');

const SELECT = `
  SELECT u.id, u.username, u.display_name AS displayName, u.is_active AS isActive, u.must_change_password AS mustChangePassword,
         u.password_login AS passwordLogin, i.email AS googleEmail, (i.subject IS NOT NULL) AS googleLinked,
         m.role, COALESCE(p.job_title, '') AS jobTitle, COALESCE(p.department, '') AS department
    FROM organization_members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN employee_profiles p ON p.user_id = u.id
    LEFT JOIN user_identities i ON i.user_id = u.id
   WHERE m.organization_id = ?`;

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });

function shape(row, canSeeAll, actorRole) {
  const out = { id: row.id, username: row.username, displayName: row.displayName, role: row.role, isActive: !!row.isActive, jobTitle: row.jobTitle, department: row.department };
  if (canSeeAll) {
    out.mustChangePassword = !!row.mustChangePassword;
    out.passwordLogin = !!row.passwordLogin;
    out.google = { linked: !!row.googleLinked, email: row.googleEmail || null, pending: !!row.googleEmail && !row.googleLinked };
  }
  // Whether the viewer may change this person. The screens use it to show or hide the actions.
  if (actorRole) out.canManage = perms.canManage(actorRole, row.role);
  return out;
}

function findMember(db, organizationId, id) {
  const row = db.prepare(`${SELECT} AND u.id = ?`).get(organizationId, Number(id));
  if (!row) throw new ServiceError(404, 'Member not found');
  return row;
}

function listMembers(db, ctx) {
  if (!perms.can(ctx.actor.role, 'members.list')) throw new ServiceError(403, 'Not allowed');
  const detail = perms.can(ctx.actor.role, 'members.manage');
  return db.prepare(`${SELECT} ORDER BY m.id`).all(ctx.organizationId).map((r) => shape(r, detail, ctx.actor.role));
}

// Used by setup and by the Owner or Admin adding a person. The caller has already checked permission.
async function insertMember(db, { organizationId, username, displayName, role, password, mustChange, timezone, passwordLogin = true, googleEmail = null }) {
  const hash = await hashPassword(password);
  try {
    return db.transaction(() => {
      const userId = Number(db.prepare('INSERT INTO users (username, display_name, password_hash, must_change_password, password_login) VALUES (?, ?, ?, ?, ?)').run(username, displayName, hash, mustChange ? 1 : 0, passwordLogin ? 1 : 0).lastInsertRowid);
      db.prepare('INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, ?)').run(organizationId, userId, role);
      db.prepare('INSERT INTO employee_profiles (organization_id, user_id, timezone) VALUES (?, ?, ?)').run(organizationId, userId, timezone || 'Asia/Manila');
      if (googleEmail) store.upsertInvite(db, { organizationId, userId, email: googleEmail });
      return userId;
    })();
  } catch (err) {
    if (err && /UNIQUE/.test(String(err.code) + String(err.message))) throw new ServiceError(409, 'That username is already taken');
    throw err;
  }
}

async function createMember(db, ctx, input) {
  if (!perms.can(ctx.actor.role, 'members.create')) throw new ServiceError(403, 'Not allowed');
  const username = cleanUsername(input.username);
  const displayName = cleanText(input.displayName, 'Name', 1, 60);
  if (!perms.ROLES.includes(input.role)) throw new ServiceError(400, 'Choose a role');
  if (!perms.assignableRoles(ctx.actor.role).includes(input.role)) throw new ServiceError(403, 'Not allowed');
  const googleEmail = input.googleEmail === undefined || input.googleEmail === null || input.googleEmail === '' ? null : store.cleanGoogleEmail(input.googleEmail);
  const hasPassword = typeof input.password === 'string' && input.password !== '';
  // While Google is required, a non-Owner who only had a password could never sign in.
  if (input.role !== 'owner' && db.prepare('SELECT require_google AS r FROM organizations WHERE id = ?').get(ctx.organizationId).r && !googleEmail) throw new ServiceError(400, 'Your agency requires Google sign-in. Add their Google email');
  if (!hasPassword && !googleEmail) throw new ServiceError(400, 'Give a temporary password, a Google email, or both');
  if (hasPassword) { const problem = passwordProblem(input.password); if (problem) throw new ServiceError(400, problem); }
  if (googleEmail && store.emailTaken(db, googleEmail)) throw new ServiceError(409, 'That Google email is already used for another member');
  const org = db.prepare('SELECT timezone FROM organizations WHERE id = ?').get(ctx.organizationId);
  // A person invited by Google email alone has no usable password: they sign in with Google.
  const id = await insertMember(db, { organizationId: ctx.organizationId, username, displayName, role: input.role, password: hasPassword ? input.password : crypto.randomBytes(24).toString('base64url'), mustChange: hasPassword, timezone: org.timezone, passwordLogin: hasPassword, googleEmail });
  logActivity(db, { ...logCtx(ctx), action: 'member.create', objectType: 'member', objectId: id, after: { username, displayName, role: input.role, ...(googleEmail ? { googleEmail } : {}) } });
  return shape(findMember(db, ctx.organizationId, id), true, ctx.actor.role);
}

function activeOwners(db, organizationId) {
  return db.prepare("SELECT COUNT(*) AS n FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.role = 'owner' AND u.is_active = 1").get(organizationId).n;
}

function updateMember(db, ctx, id, patch = {}) {
  if (!perms.can(ctx.actor.role, 'members.manage')) throw new ServiceError(403, 'Not allowed');
  const target = findMember(db, ctx.organizationId, id);
  if (!perms.canManage(ctx.actor.role, target.role)) throw new ServiceError(403, 'Not allowed');
  const before = {};
  const after = {};

  if (patch.role !== undefined && patch.role !== target.role) {
    if (!perms.ROLES.includes(patch.role)) throw new ServiceError(400, 'Choose a role');
    // Leaving the Owner role while Google is required needs a way in with Google.
    if (target.role === 'owner' && patch.role !== 'owner' && db.prepare('SELECT require_google AS r FROM organizations WHERE id = ?').get(ctx.organizationId).r && !db.prepare('SELECT 1 FROM user_identities WHERE user_id = ?').get(target.id)) throw new ServiceError(400, 'Link or invite their Google account first, because your agency requires Google sign-in');
    if (!perms.assignableRoles(ctx.actor.role).includes(patch.role)) throw new ServiceError(403, 'Not allowed');
    if (target.role === 'owner' && activeOwners(db, ctx.organizationId) <= 1) throw new ServiceError(400, 'The agency must keep at least one Owner');
    before.role = target.role;
    after.role = patch.role;
  }
  if (patch.displayName !== undefined && patch.displayName !== target.displayName) {
    before.displayName = target.displayName;
    after.displayName = cleanText(patch.displayName, 'Name', 1, 60);
  }
  if (patch.isActive !== undefined && !!patch.isActive !== !!target.isActive) {
    if (!patch.isActive) {
      if (Number(id) === ctx.actor.id) throw new ServiceError(400, 'You cannot deactivate yourself');
      if (target.role === 'owner' && activeOwners(db, ctx.organizationId) <= 1) throw new ServiceError(400, 'The agency must keep at least one Owner');
    }
    before.isActive = !!target.isActive;
    after.isActive = !!patch.isActive;
  }
  if (Object.keys(after).length === 0) return shape(target, true, ctx.actor.role);

  db.transaction(() => {
    if (after.role) db.prepare('UPDATE organization_members SET role = ? WHERE user_id = ? AND organization_id = ?').run(after.role, target.id, ctx.organizationId);
    if (after.displayName) db.prepare("UPDATE users SET display_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(after.displayName, target.id);
    if (after.isActive !== undefined) {
      db.prepare("UPDATE users SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(after.isActive ? 1 : 0, target.id);
      if (!after.isActive) destroyUserSessions(db, target.id);
    }
    logActivity(db, { ...logCtx(ctx), action: 'member.update', objectType: 'member', objectId: target.id, before, after });
  })();
  return shape(findMember(db, ctx.organizationId, id), true, ctx.actor.role);
}

async function resetPassword(db, ctx, id, { password }) {
  if (!perms.can(ctx.actor.role, 'members.manage')) throw new ServiceError(403, 'Not allowed');
  const target = findMember(db, ctx.organizationId, id);
  if (!perms.canManage(ctx.actor.role, target.role)) throw new ServiceError(403, 'Not allowed');
  const problem = passwordProblem(password);
  if (problem) throw new ServiceError(400, problem);
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, password_login = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hash, target.id);
    destroyUserSessions(db, target.id);
    logActivity(db, { ...logCtx(ctx), action: 'member.reset_password', objectType: 'member', objectId: target.id });
  })();
  return { ok: true };
}

module.exports = { listMembers, createMember, updateMember, resetPassword, insertMember, findMember };
