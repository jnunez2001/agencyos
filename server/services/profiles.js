// Joshua Nunez
// Employee profiles: title, department, timezone, working days and hours, weekly capacity.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanTimezone } = require('./validate');
const perms = require('./permissions');
const { findMember } = require('./members');

const SELECT = `
  SELECT u.id AS userId, u.username, u.display_name AS displayName, m.role,
         p.job_title AS jobTitle, p.department, p.timezone, p.work_days AS workDays, p.work_start AS workStart, p.work_end AS workEnd,
         p.weekly_capacity_hours AS weeklyCapacityHours
    FROM employee_profiles p
    JOIN users u ON u.id = p.user_id
    JOIN organization_members m ON m.user_id = u.id AND m.organization_id = p.organization_id
   WHERE p.organization_id = ? AND p.user_id = ?`;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function shape(row) {
  return { ...row, workDays: row.workDays.split(',').map(Number) };
}

function fetch(db, organizationId, userId) {
  findMember(db, organizationId, userId); // a person from another agency is "not found"
  const row = db.prepare(SELECT).get(organizationId, Number(userId));
  if (!row) throw new ServiceError(404, 'Member not found');
  return shape(row);
}

function getProfile(db, ctx, userId) {
  if (Number(userId) !== ctx.actor.id && !perms.can(ctx.actor.role, 'members.list')) throw new ServiceError(403, 'Not allowed');
  return fetch(db, ctx.organizationId, userId);
}

function cleanDays(value) {
  const days = Array.isArray(value) ? [...new Set(value.map(Number))] : [];
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new ServiceError(400, 'Working days must be between 1 (Monday) and 7 (Sunday), at least one');
  return days.sort((a, b) => a - b);
}

function cleanTime(value, label) {
  if (typeof value !== 'string' || !TIME.test(value)) throw new ServiceError(400, `${label} must be a time like 09:00`);
  return value;
}

function updateProfile(db, ctx, userId, patch = {}) {
  const self = Number(userId) === ctx.actor.id;
  const current = fetch(db, ctx.organizationId, userId);
  if (self) {
    if (!perms.can(ctx.actor.role, 'profile.edit_self')) throw new ServiceError(403, 'Not allowed');
  } else if (!perms.can(ctx.actor.role, 'profile.edit_others') || !perms.canManage(ctx.actor.role, current.role)) {
    throw new ServiceError(403, 'Not allowed');
  }
  const next = {
    jobTitle: patch.jobTitle === undefined ? current.jobTitle : cleanText(patch.jobTitle, 'Job title', 0, 60),
    department: patch.department === undefined ? current.department : cleanText(patch.department, 'Department', 0, 60),
    timezone: patch.timezone === undefined ? current.timezone : cleanTimezone(patch.timezone),
    workDays: patch.workDays === undefined ? current.workDays : cleanDays(patch.workDays),
    workStart: patch.workStart === undefined ? current.workStart : cleanTime(patch.workStart, 'Start time'),
    workEnd: patch.workEnd === undefined ? current.workEnd : cleanTime(patch.workEnd, 'End time'),
    weeklyCapacityHours: patch.weeklyCapacityHours === undefined ? current.weeklyCapacityHours : patch.weeklyCapacityHours,
  };
  if (next.workEnd <= next.workStart) throw new ServiceError(400, 'Work end must be after work start');
  if (!Number.isInteger(next.weeklyCapacityHours) || next.weeklyCapacityHours < 0 || next.weeklyCapacityHours > 168) throw new ServiceError(400, 'Weekly capacity must be a whole number of hours from 0 to 168');
  // Only what changed goes in the log, so the activity page reads as changes and not as a dump.
  const before = {};
  const after = {};
  for (const key of Object.keys(next)) {
    if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) { before[key] = current[key]; after[key] = next[key]; }
  }
  if (Object.keys(after).length === 0) return current;
  db.transaction(() => {
    db.prepare("UPDATE employee_profiles SET job_title = ?, department = ?, timezone = ?, work_days = ?, work_start = ?, work_end = ?, weekly_capacity_hours = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND user_id = ?")
      .run(next.jobTitle, next.department, next.timezone, next.workDays.join(','), next.workStart, next.workEnd, next.weeklyCapacityHours, ctx.organizationId, Number(userId));
    logActivity(db, { organizationId: ctx.organizationId, actorUserId: ctx.actor.id, action: 'profile.update', objectType: 'member', objectId: Number(userId), before, after, source: ctx.source || 'web', ip: ctx.ip || null });
  })();
  return fetch(db, ctx.organizationId, userId);
}

module.exports = { getProfile, updateProfile };
