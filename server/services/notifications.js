// Joshua Nunez
// Notifications: what a person must act on, never about their own action. A repeat about the same thing is folded into
// the unread one instead of adding another, and the daily digest goes out once a day. Everything is scoped to one
// person of one agency.
const { ServiceError } = require('./errors');
const { todayIn } = require('./dates');
const perms = require('./permissions');

const KEEP_DAYS = 90;
const need = (ctx) => { if (!perms.can(ctx.actor.role, 'notifications.view')) throw new ServiceError(403, 'Not allowed'); };

// Called by other services inside their own transaction. `userIds` may hold nulls and the actor; both are skipped.
// dedupeKey: skip when an unread notification with that key exists. once: skip when one exists at all (read or not).
function notify(db, ctx, { userIds, type, title, body = '', link = null, objectType = null, objectId = null, dedupeKey = null, once = false }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== ctx.actor.id))];
  let made = 0;
  for (const userId of ids) {
    const member = db.prepare('SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.id = ? AND u.is_active = 1').get(ctx.organizationId, userId);
    if (!member) continue;
    if (dedupeKey) {
      const seen = db.prepare(`SELECT 1 FROM notifications WHERE organization_id = ? AND user_id = ? AND dedupe_key = ?${once ? '' : ' AND read_at IS NULL'}`).get(ctx.organizationId, userId, dedupeKey);
      if (seen) continue;
    }
    db.prepare('INSERT INTO notifications (organization_id, user_id, type, title, body, link, object_type, object_id, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, userId, type, String(title).slice(0, 200), String(body).slice(0, 1000), link, objectType, objectId, dedupeKey);
    made += 1;
  }
  return made;
}

// The active people of an agency whose role may do `action` (for example everyone who may review QA).
function peopleWith(db, organizationId, action) {
  return db.prepare('SELECT u.id, m.role FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.is_active = 1').all(organizationId)
    .filter((r) => perms.can(r.role, action)).map((r) => r.id);
}

const SELECT = 'SELECT id, type, title, body, link, object_type AS objectType, object_id AS objectId, read_at AS readAt, created_at AS createdAt FROM notifications WHERE organization_id = ? AND user_id = ?';

function listNotifications(db, ctx, { unread, limit = 50 } = {}) {
  need(ctx);
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  return db.prepare(`${SELECT}${unread ? ' AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`).all(ctx.organizationId, ctx.actor.id, cap).map((r) => ({ ...r, isRead: !!r.readAt }));
}

function unreadCount(db, ctx) {
  need(ctx);
  return { unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE organization_id = ? AND user_id = ? AND read_at IS NULL').get(ctx.organizationId, ctx.actor.id).n };
}

function markRead(db, ctx, id) {
  need(ctx);
  const row = db.prepare('SELECT id FROM notifications WHERE organization_id = ? AND user_id = ? AND id = ?').get(ctx.organizationId, ctx.actor.id, Number(id));
  if (!row) throw new ServiceError(404, 'Notification not found');
  db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?").run(row.id);
  return { id: row.id, isRead: true };
}

function markAllRead(db, ctx) {
  need(ctx);
  const r = db.prepare("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND user_id = ? AND read_at IS NULL").run(ctx.organizationId, ctx.actor.id);
  return { marked: r.changes };
}

// One digest per person per day, only when something is overdue or due today. Run from the server's timer.
function runDigests(db, now = new Date()) {
  let sent = 0;
  for (const org of db.prepare('SELECT id, timezone FROM organizations').all()) {
    const today = todayIn(org.timezone, now);
    const system = { organizationId: org.id, actor: { id: 0, role: 'owner' } };
    const people = db.prepare("SELECT u.id FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.is_active = 1").all(org.id);
    for (const { id } of people) {
      const count = (sql) => db.prepare(sql).get(org.id, id, today).n;
      const overdueTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND assignee_id = ? AND status != 'done' AND due_date < ?");
      const dueTasks = count("SELECT COUNT(*) AS n FROM tasks WHERE organization_id = ? AND assignee_id = ? AND status != 'done' AND due_date = ?");
      const overdueFollowUps = count("SELECT COUNT(*) AS n FROM follow_ups WHERE organization_id = ? AND assignee_id = ? AND status = 'open' AND due_date < ?");
      const dueFollowUps = count("SELECT COUNT(*) AS n FROM follow_ups WHERE organization_id = ? AND assignee_id = ? AND status = 'open' AND due_date = ?");
      const overdue = overdueTasks + overdueFollowUps;
      const due = dueTasks + dueFollowUps;
      if (!overdue && !due) continue;
      const parts = [overdue && `${overdue} overdue`, due && `${due} due today`].filter(Boolean).join(', ');
      const detail = [overdueTasks && `${overdueTasks} overdue ${overdueTasks === 1 ? 'task' : 'tasks'}`, dueTasks && `${dueTasks} ${dueTasks === 1 ? 'task' : 'tasks'} due today`, overdueFollowUps && `${overdueFollowUps} overdue ${overdueFollowUps === 1 ? 'follow-up' : 'follow-ups'}`, dueFollowUps && `${dueFollowUps} ${dueFollowUps === 1 ? 'follow-up' : 'follow-ups'} due today`].filter(Boolean).join(', ');
      sent += notify(db, system, { userIds: [id], type: 'digest', title: `Your day: ${parts}`, body: detail, link: '#/dashboard', dedupeKey: `digest:${today}`, once: true });
    }
  }
  return sent;
}

// Everyone who attends a scheduled event that starts within the next 60 minutes hears about it once. Run from the
// server's timer. All-day events have no start time and are left out.
function runReminders(db, now = new Date()) {
  const stamp = (d) => `${d.toISOString().slice(0, 19)}Z`;
  const from = stamp(now); const to = stamp(new Date(now.getTime() + 60 * 60000));
  let sent = 0;
  const rows = db.prepare("SELECT id, organization_id AS organizationId, title, starts_at AS startsAt FROM events WHERE status = 'scheduled' AND all_day = 0 AND starts_at >= ? AND starts_at <= ?").all(from, to);
  for (const e of rows) {
    const system = { organizationId: e.organizationId, actor: { id: 0, role: 'owner' } };
    const people = db.prepare('SELECT user_id AS id FROM event_attendees WHERE event_id = ?').all(e.id).map((r) => r.id);
    const minutes = Math.max(0, Math.round((Date.parse(e.startsAt) - now.getTime()) / 60000));
    sent += notify(db, system, { userIds: people, type: 'event_soon', title: `Starting soon: ${e.title}`, body: minutes <= 1 ? 'Starts now' : `Starts in ${minutes} minutes`, link: '#/calendar', objectType: 'event', objectId: e.id, dedupeKey: `event_soon:${e.id}`, once: true });
  }
  return sent;
}

function prune(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  return db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?').run(cutoff).changes;
}

module.exports = { notify, listNotifications, unreadCount, markRead, markAllRead, runDigests, runReminders, peopleWith, prune };
