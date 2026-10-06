// Joshua Nunez
// The agency itself: first-run setup, reading it, and changing its name and timezone.
const crypto = require('crypto');
const { passwordProblem } = require('./passwords');
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanUsername, cleanTimezone } = require('./validate');
const { insertMember } = require('./members');
const perms = require('./permissions');

const orgCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n;
const needsSetup = (db) => orgCount(db) === 0;

function sameCode(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Creates an agency and its Owner. Used by first-run setup and by tests that need a second agency.
async function createOrganization(db, input, { onlyIfEmpty = false } = {}) {
  const name = cleanText(input.organizationName, 'Agency name', 1, 80);
  const displayName = cleanText(input.displayName, 'Name', 1, 60);
  const username = cleanUsername(input.username);
  const problem = passwordProblem(input.password);
  if (problem) throw new ServiceError(400, problem);
  if (onlyIfEmpty && !needsSetup(db)) throw new ServiceError(409, 'Setup is already complete');
  const organizationId = Number(db.prepare('INSERT INTO organizations (name) VALUES (?)').run(name).lastInsertRowid);
  let userId;
  try {
    userId = await insertMember(db, { organizationId, username, displayName, role: 'owner', password: input.password, mustChange: false });
  } catch (err) {
    db.prepare('DELETE FROM organizations WHERE id = ?').run(organizationId);
    throw err;
  }
  logActivity(db, { organizationId, actorUserId: userId, action: 'organization.setup', objectType: 'organization', objectId: organizationId, after: { name }, ip: input.ip || null });
  return { organizationId, userId };
}

// First run only. When the server has a setup code, it is required.
async function setupOrganization(db, input, { setupToken = '' } = {}) {
  if (!needsSetup(db)) throw new ServiceError(409, 'Setup is already complete');
  if (setupToken && !sameCode(input.setupCode, setupToken)) throw new ServiceError(403, 'The setup code is wrong');
  return createOrganization(db, input, { onlyIfEmpty: true });
}

function getOrganization(db, ctx) {
  const row = db.prepare('SELECT id, name, timezone, require_google AS requireGoogle FROM organizations WHERE id = ?').get(ctx.organizationId);
  if (!row) throw new ServiceError(404, 'Agency not found');
  return { ...row, requireGoogle: !!row.requireGoogle };
}

function updateOrganization(db, ctx, patch = {}) {
  if (!perms.can(ctx.actor.role, 'org.update')) throw new ServiceError(403, 'Not allowed');
  const current = getOrganization(db, ctx);
  const next = {
    name: patch.name === undefined ? current.name : cleanText(patch.name, 'Agency name', 1, 80),
    timezone: patch.timezone === undefined ? current.timezone : cleanTimezone(patch.timezone),
  };
  if (next.name === current.name && next.timezone === current.timezone) return current;
  db.transaction(() => {
    db.prepare("UPDATE organizations SET name = ?, timezone = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(next.name, next.timezone, ctx.organizationId);
    logActivity(db, { organizationId: ctx.organizationId, actorUserId: ctx.actor.id, action: 'organization.update', objectType: 'organization', objectId: ctx.organizationId, before: { name: current.name, timezone: current.timezone }, after: next, source: ctx.source || 'web', ip: ctx.ip || null });
  })();
  return getOrganization(db, ctx);
}

module.exports = { needsSetup, createOrganization, setupOrganization, getOrganization, updateOrganization };
