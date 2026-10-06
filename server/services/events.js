// Joshua Nunez
// The agency calendar. Timed events are stored in UTC, all-day events as dates (end inclusive). Task and project
// due dates are shown beside events as read-only "deadlines", never copied. A Contractor sees only events they
// attend or created. Managers run the calendar; anyone may block their own time.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, cleanTeamMember, diff } = require('./validate');
const clients = require('./clients');
const projects = require('./projects');
const tasks = require('./tasks');
const perms = require('./permissions');

const TYPES = ['client_meeting', 'internal_meeting', 'team_meeting', 'deadline', 'follow_up', 'review', 'sop_review', 'training', 'blocked_time'];
const STATUSES = ['scheduled', 'completed', 'cancelled'];
const FIELDS = ['title', 'type', 'startsAt', 'endsAt', 'allDay', 'location', 'notes', 'status', 'clientId', 'projectId', 'taskId'];
const MAX_DAYS = 31;

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const sees = (ctx) => perms.can(ctx.actor.role, 'clients.view');
const manages = (ctx) => perms.can(ctx.actor.role, 'events.manage');

const SELECT = `
  SELECT e.id, e.title, e.type, e.starts_at AS startsAt, e.ends_at AS endsAt, e.all_day AS allDay, e.location, e.notes, e.status,
         e.client_id AS clientId, c.name AS clientName, e.project_id AS projectId, p.name AS projectName,
         e.task_id AS taskId, t.title AS taskTitle, e.meeting_note_id AS meetingNoteId,
         e.created_by AS createdBy, e.created_at AS createdAt, e.updated_at AS updatedAt
    FROM events e
    LEFT JOIN clients c ON c.id = e.client_id AND c.organization_id = e.organization_id
    LEFT JOIN projects p ON p.id = e.project_id AND p.organization_id = e.organization_id
    LEFT JOIN tasks t ON t.id = e.task_id AND t.organization_id = e.organization_id
   WHERE e.organization_id = ?`;

const visibility = (ctx) => (sees(ctx) ? '' : ' AND (e.created_by = ? OR EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = ?))');
const visibilityParams = (ctx) => (sees(ctx) ? [] : [ctx.actor.id, ctx.actor.id]);

function attendeesOf(db, ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT a.event_id AS eventId, u.id, u.display_name AS displayName FROM event_attendees a JOIN users u ON u.id = a.user_id WHERE a.event_id IN (${ids.map(() => '?').join(',')}) ORDER BY u.display_name COLLATE NOCASE`).all(...ids);
  const map = new Map();
  for (const r of rows) { if (!map.has(r.eventId)) map.set(r.eventId, []); map.get(r.eventId).push({ id: r.id, displayName: r.displayName }); }
  return map;
}

function shape(ctx, row, attendees) {
  const { clientName, projectName, taskTitle, ...rest } = row;
  const own = row.createdBy === ctx.actor.id;
  const canEdit = manages(ctx) || (own && row.type === 'blocked_time' && perms.can(ctx.actor.role, 'events.own'));
  return {
    ...rest,
    allDay: !!row.allDay,
    // Link names are only for people who may see clients; the rest see the event without them.
    clientName: sees(ctx) ? clientName : null, projectName: sees(ctx) ? projectName : null, taskTitle: sees(ctx) ? taskTitle : null,
    attendees: attendees || [],
    canEdit, canDelete: canEdit,
  };
}

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND e.id = ?${visibility(ctx)}`).get(ctx.organizationId, Number(id), ...visibilityParams(ctx));
  if (!row) throw new ServiceError(404, 'Event not found');
  return row;
}

function getEvent(db, ctx, id) {
  need(ctx, 'events.view');
  const row = find(db, ctx, id);
  return shape(ctx, row, attendeesOf(db, [row.id]).get(row.id));
}

// ---- input checks ----

function cleanMoment(value, label, allDay) {
  if (allDay) { const d = cleanDate(value, label); if (!d) throw new ServiceError(400, `${label} is required`); return d; }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(String(value || ''));
  const d = m && new Date(String(value));
  if (!d || Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) || d.getUTCHours() !== Number(m[4])) throw new ServiceError(400, `${label} must be a date and time in UTC, like 2026-10-12T14:00:00Z`);
  return `${d.toISOString().slice(0, 19)}Z`;
}

const dayCount = (a, b) => (Date.parse(b.length === 10 ? `${b}T00:00:00Z` : b) - Date.parse(a.length === 10 ? `${a}T00:00:00Z` : a)) / 86400000;

