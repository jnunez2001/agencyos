// Joshua Nunez
// Structured meeting notes, optionally tied to a calendar event (one note per event). Draft notes may be written by
// anyone who attends the event or wrote the note; Managers and above write any note and are the only ones who finalize.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanDate, diff } = require('./validate');
const clients = require('./clients');
const projects = require('./projects');
const events = require('./events');
const perms = require('./permissions');
const { pageOf } = require('./paging');

const STATUSES = ['draft', 'final'];
const SECTIONS = { transcript: ['Transcript', 100000], summary: ['Summary', 5000], agenda: ['Agenda', 10000], discussion: ['Discussion', 20000], decisions: ['Decisions', 10000], requests: ['Requests', 10000], followUps: ['Follow-ups', 10000], purpose: ['Purpose', 5000], risks: ['Risks', 10000], importantContext: ['Important context', 10000], sopImpact: ['SOP impact', 10000], nextMeeting: ['Next meeting', 5000] };
const FIELDS = ['title', 'meetingDate', 'status', 'eventId', 'clientId', 'projectId', ...Object.keys(SECTIONS)];

const SEARCHED = ['n.title', 'n.summary', 'n.discussion', 'n.decisions', 'n.requests', 'n.follow_ups'];
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const manages = (ctx) => perms.can(ctx.actor.role, 'notes.manage');
const sees = (ctx) => perms.can(ctx.actor.role, 'clients.view');

const SELECT = `
  SELECT n.id, n.title, n.meeting_date AS meetingDate, n.summary, n.agenda, n.discussion, n.decisions, n.requests, n.follow_ups AS followUps, n.purpose, n.risks, n.important_context AS importantContext, n.sop_impact AS sopImpact, n.next_meeting AS nextMeeting, n.transcript, n.ai_drafted AS aiDrafted,
         n.status, n.event_id AS eventId, n.client_id AS clientId, c.name AS clientName, n.project_id AS projectId, p.name AS projectName,
         n.created_by AS createdBy, cu.display_name AS createdByName, n.finalized_by AS finalizedBy, fu.display_name AS finalizedByName,
         n.finalized_at AS finalizedAt, n.created_at AS createdAt, n.updated_at AS updatedAt
    FROM meeting_notes n
    LEFT JOIN clients c ON c.id = n.client_id AND c.organization_id = n.organization_id
    LEFT JOIN projects p ON p.id = n.project_id AND p.organization_id = n.organization_id
    LEFT JOIN users cu ON cu.id = n.created_by
    LEFT JOIN users fu ON fu.id = n.finalized_by
   WHERE n.organization_id = ?`;

// A Contractor sees only notes they wrote and notes of events they attend.
const visibility = (ctx) => (sees(ctx) ? '' : ' AND (n.created_by = ? OR EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = n.event_id AND a.user_id = ?))');
const visibilityParams = (ctx) => (sees(ctx) ? [] : [ctx.actor.id, ctx.actor.id]);

function attends(db, ctx, row) {
  return !!(row.eventId && db.prepare('SELECT 1 FROM event_attendees WHERE event_id = ? AND user_id = ?').get(row.eventId, ctx.actor.id));
}
function mayWrite(db, ctx, row) {
  if (manages(ctx)) return true;
  return row.status === 'draft' && (row.createdBy === ctx.actor.id || attends(db, ctx, row));
}

