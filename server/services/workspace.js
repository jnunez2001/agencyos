// Joshua Nunez
// The home of each role: My Day for everyone, a Manager view and an Owner overview on top of it. Each part is only
// worked out for the roles that may see it. "Today" is the agency's day.
const { today, addDays } = require('./dates');
const events = require('./events');
const perms = require('./permissions');
const notifications = require('./notifications');
const capacity = require('./capacity');
const { ServiceError } = require('./errors');

function getWorkspace(db, ctx) {
  if (!perms.can(ctx.actor.role, 'notifications.view')) throw new ServiceError(403, 'Not allowed');
  const org = ctx.organizationId;
  const me = ctx.actor.id;
  const day = today(db, ctx);
  const sees = perms.can(ctx.actor.role, 'clients.view');
  const one = (sql, ...params) => db.prepare(sql).get(org, ...params).n;
  const out = { today: day, role: ctx.actor.role };

  // ---- My Day ----
  const cal = events.calendar(db, ctx, { from: day, to: day, userId: me });
  const tasks = db.prepare(`SELECT t.id, t.title, t.status, t.due_date AS dueDate, t.project_id AS projectId, p.name AS projectName FROM tasks t JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
      WHERE t.organization_id = ? AND t.assignee_id = ? AND t.status != 'done' AND t.due_date <= ? ORDER BY t.due_date, t.id LIMIT 20`).all(org, me, day).map((t) => ({ ...t, projectName: sees ? t.projectName : null, isOverdue: t.dueDate < day }));
  const followUps = db.prepare("SELECT id, title, due_date AS dueDate FROM follow_ups WHERE organization_id = ? AND assignee_id = ? AND status = 'open' AND due_date <= ? ORDER BY due_date, id LIMIT 20").all(org, me, day).map((f) => ({ ...f, isOverdue: f.dueDate < day }));
  out.myDay = {
    events: cal.events.map((e) => ({ id: e.id, title: e.title, type: e.type, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay })),
    tasks, followUps,
    requests: perms.can(ctx.actor.role, 'requests.view')
      ? db.prepare("SELECT r.id, r.title, r.status, c.name AS clientName FROM client_requests r JOIN clients c ON c.id = r.client_id AND c.organization_id = r.organization_id WHERE r.organization_id = ? AND r.owner_id = ? AND r.status NOT IN ('completed','rejected') ORDER BY r.id DESC LIMIT 10").all(org, me)
      : [],
    unreadNotifications: notifications.unreadCount(db, ctx).unread,
    qaWaiting: perms.can(ctx.actor.role, 'qa.review') ? one("SELECT COUNT(*) AS n FROM qa_reviews WHERE organization_id = ? AND status = 'pending'") : null,
  };

  // ---- Manager view ----
  if (perms.can(ctx.actor.role, 'dashboard.team')) {
    out.manager = {
      requestsToReview: one("SELECT COUNT(*) AS n FROM client_requests WHERE organization_id = ? AND status IN ('new','reviewing')"),
      overdueFollowUps: one("SELECT COUNT(*) AS n FROM follow_ups WHERE organization_id = ? AND status = 'open' AND due_date < ?", day),
      unassignedTasks: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND assignee_id IS NULL AND status != 'done'"),
      meetingsWithoutNotes: db.prepare(`SELECT e.id, e.title, substr(e.starts_at, 1, 10) AS date FROM events e WHERE e.organization_id = ? AND e.status != 'cancelled' AND e.meeting_note_id IS NULL
          AND e.type IN ('client_meeting','internal_meeting','team_meeting') AND substr(e.starts_at, 1, 10) < ? AND substr(e.starts_at, 1, 10) >= ? ORDER BY e.starts_at DESC LIMIT 10`).all(org, day, addDays(day, -14)),
    };
  }

  // ---- Owner overview ----
  if (perms.can(ctx.actor.role, 'org.update')) {
    out.owner = {
      clientsAtRisk: db.prepare("SELECT id, name FROM clients WHERE organization_id = ? AND status = 'at_risk' ORDER BY name COLLATE NOCASE LIMIT 10").all(org),
      overdueTasks: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND status != 'done' AND due_date < ?", day),
      openRequests: one("SELECT COUNT(*) AS n FROM client_requests WHERE organization_id = ? AND status NOT IN ('completed','rejected')"),
      upcomingClientMeetings: db.prepare(`SELECT e.id, e.title, e.starts_at AS startsAt, c.name AS clientName FROM events e LEFT JOIN clients c ON c.id = e.client_id AND c.organization_id = e.organization_id
          WHERE e.organization_id = ? AND e.type = 'client_meeting' AND e.status = 'scheduled' AND substr(e.starts_at, 1, 10) >= ? AND substr(e.starts_at, 1, 10) <= ? ORDER BY e.starts_at LIMIT 10`).all(org, day, addDays(day, 7)),
      aiPending: perms.can(ctx.actor.role, 'ai.approve') ? one("SELECT COUNT(*) AS n FROM ai_proposals WHERE organization_id = ? AND status = 'pending'") : null,
      // What is waiting for a person to decide.
      approvals: {
        timeToApprove: one("SELECT COUNT(*) AS n FROM time_entries WHERE organization_id = ? AND status = 'submitted'"),
        qaWaiting: one("SELECT COUNT(*) AS n FROM qa_reviews WHERE organization_id = ? AND status = 'pending'"),
        sopChangesToReview: one("SELECT COUNT(*) AS n FROM sop_change_requests WHERE organization_id = ? AND status IN ('identified','needs_review')"),
      },
      // What is happening.
      happening: {
        activeClients: one("SELECT COUNT(*) AS n FROM clients WHERE organization_id = ? AND status IN ('active','onboarding','at_risk')"),
        activeProjects: one("SELECT COUNT(*) AS n FROM projects WHERE organization_id = ? AND status = 'active'"),
        workInProgress: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND status IN ('in_progress','review','changes')"),
        recentResults: db.prepare(`SELECT r.id, r.client_id AS clientId, r.metric, r.value, r.unit, r.recorded_on AS recordedOn, c.name AS clientName FROM client_results r JOIN clients c ON c.id = r.client_id AND c.organization_id = r.organization_id
            WHERE r.organization_id = ? ORDER BY r.recorded_on DESC, r.id DESC LIMIT 5`).all(org),
      },
      // What needs improving.
      improve: {
        tasksNeedingChanges: one("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND status = 'changes'"),
        overCapacity: perms.can(ctx.actor.role, 'time.view_team')
          ? capacity.workloadCapacity(db, ctx).weeks[0].people.filter((p) => p.status === 'over').map((p) => ({ id: p.userId, displayName: p.displayName, utilizationPercent: p.utilizationPercent }))
          : [],
      },
    };
  }
  return out;
}

module.exports = { getWorkspace };
