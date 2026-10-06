// Joshua Nunez
// What the dashboard needs. The team summary is only for roles that manage people.
const perms = require('./permissions');

function getDashboard(db, ctx) {
  const org = db.prepare('SELECT id, name, timezone FROM organizations WHERE id = ?').get(ctx.organizationId);
  const me = db.prepare('SELECT display_name AS displayName FROM users WHERE id = ?').get(ctx.actor.id);
  let team = null;
  if (perms.can(ctx.actor.role, 'dashboard.team')) {
    const rows = db.prepare(
      `SELECT m.role, u.is_active AS isActive, u.must_change_password AS must
         FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?`
    ).all(ctx.organizationId);
    const active = rows.filter((r) => r.isActive);
    const byRole = Object.fromEntries(perms.ROLES.map((r) => [r, active.filter((x) => x.role === r).length]));
    team = { total: rows.length, active: active.length, byRole, mustChangePassword: active.filter((r) => r.must).length };
  }
  return { organization: org, me: { id: ctx.actor.id, displayName: me.displayName, role: ctx.actor.role }, team };
}

module.exports = { getDashboard };