function shape(db, ctx, row) {
  const { clientName, projectName, ...rest } = row;
  const write = mayWrite(db, ctx, row);
  return { ...rest, aiDrafted: !!row.aiDrafted, clientName: sees(ctx) ? clientName : null, projectName: sees(ctx) ? projectName : null, canEdit: write, canFinalize: manages(ctx), canDelete: manages(ctx) };
}

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND n.id = ?${visibility(ctx)}`).get(ctx.organizationId, Number(id), ...visibilityParams(ctx));
  if (!row) throw new ServiceError(404, 'Meeting note not found');
  return row;
}

function getNote(db, ctx, id) {
  need(ctx, 'notes.view');
  return shape(db, ctx, find(db, ctx, id));
}

function listNotes(db, ctx, { clientId, projectId, status, q, from, to, limit, offset } = {}) {
  need(ctx, 'notes.view');
  const where = []; const params = [ctx.organizationId];
  if (clientId) { where.push('n.client_id = ?'); params.push(Number(clientId)); }
  if (projectId) { where.push('n.project_id = ?'); params.push(Number(projectId)); }
  if (status) { cleanEnum(status, STATUSES, 'status'); where.push('n.status = ?'); params.push(status); }
  if (from) { where.push('n.meeting_date >= ?'); params.push(cleanDate(from, 'From')); }
  if (to) { where.push('n.meeting_date <= ?'); params.push(cleanDate(to, 'To')); }
  // The text of the note is searched too (discussion, decisions, requests and follow-ups), never the raw transcript.
  if (q) { where.push(`(${SEARCHED.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`); const like = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`; for (let i = 0; i < SEARCHED.length; i += 1) params.push(like); }
  const page = pageOf({ limit, offset }, 200);
  const rows = db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')}${visibility(ctx)} ORDER BY n.meeting_date DESC, n.id DESC LIMIT ? OFFSET ?`).all(...params, ...visibilityParams(ctx), page.limit, page.offset);
  return rows.map((r) => {
    // The list leaves the long sections out; open a note for them.
    const { agenda, discussion, decisions, requests, followUps, purpose, risks, importantContext, sopImpact, nextMeeting, transcript, ...short } = shape(db, ctx, r);
    return short;
  });
}

function cleanSections(input, current = {}) {
  const out = {};
  for (const [key, [label, max]] of Object.entries(SECTIONS)) {
    if (input[key] !== undefined) out[key] = cleanOptional(input[key], label, max);
    else if (key in current) out[key] = current[key];
  }
  return out;
}

function checkLinks(db, ctx, next) {
  if (next.projectId) {
    const project = projects.find(db, ctx.organizationId, next.projectId);
    if (next.clientId && project.clientId !== next.clientId) throw new ServiceError(400, 'That project belongs to another client');
    next.clientId = next.clientId || project.clientId;
  }
  if (next.clientId) clients.find(db, ctx.organizationId, next.clientId);
}

