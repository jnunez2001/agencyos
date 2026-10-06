// Joshua Nunez
// What the dashboard needs: my own work first, then agency totals, then team workload. Each part is only worked out
// for roles that may see it, and every query is scoped by the organization.
const perms = require('./permissions');
const tasks = require('./tasks');
const { today, addDays } = require('./dates');
const aiplans = require('./aiplans');

function getDashboard(db, ctx) {
  const org = db.prepare('SELECT id, name, timezone FROM organizations WHERE id = ?').get(ctx.organizationId);
  const me = db.prepare('SELECT display_name AS displayName FROM users WHERE id = ?').get(ctx.actor.id);
  const todayDate = today(db, ctx);
  const weekEnd = addDays(todayDate, 7);

  const mine = tasks.listTasks(db, ctx, { mine: '1' }).filter((t) => t.status !== 'done');
  const work = {
    open: mine.length,
    overdue: mine.filter((t) => t.isOverdue).length,
    dueSoon: mine.filter((t) => t.dueDate && !t.isOverdue && t.dueDate <= weekEnd).length,
    items: mine.slice(0, 8),
  };

  let agency = null;
  if (perms.can(ctx.actor.role, 'dashboard.agency')) {
    const one = (sql, ...params) => db.prepare(sql).get(ctx.organizationId, ...params).n;
    agency = {
      activeClients: one("SELECT COUNT(*) AS n FROM clients WHERE organization_id = ? AND status = 'active'"),
      activeProjects: one("SELECT COUNT(*) AS n FROM projects WHERE organization_id = ? AND status = 'active'"),
      openTasks: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND status != 'done'"),
      overdueTasks: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date < ?", todayDate),
    };
  }

  let team = null;
  let workload = null;
  if (perms.can(ctx.actor.role, 'dashboard.team')) {
    const rows = db.prepare(
      `SELECT m.role, u.is_active AS isActive, u.must_change_password AS must
         FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ?`
    ).all(ctx.organizationId);
    const active = rows.filter((r) => r.isActive);
    const byRole = Object.fromEntries(perms.ROLES.map((r) => [r, active.filter((x) => x.role === r).length]));
    team = { total: rows.length, active: active.length, byRole, mustChangePassword: active.filter((r) => r.must).length };
    workload = db.prepare(
      `SELECT u.id, u.display_name AS displayName, m.role, COALESCE(p.weekly_capacity_hours, 40) AS capacityHours,
              COUNT(t.id) AS openTasks,
              COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue,
              COALESCE(SUM(t.estimate_hours), 0) AS openHours
         FROM organization_members m
         JOIN users u ON u.id = m.user_id AND u.is_active = 1
         LEFT JOIN employee_profiles p ON p.user_id = u.id AND p.organization_id = m.organization_id
         LEFT JOIN tasks t ON t.assignee_id = u.id AND t.organization_id = m.organization_id AND t.status != 'done'
        WHERE m.organization_id = ?
        GROUP BY u.id ORDER BY m.id`
    ).all(todayDate, ctx.organizationId);
  }
  return { organization: org, me: { id: ctx.actor.id, displayName: me.displayName, role: ctx.actor.role }, today: todayDate, work, agency, team, workload, aiPending: aiplans.pendingCount(db, ctx) };
}

module.exports = { getDashboard };
