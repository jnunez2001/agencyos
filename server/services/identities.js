// Joshua Nunez
// Signing in with Google. A Google account is tied to one person for good, by Google's own account id. It is
// invite-only: an account that is not linked and not invited gets nothing, and nothing is created automatically.
// Everyone keeps at least one way to sign in: password sign-in can only be turned off while Google is linked, and
// Google can only be unlinked while password sign-in is on.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const store = require('./identityStore');
const perms = require('./permissions');
const members = require('./members');
const auth = require('./auth');

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });

const identityOf = (db, userId) => db.prepare('SELECT * FROM user_identities WHERE user_id = ?').get(userId) || null;
const passwordLoginOf = (db, userId) => !!db.prepare('SELECT password_login AS p FROM users WHERE id = ?').get(userId).p;

// What the person sees on their own profile.
function getMine(db, ctx) {
  const i = identityOf(db, ctx.actor.id);
  const linked = !!(i && i.subject);
  const passwordLogin = passwordLoginOf(db, ctx.actor.id);
  return {
    linked, email: linked ? i.email : null, pendingEmail: i && !linked ? i.email : null, passwordLogin,
    canUnlink: linked && passwordLogin, canTurnOffPassword: linked && passwordLogin,
  };
}

// A signed-in person adds their own Google account. `claims` are the checked claims from Google.
function completeLink(db, ctx, claims) {
  return db.transaction(() => {
    const mine = identityOf(db, ctx.actor.id);
    if (mine && mine.subject) {
      if (mine.subject !== claims.sub) throw new ServiceError(409, 'A different Google account is already linked. Unlink it first');
      db.prepare('UPDATE user_identities SET email = ? WHERE id = ?').run(claims.email, mine.id);
      return { email: claims.email };
    }
    const owner = db.prepare('SELECT user_id FROM user_identities WHERE subject = ?').get(claims.sub);
    if (owner && owner.user_id !== ctx.actor.id) throw new ServiceError(409, 'That Google account is already linked to someone else');
    if (store.emailTaken(db, claims.email, ctx.actor.id)) throw new ServiceError(409, 'That Google email is invited for another member');
    if (mine) db.prepare("UPDATE user_identities SET subject = ?, email = ?, linked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(claims.sub, claims.email, mine.id);
    else db.prepare("INSERT INTO user_identities (user_id, organization_id, provider, subject, email, linked_at) VALUES (?, ?, 'google', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(ctx.actor.id, ctx.organizationId, claims.sub, claims.email);
    logActivity(db, { ...logCtx(ctx), action: 'identity.link', objectType: 'member', objectId: ctx.actor.id, after: { email: claims.email } });
    return { email: claims.email };
  })();
}

// The login page's Google button, after Google confirmed who the person is.
// Result: { ok: true, session } or { ok: false, reason: 'no-account' | 'disabled' | 'locked' }.
function loginWithGoogle(db, claims, { ip, userAgent }) {
  const key = `google:${ip}`; // throttled per address, the same way as password sign-in
  if (auth.isLockedOut(db, key, ip)) return { ok: false, reason: 'locked' };
  const find = (where, value) => db.prepare(
    `SELECT i.id AS identityId, i.subject, i.email, u.id AS userId, u.is_active AS isActive, m.organization_id AS organizationId
       FROM user_identities i JOIN users u ON u.id = i.user_id JOIN organization_members m ON m.user_id = u.id WHERE ${where}`
  ).get(value);
  let row = find('i.subject = ?', claims.sub);
  let bound = false;
  if (!row) {
    // The first sign-in of someone invited: the invitation is matched by the verified email, then tied to the account id.
    const invited = find('i.subject IS NULL AND i.email = ?', claims.email);
    if (invited) {
      if (!invited.isActive) return { ok: false, reason: 'disabled' };
      row = invited;
      bound = true;
    }
  }
  if (!row) {
    auth.recordFailure(db, key, ip);
    logActivity(db, { action: 'login.failed', source: 'system', ip, after: { method: 'google', email: String(claims.email).slice(0, 80) } });
    return { ok: false, reason: 'no-account' };
  }
  if (!row.isActive) return { ok: false, reason: 'disabled' };
  return db.transaction(() => {
    if (bound) {
      db.prepare("UPDATE user_identities SET subject = ?, email = ?, linked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(claims.sub, claims.email, row.identityId);
      logActivity(db, { organizationId: row.organizationId, actorUserId: row.userId, action: 'identity.link', objectType: 'member', objectId: row.userId, ip, after: { email: claims.email, via: 'invitation' } });
    } else if (row.email !== claims.email) {
      db.prepare('UPDATE user_identities SET email = ? WHERE id = ?').run(claims.email, row.identityId);
    }
    db.prepare('DELETE FROM login_attempts WHERE key = ?').run(`u:${key.toLowerCase()}`);
    const session = auth.createSession(db, { userId: row.userId, organizationId: row.organizationId, ip, userAgent });
    logActivity(db, { organizationId: row.organizationId, actorUserId: row.userId, action: 'login.success', ip, after: { method: 'google' } });
    return { ok: true, session };
  })();
}

// An Owner or Admin invites a member by Google email, changes it, or clears it. Only people they may manage.
function setInvite(db, ctx, targetId, email) {
  if (!perms.can(ctx.actor.role, 'members.manage')) throw new ServiceError(403, 'Not allowed');
  const target = members.findMember(db, ctx.organizationId, targetId);
  if (!perms.canManage(ctx.actor.role, target.role)) throw new ServiceError(403, 'Not allowed');
  const clearing = email === null || email === undefined || email === '';
  const clean = clearing ? null : store.cleanGoogleEmail(email);
  return db.transaction(() => {
    const existing = identityOf(db, target.id);
    if (existing && existing.subject) throw new ServiceError(400, 'This person already linked a Google account. They unlink it themselves');
    if (clearing) {
      if (existing) db.prepare('DELETE FROM user_identities WHERE id = ?').run(existing.id);
    } else {
      store.upsertInvite(db, { organizationId: ctx.organizationId, userId: target.id, email: clean });
    }
    logActivity(db, { ...logCtx(ctx), action: 'identity.invite', objectType: 'member', objectId: target.id, after: { googleEmail: clean } });
    return { email: clean, pending: !!clean };
  })();
}

function unlink(db, ctx) {
  return db.transaction(() => {
    const i = identityOf(db, ctx.actor.id);
    if (!i || !i.subject) throw new ServiceError(400, 'A Google account is not linked yet');
    if (!passwordLoginOf(db, ctx.actor.id)) throw new ServiceError(400, 'Ask an Owner or Admin to reset your password first, so you keep a way to sign in');
    db.prepare('DELETE FROM user_identities WHERE id = ?').run(i.id);
    logActivity(db, { ...logCtx(ctx), action: 'identity.unlink', objectType: 'member', objectId: ctx.actor.id });
    return getMine(db, ctx);
  })();
}

// Turning password sign-in off (Google only). Turning it back on is a password reset by an Owner or Admin.
function setPasswordLogin(db, ctx, targetId, enabled) {
  const self = Number(targetId) === ctx.actor.id;
  const target = members.findMember(db, ctx.organizationId, targetId);
  if (!self && (!perms.can(ctx.actor.role, 'members.manage') || !perms.canManage(ctx.actor.role, target.role))) throw new ServiceError(403, 'Not allowed');
  if (enabled) throw new ServiceError(400, 'An Owner or Admin resets the password to turn password sign-in back on');
  const i = identityOf(db, target.id);
  if (!i || !i.subject) throw new ServiceError(400, 'Link a Google account first, so there is still a way to sign in');
  db.transaction(() => {
    db.prepare("UPDATE users SET password_login = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(target.id);
    if (!self) auth.destroyUserSessions(db, target.id);
    logActivity(db, { ...logCtx(ctx), action: 'member.password_login_off', objectType: 'member', objectId: target.id });
  })();
  return { passwordLogin: false };
}

module.exports = { getMine, completeLink, loginWithGoogle, setInvite, unlink, setPasswordLogin };