function createNote(db, ctx, input = {}) {
  need(ctx, 'notes.view');
  return db.transaction(() => {
    let event = null;
    if (input.eventId != null && input.eventId !== '') {
      event = events.getEvent(db, ctx, input.eventId);
      if (db.prepare('SELECT 1 FROM meeting_notes WHERE organization_id = ? AND event_id = ?').get(ctx.organizationId, event.id)) throw new ServiceError(400, 'That event already has meeting notes');
    }
    // Without an event, only Managers and above start a note: an attendee writes the note of their own event.
    if (!manages(ctx)) {
      const attending = event && (event.createdBy === ctx.actor.id || event.attendees.some((a) => a.id === ctx.actor.id));
      if (!attending) throw new ServiceError(403, 'Not allowed');
    }
    const eventDay = event ? (event.allDay ? event.startsAt : event.startsAt.slice(0, 10)) : null;
    const next = {
      title: cleanText(input.title === undefined && event ? event.title : input.title, 'Title', 1, 200),
      meetingDate: cleanDate(input.meetingDate === undefined ? eventDay : input.meetingDate, 'Meeting date'),
      status: 'draft', eventId: event ? event.id : null,
      clientId: input.clientId === undefined ? (event ? event.clientId : null) : (input.clientId || null),
      projectId: input.projectId === undefined ? (event ? event.projectId : null) : (input.projectId || null),
      ...cleanSections(input),
    };
    if (!next.meetingDate) throw new ServiceError(400, 'Meeting date is required');
    if (input.status !== undefined && input.status !== 'draft') {
      if (!manages(ctx)) throw new ServiceError(403, 'Only a manager can finalize notes');
      next.status = cleanEnum(input.status, STATUSES, 'status');
    }
    checkLinks(db, ctx, next);
    const id = Number(db.prepare('INSERT INTO meeting_notes (organization_id, title, meeting_date, summary, agenda, discussion, decisions, requests, follow_ups, status, event_id, client_id, project_id, created_by, finalized_by, finalized_at, transcript, ai_drafted, purpose, risks, important_context, sop_impact, next_meeting) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.organizationId, next.title, next.meetingDate, next.summary || '', next.agenda || '', next.discussion || '', next.decisions || '', next.requests || '', next.followUps || '', next.status, next.eventId, next.clientId, next.projectId, ctx.actor.id, next.status === 'final' ? ctx.actor.id : null, next.status === 'final' ? new Date().toISOString() : null, next.transcript || '', ctx.source === 'ai' ? 1 : 0, next.purpose || '', next.risks || '', next.importantContext || '', next.sopImpact || '', next.nextMeeting || '').lastInsertRowid);
    if (next.eventId) db.prepare('UPDATE events SET meeting_note_id = ? WHERE organization_id = ? AND id = ?').run(id, ctx.organizationId, next.eventId);
    logActivity(db, { ...logCtx(ctx), action: 'meeting_note.create', objectType: 'meeting_note', objectId: id, after: { title: next.title, meetingDate: next.meetingDate, eventId: next.eventId, status: next.status } });
    return getNote(db, ctx, id);
  })();
}

function updateNote(db, ctx, id, patch = {}) {
  need(ctx, 'notes.view');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    if (!mayWrite(db, ctx, current)) throw new ServiceError(403, current.status === 'final' ? 'This note is final. A manager can reopen it' : 'Not allowed');
    const next = { ...current, ...cleanSections(patch, current) };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.meetingDate !== undefined) { next.meetingDate = cleanDate(patch.meetingDate, 'Meeting date'); if (!next.meetingDate) throw new ServiceError(400, 'Meeting date is required'); }
    if (patch.status !== undefined && patch.status !== current.status) {
      if (!manages(ctx)) throw new ServiceError(403, 'Only a manager can finalize or reopen notes');
      next.status = cleanEnum(patch.status, STATUSES, 'status');
    }
    if (patch.clientId !== undefined) next.clientId = patch.clientId || null;
    if (patch.projectId !== undefined) next.projectId = patch.projectId || null;
    if (patch.clientId !== undefined && patch.projectId === undefined && next.clientId !== current.clientId) next.projectId = null;
    if (patch.eventId !== undefined && (patch.eventId || null) !== current.eventId) throw new ServiceError(400, 'A note stays with the event it was made for');
    checkLinks(db, ctx, next);
    const d = diff(current, next, FIELDS);
    if (!d.changed) return shape(db, ctx, current);
    const finalizing = next.status === 'final' && current.status !== 'final';
    db.prepare(`UPDATE meeting_notes SET title = ?, meeting_date = ?, summary = ?, agenda = ?, discussion = ?, decisions = ?, requests = ?, follow_ups = ?, status = ?, client_id = ?, project_id = ?,
                  finalized_by = ?, finalized_at = ?, transcript = ?, ai_drafted = ?, purpose = ?, risks = ?, important_context = ?, sop_impact = ?, next_meeting = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(next.title, next.meetingDate, next.summary, next.agenda, next.discussion, next.decisions, next.requests, next.followUps, next.status, next.clientId, next.projectId,
        next.status === 'final' ? (finalizing ? ctx.actor.id : current.finalizedBy) : null, next.status === 'final' ? (finalizing ? new Date().toISOString() : current.finalizedAt) : null, next.transcript, ctx.source === 'ai' ? 1 : (finalizing || Object.keys(d.after).some((k) => k in SECTIONS) ? 0 : (current.aiDrafted ? 1 : 0)), next.purpose, next.risks, next.importantContext, next.sopImpact, next.nextMeeting, ctx.organizationId, current.id);
    // Long sections are logged by name only, so the log stays small.
    const before = {}; const after = {};
    for (const k of Object.keys(d.after)) { if (k in SECTIONS && k !== 'summary') { before[k] = '(changed)'; after[k] = '(changed)'; } else { before[k] = d.before[k]; after[k] = d.after[k]; } }
    logActivity(db, { ...logCtx(ctx), action: finalizing ? 'meeting_note.finalize' : 'meeting_note.update', objectType: 'meeting_note', objectId: current.id, before, after });
    return getNote(db, ctx, id);
  })();
}

function deleteNote(db, ctx, id) {
  need(ctx, 'notes.manage');
  return db.transaction(() => {
    const current = find(db, ctx, id);
    db.prepare('UPDATE events SET meeting_note_id = NULL WHERE organization_id = ? AND meeting_note_id = ?').run(ctx.organizationId, current.id);
    db.prepare('DELETE FROM meeting_notes WHERE organization_id = ? AND id = ?').run(ctx.organizationId, current.id);
    logActivity(db, { ...logCtx(ctx), action: 'meeting_note.delete', objectType: 'meeting_note', objectId: current.id, before: { title: current.title, meetingDate: current.meetingDate } });
    return { deleted: true };
  })();
}

module.exports = { STATUSES, SECTIONS, getNote, listNotes, createNote, updateNote, deleteNote };
