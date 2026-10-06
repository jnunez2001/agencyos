// Joshua Nunez
// Meeting note to records: each line of a note's Decisions, Requests and Follow-ups sections becomes a decision, a
// client request or a follow-up that points back at the note. A line already turned into a record (same note and
// title) is skipped, so running it twice never doubles anything. Managers and above.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const notes = require('./meetingnotes');
const requests = require('./requests');
const decisions = require('./decisions');
const followups = require('./followups');
const perms = require('./permissions');

const KINDS = ['decisions', 'requests', 'followUps'];
const MAX_LINES = 30;

// "- Use WordPress", "1. Send logo" and plain lines all give the text after the bullet.
function lines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, MAX_LINES);
}
const split = (line) => (line.length <= 200 ? { title: line, details: '' } : { title: `${line.slice(0, 197)}...`, details: line });

const TABLE = { decisions: 'decisions', requests: 'client_requests', followUps: 'follow_ups' };

function extractRecords(db, ctx, noteId, { kinds = KINDS } = {}) {
  if (!perms.can(ctx.actor.role, 'notes.manage')) throw new ServiceError(403, 'Not allowed');
  if (!Array.isArray(kinds) || kinds.some((k) => !KINDS.includes(k))) throw new ServiceError(400, `Choose from ${KINDS.join(', ')}`);
  return db.transaction(() => {
    const note = notes.getNote(db, ctx, noteId);
    const made = { decisions: [], requests: [], followUps: [] };
    const skipped = { decisions: 0, requests: 0, followUps: 0 };
    if (kinds.includes('requests') && lines(note.requests).length && !note.clientId) throw new ServiceError(400, 'Link this note to a client first. Requests belong to a client');
    for (const kind of kinds) {
      const exists = db.prepare(`SELECT 1 FROM ${TABLE[kind]} WHERE organization_id = ? AND source_note_id = ? AND title = ? COLLATE NOCASE`);
      for (const line of lines(note[kind])) {
        const { title, details } = split(line);
        if (exists.get(ctx.organizationId, note.id, title)) { skipped[kind] += 1; continue; }
        const common = { title, clientId: note.clientId, projectId: note.projectId };
        const opts = { sourceNoteId: note.id };
        const rec = kind === 'decisions' ? decisions.createDecision(db, ctx, { ...common, details, decidedOn: note.meetingDate }, opts)
          : kind === 'requests' ? requests.createRequest(db, ctx, { ...common, description: details }, opts)
            : followups.createFollowUp(db, ctx, { ...common, details }, opts);
        made[kind].push({ id: rec.id, title: rec.title });
      }
    }
    logActivity(db, { organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null, action: 'meeting_note.extract', objectType: 'meeting_note', objectId: note.id,
      after: { decisions: made.decisions.length, requests: made.requests.length, followUps: made.followUps.length } });
    return { noteId: note.id, created: made, skipped };
  })();
}

// What a note has already produced, for the note page.
function recordsOfNote(db, ctx, noteId) {
  const note = notes.getNote(db, ctx, noteId);
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id = ? AND source_note_id = ?`).get(ctx.organizationId, note.id).n;
  return { decisions: count('decisions'), requests: count('client_requests'), followUps: count('follow_ups') };
}

module.exports = { KINDS, extractRecords, recordsOfNote, lines };
