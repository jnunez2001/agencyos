// Joshua Nunez
// Time tracking. People log their own time (by hand or with one timer), submit it, and a Manager or above approves,
// rejects or locks it. Only a person reviews: an AI key can log draft time but never submit, approve, reject or lock.
// Contractors log time only on tasks assigned to them. Everyone sees their own entries; Managers see the team's.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanOptional, cleanEnum, cleanDate, diff } = require('./validate');
const clients = require('./clients');
const projects = require('./projects');
const tasks = require('./tasks');
const { today } = require('./dates');
const perms = require('./permissions');

const TYPES = ['billable', 'non_billable', 'internal', 'meeting', 'training', 'admin'];
const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'locked'];
const FIELDS = ['date', 'minutes', 'startedAt', 'endedAt', 'clientId', 'projectId', 'taskId', 'description', 'timeType'];
const DAY_MINUTES = 1440;

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const sees = (ctx) => perms.can(ctx.actor.role, 'clients.view');
const seesTeam = (ctx) => perms.can(ctx.actor.role, 'time.view_team');
const nowOf = (ctx) => (ctx.now ? new Date(ctx.now) : new Date());
const stamp = (d) => d.toISOString().slice(0, 19) + 'Z';
const noAi = (ctx, what) => { if (ctx.source === 'ai') throw new ServiceError(403, `AI cannot ${what}. A person does that`); };

const SELECT = `
  SELECT e.id, e.user_id AS userId, u.display_name AS userName, e.entry_date AS date, e.minutes, e.started_at AS startedAt, e.ended_at AS endedAt,
         e.client_id AS clientId, c.name AS clientName, e.project_id AS projectId, p.name AS projectName, e.task_id AS taskId, t.title AS taskTitle,
         e.description, e.time_type AS timeType, e.status, e.reviewer_id AS reviewerId, rv.display_name AS reviewerName, e.reviewed_at AS reviewedAt,
         e.review_note AS reviewNote, e.locked_at AS lockedAt, e.timer_state AS timerState, e.timer_started_at AS timerStartedAt, e.elapsed_seconds AS baseSeconds,
         e.created_at AS createdAt, e.updated_at AS updatedAt
    FROM time_entries e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN clients c ON c.id = e.client_id AND c.organization_id = e.organization_id
    LEFT JOIN projects p ON p.id = e.project_id AND p.organization_id = e.organization_id
    LEFT JOIN tasks t ON t.id = e.task_id AND t.organization_id = e.organization_id
    LEFT JOIN users rv ON rv.id = e.reviewer_id
   WHERE e.organization_id = ?`;

const scope = (ctx) => (seesTeam(ctx) ? '' : ' AND e.user_id = ?');
const scopeParams = (ctx) => (seesTeam(ctx) ? [] : [ctx.actor.id]);

const editable = (row) => ['draft', 'rejected'].includes(row.status);