function cleanAttendees(db, ctx, value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ServiceError(400, 'Attendees must be a list of team members');
  const ids = [...new Set(value.map((v) => cleanTeamMember(db, ctx.organizationId, v)).filter((v) => v !== null))];
  if (ids.length > 50) throw new ServiceError(400, 'An event can have at most 50 attendees');
  return ids;
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

function writeAttendees(db, eventId, ids) {
  db.prepare('DELETE FROM event_attendees WHERE event_id = ?').run(eventId);
  const ins = db.prepare('INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)');
  for (const id of ids) ins.run(eventId, id);
}

function checkRange(next) {
  if (next.endsAt < next.startsAt) throw new ServiceError(400, 'The end cannot be before the start');
  if (dayCount(next.startsAt, next.endsAt) > MAX_DAYS) throw new ServiceError(400, `An event can last at most ${MAX_DAYS} days`);
}

// Anyone without events.manage may only block their own time.
function checkOwnOnly(ctx, type, attendeeIds) {
  if (manages(ctx)) return;
  need(ctx, 'events.own');
  if (type !== 'blocked_time') throw new ServiceError(403, 'Not allowed');
  if (attendeeIds && attendeeIds.some((id) => id !== ctx.actor.id)) throw new ServiceError(403, 'You can only block your own time');
}

function createEvent(db, ctx, input = {}) {
  need(ctx, 'events.view');
  return db.transaction(() => {
    const type = cleanEnum(input.type === undefined ? 'internal_meeting' : input.type, TYPES, 'type');
    const attendeeInput = cleanAttendees(db, ctx, input.attendees);
    const attendeeIds = manages(ctx) ? (attendeeInput || []) : [ctx.actor.id];
    checkOwnOnly(ctx, type, attendeeInput);
    const allDay = !!input.allDay;
    const next = {
      title: cleanText(input.title, 'Title', 1, 200), type, allDay,
      startsAt: cleanMoment(input.startsAt, 'Start', allDay), endsAt: cleanMoment(input.endsAt === undefined || input.endsAt === null || input.endsAt === '' ? input.startsAt : input.endsAt, 'End', allDay),
      location: cleanOptional(input.location, 'Location', 300), notes: cleanOptional(input.notes, 'Notes', 10000),
      status: input.status === undefined ? 'scheduled' : cleanEnum(input.status, STATUSES, 'status'),
      ...resolveLinks(db, ctx, input),
    };
    checkRange(next);
    const id = Number(db.prepare('INSERT INTO events (organization_id, title, type, starts_at, ends_at, all_day, location, notes, status, client_id, project_id, task_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, next.title, next.type, next.startsAt, next.endsAt, next.allDay ? 1 : 0, next.location, next.notes, next.status, next.clientId, next.projectId, next.taskId, ctx.actor.id).lastInsertRowid);
    writeAttendees(db, id, attendeeIds);
    logActivity(db, { ...logCtx(ctx), action: 'event.create', objectType: 'event', objectId: id, after: { title: next.title, type: next.type, startsAt: next.startsAt, attendees: attendeeIds.length } });
    return getEvent(db, ctx, id);
  })();
}

function updateEvent(db, ctx, id, patch = {}) {
  need(ctx, 'events.view');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    const currentAttendees = (attendeesOf(db, [current.id]).get(current.id) || []).map((a) => a.id);
    const own = current.createdBy === ctx.actor.id;
    if (!manages(ctx) && !(own && current.type === 'blocked_time' && perms.can(ctx.actor.role, 'events.own'))) throw new ServiceError(403, 'Not allowed');
    const next = { ...current, allDay: !!current.allDay };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.type !== undefined) next.type = cleanEnum(patch.type, TYPES, 'type');
    if (patch.allDay !== undefined) next.allDay = !!patch.allDay;
    const attendeeInput = cleanAttendees(db, ctx, patch.attendees);
    checkOwnOnly(ctx, next.type, attendeeInput);
    // Switching between timed and all-day needs a fresh start and end.
    if (next.allDay !== !!current.allDay && (patch.startsAt === undefined || patch.endsAt === undefined)) throw new ServiceError(400, 'Give a new start and end when switching between all-day and timed');
    if (patch.startsAt !== undefined) next.startsAt = cleanMoment(patch.startsAt, 'Start', next.allDay);
    if (patch.endsAt !== undefined) next.endsAt = cleanMoment(patch.endsAt, 'End', next.allDay);
    if (patch.location !== undefined) next.location = cleanOptional(patch.location, 'Location', 300);
    if (patch.notes !== undefined) next.notes = cleanOptional(patch.notes, 'Notes', 10000);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (['clientId', 'projectId', 'taskId'].some((k) => patch[k] !== undefined)) {
      // Changing a link clears the links below it that no longer agree, unless they were sent too.
      const given = { clientId: patch.clientId, projectId: patch.projectId, taskId: patch.taskId };
      if (patch.clientId !== undefined && patch.projectId === undefined && patch.clientId !== current.clientId) given.projectId = null;
      if ((patch.projectId !== undefined || given.projectId === null) && patch.taskId === undefined && given.projectId !== current.projectId) given.taskId = null;
      Object.assign(next, resolveLinks(db, ctx, { clientId: given.clientId === undefined ? current.clientId : given.clientId, projectId: given.projectId === undefined ? current.projectId : given.projectId, taskId: given.taskId === undefined ? current.taskId : given.taskId }));
    }
    checkRange(next);
    const d = diff({ ...current, allDay: !!current.allDay }, next, FIELDS);
    const sameAttendees = attendeeInput === undefined || (attendeeInput.length === currentAttendees.length && attendeeInput.every((x) => currentAttendees.includes(x)));
    if (!d.changed && sameAttendees) return getEvent(db, ctx, id);
    db.prepare(`UPDATE events SET title = ?, type = ?, starts_at = ?, ends_at = ?, all_day = ?, location = ?, notes = ?, status = ?, client_id = ?, project_id = ?, task_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(next.title, next.type, next.startsAt, next.endsAt, next.allDay ? 1 : 0, next.location, next.notes, next.status, next.clientId, next.projectId, next.taskId, ctx.organizationId, current.id);
    const before = { ...d.before }; const after = { ...d.after };
    if (!sameAttendees) { writeAttendees(db, current.id, attendeeInput); before.attendees = currentAttendees.length; after.attendees = attendeeInput.length; }
    logActivity(db, { ...logCtx(ctx), action: 'event.update', objectType: 'event', objectId: current.id, before, after });
    return getEvent(db, ctx, id);
  })();
}

function deleteEvent(db, ctx, id) {
  need(ctx, 'events.view');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    const own = current.createdBy === ctx.actor.id && current.type === 'blocked_time' && perms.can(ctx.actor.role, 'events.own');
    if (!manages(ctx) && !own) throw new ServiceError(403, 'Not allowed');
    db.prepare('DELETE FROM events WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'event.delete', objectType: 'event', objectId: current.id, before: { title: current.title, type: current.type, startsAt: current.startsAt } });
    return { deleted: true };
  })();
}

// Events and deadlines between two dates (inclusive, UTC dates; the screen pads one day for its time zone).
// `userId` narrows to what that person attends or is assigned; `clientId` to one client.
function calendar(db, ctx, { from, to, clientId, userId, includeCancelled } = {}) {
  need(ctx, 'events.view');
  const start = cleanDate(from, 'From'); const end = cleanDate(to, 'To');
  if (!start || !end) throw new ServiceError(400, 'Give a from and a to date');
  if (end < start) throw new ServiceError(400, 'The end date cannot be before the start date');
  if (dayCount(`${start}`, `${end}`) > 120) throw new ServiceError(400, 'Ask for at most 120 days at a time');
  const who = userId ? Number(userId) : null;
  const where = [`substr(e.starts_at, 1, 10) <= ?`, `substr(e.ends_at, 1, 10) >= ?`];
  const params = [ctx.organizationId, end, start];
  if (!includeCancelled) where.push("e.status != 'cancelled'");
  if (clientId) { where.push('e.client_id = ?'); params.push(Number(clientId)); }
  if (who) { where.push('EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = ?)'); params.push(who); }
  const rows = db.prepare(`${SELECT} AND ${where.join(' AND ')}${visibility(ctx)} ORDER BY e.starts_at, e.id`).all(...params, ...visibilityParams(ctx));
  const att = attendeesOf(db, rows.map((r) => r.id));
  const events = rows.map((r) => shape(ctx, r, att.get(r.id)));

  // Deadlines: open tasks and unfinished projects, read only. A Contractor sees only their own tasks.
  const deadlines = [];
  const own = sees(ctx) ? '' : ' AND t.assignee_id = ?';
  const taskParams = [ctx.organizationId, start, end, ...(sees(ctx) ? [] : [ctx.actor.id])];
  let taskSql = `SELECT t.id, t.title, t.due_date AS date, t.status, t.assignee_id AS assigneeId, p.client_id AS clientId, c.name AS clientName, t.project_id AS projectId FROM tasks t JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id WHERE t.organization_id = ? AND t.due_date BETWEEN ? AND ? AND t.status != 'done'${own}`;
  if (clientId) { taskSql += ' AND p.client_id = ?'; taskParams.push(Number(clientId)); }
  if (who) { taskSql += ' AND t.assignee_id = ?'; taskParams.push(who); }
  for (const t of db.prepare(`${taskSql} ORDER BY t.due_date, t.id`).all(...taskParams)) deadlines.push({ kind: 'task', id: t.id, title: t.title, date: t.date, status: t.status, assigneeId: t.assigneeId, clientId: sees(ctx) ? t.clientId : null, clientName: sees(ctx) ? t.clientName : null, projectId: t.projectId });
  if (sees(ctx) && !who) {
    let projSql = "SELECT p.id, p.name AS title, p.due_date AS date, p.status, p.client_id AS clientId, c.name AS clientName FROM projects p JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id WHERE p.organization_id = ? AND p.due_date BETWEEN ? AND ? AND p.status IN ('planning','active','on_hold')";
    const projParams = [ctx.organizationId, start, end];
    if (clientId) { projSql += ' AND p.client_id = ?'; projParams.push(Number(clientId)); }
    for (const p of db.prepare(`${projSql} ORDER BY p.due_date, p.id`).all(...projParams)) deadlines.push({ kind: 'project', id: p.id, title: p.title, date: p.date, status: p.status, clientId: p.clientId, clientName: p.clientName });
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date));
  return { from: start, to: end, events, deadlines };
}

module.exports = { TYPES, STATUSES, getEvent, createEvent, updateEvent, deleteEvent, calendar };