function shape(ctx, row) {
  const { clientName, projectName, baseSeconds, timerStartedAt, ...rest } = row;
  const own = row.userId === ctx.actor.id;
  let elapsedSeconds = baseSeconds;
  if (row.timerState === 'running' && timerStartedAt) elapsedSeconds += Math.max(0, Math.floor((nowOf(ctx).getTime() - Date.parse(timerStartedAt)) / 1000));
  const reviews = perms.can(ctx.actor.role, 'time.review') && ctx.source !== 'ai';
  return {
    ...rest,
    hours: Math.round((row.minutes / 60) * 100) / 100,
    // Link names are only for people who may see clients; the rest see the entry with the task alone.
    clientName: sees(ctx) ? clientName : null, projectName: sees(ctx) ? projectName : null,
    timerStartedAt: row.timerState === 'running' ? timerStartedAt : null,
    elapsedSeconds: row.timerState === 'none' ? 0 : elapsedSeconds,
    canEdit: own && editable(row) && row.timerState === 'none',
    canDelete: own && editable(row),
    canSubmit: own && editable(row) && row.timerState === 'none' && row.minutes > 0,
    canReview: reviews && row.status === 'submitted' && (!own || ctx.actor.role === 'owner'),
    canLock: reviews && row.status === 'approved',
  };
}

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND e.id = ?${scope(ctx)}`).get(ctx.organizationId, Number(id), ...scopeParams(ctx));
  if (!row) throw new ServiceError(404, 'Time entry not found');
  return row;
}

function getEntry(db, ctx, id) {
  need(ctx, 'time.log');
  return shape(ctx, find(db, ctx, id));
}

// ---- input checks ----

function cleanMinutes(value) {
  const n = Number(value);
  if (value === '' || value === null || !Number.isInteger(n) || n < 1 || n > DAY_MINUTES) throw new ServiceError(400, 'Time must be a whole number of minutes from 1 to 1440');
  return n;
}

function cleanMoment(value, label) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(String(value || ''));
  const d = m && new Date(String(value));
  if (!d || Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) || d.getUTCHours() !== Number(m[4])) throw new ServiceError(400, `${label} must be a date and time in UTC, like 2026-10-12T14:00:00Z`);
  return stamp(d);
}

// A task sets its project and client; a project sets its client; the ones given must agree.
function resolveLinks(db, ctx, { clientId, projectId, taskId }) {
  let task = null; let project = null; let client = null;
  if (taskId != null && taskId !== '') task = tasks.find(db, ctx, taskId);
  if (projectId != null && projectId !== '') project = projects.find(db, ctx.organizationId, projectId);
  if (clientId != null && clientId !== '') client = clients.find(db, ctx.organizationId, clientId);
  if (task) {
    if (project && project.id !== task.projectId) throw new ServiceError(400, 'That task is not in that project');
    project = project || projects.find(db, ctx.organizationId, task.projectId);
  }
  if (project) {
    if (client && client.id !== project.clientId) throw new ServiceError(400, 'That project belongs to another client');
    client = client || clients.find(db, ctx.organizationId, project.clientId);
  }
  return { clientId: client ? client.id : null, projectId: project ? project.id : null, taskId: task ? task.id : null };
}

function dayTotal(db, ctx, date, exceptId) {
  return db.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM time_entries WHERE organization_id = ? AND user_id = ? AND entry_date = ? AND id != ?').get(ctx.organizationId, ctx.actor.id, date, exceptId || 0).n;
}

// Builds the entry to save from the input on top of `base` (the current entry, or nothing for a new one).
// `timer` entries have no minutes yet.
function build(db, ctx, input, base, { timer = false } = {}) {
  if (input.status !== undefined) throw new ServiceError(400, 'Status changes with Submit, Approve, Reject and Lock, not by editing');
  const next = { ...base };
  const hasRange = input.startedAt !== undefined || input.endedAt !== undefined;
  if (hasRange) {
    next.startedAt = cleanMoment(input.startedAt, 'Start'); next.endedAt = cleanMoment(input.endedAt, 'End');
    const minutes = Math.round((Date.parse(next.endedAt) - Date.parse(next.startedAt)) / 60000);
    if (minutes < 1) throw new ServiceError(400, 'The end must be after the start');
    next.minutes = cleanMinutes(minutes);
  } else if (input.minutes !== undefined) {
    next.minutes = cleanMinutes(input.minutes);
    next.startedAt = null; next.endedAt = null;
  } else if (!timer && base.minutes === undefined) throw new ServiceError(400, 'Give the minutes, or a start and an end time');
  if (input.date !== undefined) { next.date = cleanDate(input.date, 'Date'); if (!next.date) throw new ServiceError(400, 'Date is required'); } else if (hasRange) next.date = next.startedAt.slice(0, 10);
  else if (next.date === undefined) next.date = today(db, ctx);
  if (['clientId', 'projectId', 'taskId'].some((k) => input[k] !== undefined)) {
    // Changing a link clears the links below it that no longer agree, unless they were sent too.
    const given = { clientId: input.clientId, projectId: input.projectId, taskId: input.taskId };
    if (input.clientId !== undefined && input.projectId === undefined && input.clientId !== base.clientId) given.projectId = null;
    if ((input.projectId !== undefined || given.projectId === null) && input.taskId === undefined && given.projectId !== base.projectId) given.taskId = null;
    Object.assign(next, resolveLinks(db, ctx, { clientId: given.clientId === undefined ? base.clientId : given.clientId, projectId: given.projectId === undefined ? base.projectId : given.projectId, taskId: given.taskId === undefined ? base.taskId : given.taskId }));
  } else if (next.clientId === undefined) Object.assign(next, { clientId: null, projectId: null, taskId: null });
  // A Contractor logs time only on a task assigned to them (the task lookup already hides anyone else's).
  if (!sees(ctx) && !next.taskId) throw new ServiceError(400, 'Choose one of your tasks to log time against');
  next.description = input.description !== undefined ? cleanOptional(input.description, 'Description', 1000) : (next.description || '');
  next.timeType = input.timeType !== undefined ? cleanEnum(input.timeType, TYPES, 'time type') : (next.timeType || (next.clientId ? 'billable' : 'internal'));
  if (next.timeType === 'billable' && !next.clientId) throw new ServiceError(400, 'Billable time needs a client. Choose a task, project or client');
  return next;
}

function checkDay(db, ctx, next, exceptId) {
  if (dayTotal(db, ctx, next.date, exceptId) + next.minutes > DAY_MINUTES) throw new ServiceError(400, 'That would put more than 24 hours on one day');
}

const insert = (db, ctx, next, extra = {}) => Number(db.prepare(
  `INSERT INTO time_entries (organization_id, user_id, entry_date, minutes, started_at, ended_at, client_id, project_id, task_id, description, time_type, timer_state, timer_started_at, elapsed_seconds)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(ctx.organizationId, ctx.actor.id, next.date, next.minutes || 0, next.startedAt || null, next.endedAt || null, next.clientId, next.projectId, next.taskId, next.description, next.timeType, extra.timerState || 'none', extra.timerStartedAt || null, 0).lastInsertRowid);

function createEntry(db, ctx, input = {}) {
  need(ctx, 'time.log');
  return db.transaction(() => {
    const next = build(db, ctx, input, {});
    checkDay(db, ctx, next, 0);
    const id = insert(db, ctx, next);
    logActivity(db, { ...logCtx(ctx), action: 'time.create', objectType: 'time_entry', objectId: id, after: { date: next.date, minutes: next.minutes, timeType: next.timeType, clientId: next.clientId, taskId: next.taskId } });
    return getEntry(db, ctx, id);
  })();
}

// The person's own entry that they may still change: a draft or a rejected one, with no timer going.
function ownEditable(db, ctx, id, { forDelete = false } = {}) {
  const row = find(db, ctx, id);
  if (row.userId !== ctx.actor.id) throw new ServiceError(403, 'You can only change your own time');
  if (row.status === 'submitted') throw new ServiceError(403, 'Submitted time cannot be changed until a manager reviews it');
  if (row.status === 'approved' || row.status === 'locked') throw new ServiceError(403, `${row.status === 'locked' ? 'Locked' : 'Approved'} time cannot be changed`);
  if (!forDelete && row.timerState !== 'none') throw new ServiceError(409, 'Stop the timer before changing this entry');
  return row;
}

function updateEntry(db, ctx, id, patch = {}) {
  need(ctx, 'time.log');
  return db.transaction(() => {
    const current = ownEditable(db, ctx, id);
    const next = build(db, ctx, patch, current);
    checkDay(db, ctx, next, current.id);
    const d = diff(current, next, FIELDS);
    if (!d.changed) return shape(ctx, current);
    db.prepare("UPDATE time_entries SET entry_date = ?, minutes = ?, started_at = ?, ended_at = ?, client_id = ?, project_id = ?, task_id = ?, description = ?, time_type = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(next.date, next.minutes, next.startedAt || null, next.endedAt || null, next.clientId, next.projectId, next.taskId, next.description, next.timeType, ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'time.update', objectType: 'time_entry', objectId: current.id, before: d.before, after: d.after });
    return getEntry(db, ctx, id);
  })();
}

function deleteEntry(db, ctx, id) {
  need(ctx, 'time.log');
  return db.transaction(() => {
    const current = ownEditable(db, ctx, id, { forDelete: true });
    db.prepare('DELETE FROM time_entries WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'time.delete', objectType: 'time_entry', objectId: current.id, before: { date: current.date, minutes: current.minutes, status: current.status } });
    return { deleted: true };
  })();
}

function listEntries(db, ctx, { from, to, userId, status, clientId, projectId, taskId, timeType, mine } = {}) {
  need(ctx, 'time.log');
  const where = []; const params = [ctx.organizationId];
  const start = cleanDate(from, 'From'); const end = cleanDate(to, 'To');
  if (start) { where.push('e.entry_date >= ?'); params.push(start); }
  if (end) { where.push('e.entry_date <= ?'); params.push(end); }
  if (mine) { where.push('e.user_id = ?'); params.push(ctx.actor.id); } else if (userId) { where.push('e.user_id = ?'); params.push(Number(userId)); }
  if (status) { where.push('e.status = ?'); params.push(cleanEnum(status, STATUSES, 'status')); }
  if (timeType) { where.push('e.time_type = ?'); params.push(cleanEnum(timeType, TYPES, 'time type')); }
  if (clientId) { where.push('e.client_id = ?'); params.push(Number(clientId)); }
  if (projectId) { where.push('e.project_id = ?'); params.push(Number(projectId)); }
  if (taskId) { where.push('e.task_id = ?'); params.push(Number(taskId)); }
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')}${scope(ctx)} ORDER BY e.entry_date, e.id LIMIT 1000`).all(...params, ...scopeParams(ctx)).map((r) => shape(ctx, r));
}

// ---- the timer ----

const timerRow = (db, ctx) => db.prepare(`${SELECT} AND e.user_id = ? AND e.timer_state != 'none'`).get(ctx.organizationId, ctx.actor.id);

function getTimer(db, ctx) {
  need(ctx, 'time.log');
  const row = timerRow(db, ctx);
  return row ? shape(ctx, row) : null;
}

function startTimer(db, ctx, input = {}) {
  need(ctx, 'time.log');
  noAi(ctx, 'run a timer');
  return db.transaction(() => {
    if (timerRow(db, ctx)) throw new ServiceError(409, 'You already have a timer. Stop it or resume it first');
    const next = build(db, ctx, { ...input, date: undefined, minutes: undefined, startedAt: undefined, endedAt: undefined }, {}, { timer: true });
    const id = insert(db, ctx, next, { timerState: 'running', timerStartedAt: stamp(nowOf(ctx)) });
    logActivity(db, { ...logCtx(ctx), action: 'time.timer.start', objectType: 'time_entry', objectId: id, after: { timeType: next.timeType, clientId: next.clientId, taskId: next.taskId } });
    return getEntry(db, ctx, id);
  })();
}

function moveTimer(db, ctx, action, from, to, message) {
  need(ctx, 'time.log');
  noAi(ctx, 'run a timer');
  return db.transaction(() => {
    const row = timerRow(db, ctx);
    if (!row) throw new ServiceError(409, 'You have no timer going');
    if (!from.includes(row.timerState)) throw new ServiceError(409, message);
    const now = nowOf(ctx);
    let seconds = row.baseSeconds;
    if (row.timerState === 'running') seconds += Math.max(0, Math.floor((now.getTime() - Date.parse(row.timerStartedAt)) / 1000));
    if (to === 'none') {
      let minutes = Math.min(DAY_MINUTES, Math.max(1, Math.round(seconds / 60)));
      const room = DAY_MINUTES - dayTotal(db, ctx, row.date, row.id);
      if (room < 1) throw new ServiceError(400, 'That day already has 24 hours logged');
      minutes = Math.min(minutes, room);
      db.prepare("UPDATE time_entries SET minutes = ?, elapsed_seconds = ?, timer_state = 'none', timer_started_at = NULL, ended_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(minutes, seconds, stamp(now), ctx.organizationId, row.id);
      logActivity(db, { ...logCtx(ctx), action: `time.timer.${action}`, objectType: 'time_entry', objectId: row.id, before: { timerState: row.timerState }, after: { timerState: 'none', minutes } });
    } else {
      db.prepare("UPDATE time_entries SET timer_state = ?, timer_started_at = ?, elapsed_seconds = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(to, to === 'running' ? stamp(now) : null, seconds, ctx.organizationId, row.id);
      logActivity(db, { ...logCtx(ctx), action: `time.timer.${action}`, objectType: 'time_entry', objectId: row.id, before: { timerState: row.timerState }, after: { timerState: to } });
    }
    return getEntry(db, ctx, row.id);
  })();
}

const pauseTimer = (db, ctx) => moveTimer(db, ctx, 'pause', ['running'], 'paused', 'Your timer is already paused');
const resumeTimer = (db, ctx) => moveTimer(db, ctx, 'resume', ['paused'], 'running', 'Your timer is already running');
const stopTimer = (db, ctx) => moveTimer(db, ctx, 'stop', ['running', 'paused'], 'none', 'Your timer is not going');

// ---- submit, approve, reject, lock ----

// Sends the person's own draft or rejected entries for approval: the ids given, or every one dated from to to ("submit week").
function submitEntries(db, ctx, { ids, from, to } = {}) {
  need(ctx, 'time.log');
  noAi(ctx, 'submit time');
  return db.transaction(() => {
    let rows;
    if (Array.isArray(ids) && ids.length) {
      rows = ids.map((id) => {
        const row = find(db, ctx, id);
        if (row.userId !== ctx.actor.id) throw new ServiceError(403, 'You can only submit your own time');
        if (!editable(row) || row.timerState !== 'none' || row.minutes < 1) throw new ServiceError(400, `The entry on ${row.date} cannot be submitted. Only finished draft or rejected time can be sent`);
        return row;
      });
    } else {
      const start = cleanDate(from, 'From'); const end = cleanDate(to, 'To');
      if (!start || !end) throw new ServiceError(400, 'Choose entries or a week to submit');
      rows = db.prepare(`${SELECT} AND e.user_id = ? AND e.entry_date BETWEEN ? AND ? AND e.status IN ('draft','rejected') AND e.timer_state = 'none' AND e.minutes > 0 ORDER BY e.entry_date, e.id`).all(ctx.organizationId, ctx.actor.id, start, end);
    }
    if (rows.length === 0) throw new ServiceError(400, 'There is nothing to submit');
    for (const row of rows) {
      db.prepare("UPDATE time_entries SET status = 'submitted', reviewer_id = NULL, reviewed_at = NULL, review_note = '', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(ctx.organizationId, row.id);
      logActivity(db, { ...logCtx(ctx), action: 'time.submit', objectType: 'time_entry', objectId: row.id, before: { status: row.status }, after: { status: 'submitted' } });
    }
    return { submitted: rows.length, ids: rows.map((r) => r.id) };
  })();
}

// Approving, rejecting and locking are a manager's decision, made by a person.
function reviewable(db, ctx, id, status, verb) {
  need(ctx, 'time.review');
  noAi(ctx, 'approve, reject or lock time');
  const row = find(db, ctx, id);
  if (row.status !== status) throw new ServiceError(409, `Only ${status} time can be ${verb}`);
  return row;
}

function decide(db, ctx, id, status, note) {
  return db.transaction(() => {
    const row = reviewable(db, ctx, id, 'submitted', status === 'approved' ? 'approved' : 'rejected');
    if (row.userId === ctx.actor.id && ctx.actor.role !== 'owner') throw new ServiceError(403, 'You cannot review your own time. Ask another manager');
    const text = cleanOptional(note, 'Note', 1000);
    if (status === 'rejected' && !text) throw new ServiceError(400, 'Say why it is rejected so the person can fix it');
    db.prepare("UPDATE time_entries SET status = ?, reviewer_id = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), review_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(status, ctx.actor.id, text, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: status === 'approved' ? 'time.approve' : 'time.reject', objectType: 'time_entry', objectId: row.id, before: { status: 'submitted' }, after: { status, ...(text ? { reviewNote: text } : {}) } });
    return getEntry(db, ctx, row.id);
  })();
}

const approveEntry = (db, ctx, id, input = {}) => decide(db, ctx, id, 'approved', input.note);
const rejectEntry = (db, ctx, id, input = {}) => decide(db, ctx, id, 'rejected', input.note);

function lockEntry(db, ctx, id) {
  return db.transaction(() => {
    const row = reviewable(db, ctx, id, 'approved', 'locked');
    db.prepare("UPDATE time_entries SET status = 'locked', locked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?").run(ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'time.lock', objectType: 'time_entry', objectId: row.id, before: { status: 'approved' }, after: { status: 'locked' } });
    return getEntry(db, ctx, row.id);
  })();
}

module.exports = { TYPES, STATUSES, getEntry, listEntries, createEntry, updateEntry, deleteEntry, getTimer, startTimer, pauseTimer, resumeTimer, stopTimer, submitEntries, approveEntry, rejectEntry, lockEntry };
