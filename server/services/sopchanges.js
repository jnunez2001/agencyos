// Joshua Nunez
// SOP change requests: a reviewed way to improve an SOP. Anyone but a Contractor raises one (a Contractor only on an SOP
// of their own task), Managers review, approve, reject and publish. Publishing adds a NEW SOP version through the SOP
// service and never overwrites anything. An AI can raise and edit drafts but never decide, start, test or publish.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, diff } = require('./validate');
const perms = require('./permissions');
const sops = require('./sops');
const notifications = require('./notifications');

const STATUSES = ['identified', 'needs_review', 'approved', 'in_progress', 'testing', 'published', 'rejected'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const SOURCE_TYPES = ['task', 'qa_review', 'meeting_note', 'follow_up'];
const DRAFT = ['identified', 'needs_review']; // what the person who raised it, and an AI, may work with
const PUBLISHABLE = ['approved', 'in_progress', 'testing'];
const CONTENT_KEYS = ['purpose', 'whenToUse', 'inputs', 'expectedOutput', 'commonMistakes', 'examples', 'steps', 'checklist'];
const FIELDS = ['title', 'details', 'proposedText', 'priority', 'status', 'rejectedReason'];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const manages = (ctx) => perms.can(ctx.actor.role, 'sopchanges.manage');
const seesSops = (ctx) => perms.can(ctx.actor.role, 'sops.view');
const isAi = (ctx) => ctx.source === 'ai';

// A change that reaches review is something a manager must look at.
function tellReviewers(db, ctx, id, title, sopId) {
  const sop = db.prepare('SELECT title FROM sops WHERE organization_id = ? AND id = ?').get(ctx.organizationId, sopId);
  notifications.notify(db, ctx, { userIds: notifications.peopleWith(db, ctx.organizationId, 'sopchanges.manage'), type: 'sopchange_review', title: `SOP change to review: ${title}`, body: sop ? `On ${sop.title}` : '', link: '#/sops/changes', objectType: 'sop_change_request', objectId: id, dedupeKey: `sopchange_review:${id}` });
}

const SELECT = `
  SELECT r.id, r.sop_id AS sopId, s.title AS sopTitle, s.status AS sopStatus, r.title, r.details, r.proposed_text AS proposedText, r.proposed_content_json AS proposedContentJson,
         r.priority, r.status, r.source_type AS sourceType, r.source_id AS sourceId,
         CASE r.source_type WHEN 'task' THEN st.title WHEN 'qa_review' THEN qt.title WHEN 'meeting_note' THEN sn.title WHEN 'follow_up' THEN sf.title END AS sourceTitle,
         r.rejected_reason AS rejectedReason, r.reviewed_by AS reviewedBy, ru.display_name AS reviewedByName, r.reviewed_at AS reviewedAt,
         r.published_version_id AS publishedVersionId, pv.major AS pubMajor, pv.minor AS pubMinor, r.published_by AS publishedBy, pu.display_name AS publishedByName, r.published_at AS publishedAt,
         r.created_by AS createdBy, cu.display_name AS createdByName, r.created_at AS createdAt, r.updated_at AS updatedAt
    FROM sop_change_requests r
    JOIN sops s ON s.id = r.sop_id AND s.organization_id = r.organization_id
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users ru ON ru.id = r.reviewed_by
    LEFT JOIN users pu ON pu.id = r.published_by
    LEFT JOIN sop_versions pv ON pv.id = r.published_version_id AND pv.organization_id = r.organization_id
    LEFT JOIN tasks st ON r.source_type = 'task' AND st.id = r.source_id AND st.organization_id = r.organization_id
    LEFT JOIN qa_reviews qr ON r.source_type = 'qa_review' AND qr.id = r.source_id AND qr.organization_id = r.organization_id
    LEFT JOIN tasks qt ON qt.id = qr.task_id AND qt.organization_id = r.organization_id
    LEFT JOIN meeting_notes sn ON r.source_type = 'meeting_note' AND sn.id = r.source_id AND sn.organization_id = r.organization_id
    LEFT JOIN follow_ups sf ON r.source_type = 'follow_up' AND sf.id = r.source_id AND sf.organization_id = r.organization_id
   WHERE r.organization_id = ?`;

// Managers see everything. A Contractor sees what they raised. Everyone else sees all except what is on a draft SOP.
const scope = (ctx) => (manages(ctx) ? '' : seesSops(ctx) ? " AND (s.status != 'draft' OR r.created_by = ?)" : ' AND r.created_by = ?');
const scopeParams = (ctx) => (manages(ctx) ? [] : [ctx.actor.id]);

const proposedOf = (row) => (row.proposedContentJson ? JSON.parse(row.proposedContentJson) : null);

function shape(ctx, row, { full = false } = {}) {
  const mine = row.createdBy === ctx.actor.id;
  const m = manages(ctx);
  const open = DRAFT.includes(row.status);
  const out = {
    id: row.id, sopId: row.sopId, sopTitle: row.sopTitle, title: row.title, details: row.details, proposedText: row.proposedText, hasProposedContent: !!row.proposedContentJson,
    priority: row.priority, status: row.status, sourceType: row.sourceType, sourceId: row.sourceId, sourceTitle: m ? row.sourceTitle || null : null,
    rejectedReason: row.rejectedReason, reviewedByName: row.reviewedByName, reviewedAt: row.reviewedAt,
    publishedVersionId: row.publishedVersionId, publishedVersion: row.publishedVersionId ? `${row.pubMajor}.${row.pubMinor}` : null, publishedByName: row.publishedByName, publishedAt: row.publishedAt,
    createdBy: row.createdBy, createdByName: row.createdByName, createdAt: row.createdAt, updatedAt: row.updatedAt,
    canEdit: row.status !== 'published' && (m || (mine && open)),
    canPublish: m && PUBLISHABLE.includes(row.status),
  };
  if (full) out.proposedContent = proposedOf(row);
  return out;
}

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND r.id = ?${scope(ctx)}`).get(ctx.organizationId, Number(id), ...scopeParams(ctx));
  if (!row) throw new ServiceError(404, 'Change request not found');
  return row;
}

function getChange(db, ctx, id) {
  need(ctx, 'sopchanges.view');
  return shape(ctx, find(db, ctx, id), { full: true });
}

function listChanges(db, ctx, { status, sopId, priority, mine, q } = {}) {
  need(ctx, 'sopchanges.view');
  const where = [];
  const params = [ctx.organizationId];
  if (status) { where.push('r.status = ?'); params.push(cleanEnum(status, STATUSES, 'status')); }
  if (priority) { where.push('r.priority = ?'); params.push(cleanEnum(priority, PRIORITIES, 'priority')); }
  if (sopId) { where.push('r.sop_id = ?'); params.push(Number(sopId)); }
  if (mine) { where.push('r.created_by = ?'); params.push(ctx.actor.id); }
  if (q) { where.push("(r.title LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\')"); const like = `%${String(q).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
  const order = "ORDER BY (r.status IN ('published','rejected')), CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, r.id DESC LIMIT 300";
  return db.prepare(`${SELECT} ${where.map((w) => `AND ${w}`).join(' ')}${scope(ctx)} ${order}`).all(...params, ...scopeParams(ctx)).map((r) => shape(ctx, r));
}

// Only the content fields that were sent are kept, so publishing carries everything else over from the current version.
function cleanProposed(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ServiceError(400, 'Proposed content must be an object');
  const full = sops.readContent(value);
  const out = {};
  for (const key of CONTENT_KEYS) if (value[key] !== undefined) out[key] = full[key];
  return Object.keys(out).length ? out : null;
}

function cleanSource(db, ctx, type, id) {
  if ((type == null || type === '') && (id == null || id === '')) return { sourceType: null, sourceId: null };
  const sourceType = cleanEnum(type, SOURCE_TYPES, 'source');
  const sourceId = Number(id);
  if (!Number.isInteger(sourceId) || sourceId < 1) throw new ServiceError(400, 'Choose where this came from');
  const table = { task: 'tasks', qa_review: 'qa_reviews', meeting_note: 'meeting_notes', follow_up: 'follow_ups' }[sourceType];
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE organization_id = ? AND id = ?`).get(ctx.organizationId, sourceId)) throw new ServiceError(400, 'That source was not found');
  return { sourceType, sourceId };
}

function checkVerdict(ctx, status) {
  if (isAi(ctx) && !DRAFT.includes(status)) throw new ServiceError(403, 'Only a person can approve, reject, start, test or publish an SOP change');
}

function createChange(db, ctx, input = {}) {
  need(ctx, 'sopchanges.create');
  const status = input.status === undefined ? 'identified' : cleanEnum(input.status, STATUSES, 'status');
  checkVerdict(ctx, status);
  if (!DRAFT.includes(status)) throw new ServiceError(400, 'A new change request starts as identified or needs_review');
  return db.transaction(() => {
    const sop = db.prepare('SELECT id, status FROM sops WHERE organization_id = ? AND id = ?').get(ctx.organizationId, Number(input.sopId));
    if (!sop || (!manages(ctx) && seesSops(ctx) && sop.status === 'draft')) throw new ServiceError(404, 'SOP not found');
    const source = cleanSource(db, ctx, input.sourceType, input.sourceId);
    if (!seesSops(ctx)) {
      // A Contractor raises a change only on the SOP of a task assigned to them, and that task is the source.
      const own = db.prepare('SELECT 1 FROM tasks WHERE organization_id = ? AND sop_id = ? AND assignee_id = ?').get(ctx.organizationId, sop.id, ctx.actor.id);
      if (!own) throw new ServiceError(403, 'You can raise a change request only on an SOP that is on one of your tasks');
      if (source.sourceType !== 'task' || !db.prepare('SELECT 1 FROM tasks WHERE organization_id = ? AND id = ? AND assignee_id = ? AND sop_id = ?').get(ctx.organizationId, source.sourceId, ctx.actor.id, sop.id)) throw new ServiceError(403, 'Pick the task of yours that follows this SOP');
    }
    const next = {
      title: cleanText(input.title, 'Title', 1, 200), details: cleanText(input.details, 'What should change and why', 1, 10000),
      proposedText: cleanOptional(input.proposedText, 'Proposed text', 10000), priority: input.priority === undefined ? 'normal' : cleanEnum(input.priority, PRIORITIES, 'priority'),
    };
    const proposed = cleanProposed(input.proposedContent);
    const id = Number(db.prepare(
      'INSERT INTO sop_change_requests (organization_id, sop_id, title, details, proposed_text, proposed_content_json, priority, status, source_type, source_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(ctx.organizationId, sop.id, next.title, next.details, next.proposedText, proposed ? JSON.stringify(proposed) : null, next.priority, status, source.sourceType, source.sourceId, ctx.actor.id).lastInsertRowid);
    logActivity(db, { ...logCtx(ctx), action: 'sopchange.create', objectType: 'sop_change_request', objectId: id, after: { title: next.title, sopId: sop.id, status, priority: next.priority, ...(source.sourceType ? { source: `${source.sourceType} ${source.sourceId}` } : {}) } });
    if (status === 'needs_review') tellReviewers(db, ctx, id, next.title, sop.id);
    return shape(ctx, find(db, ctx, id), { full: true });
  })();
}

function updateChange(db, ctx, id, patch = {}) {
  need(ctx, 'sopchanges.view');
  return db.transaction(() => {
    const row = find(db, ctx, id);
    const view = shape(ctx, row);
    if (row.status === 'published') throw new ServiceError(400, 'A published change request cannot be changed');
    if (!view.canEdit) throw new ServiceError(403, 'Not allowed');
    if (isAi(ctx) && !DRAFT.includes(row.status)) throw new ServiceError(403, 'Only a person can change a request after it is approved or rejected');
    const next = { ...row };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 200);
    if (patch.details !== undefined) next.details = cleanText(patch.details, 'What should change and why', 1, 10000);
    if (patch.proposedText !== undefined) next.proposedText = cleanOptional(patch.proposedText, 'Proposed text', 10000);
    if (patch.priority !== undefined) next.priority = cleanEnum(patch.priority, PRIORITIES, 'priority');
    if (patch.status !== undefined) {
      next.status = cleanEnum(patch.status, STATUSES, 'status');
      checkVerdict(ctx, next.status);
      if (next.status === 'published') throw new ServiceError(400, 'Use Publish to publish a change request');
      if (!manages(ctx) && !DRAFT.includes(next.status)) throw new ServiceError(403, 'Only a manager can move a change request past review');
    }
    if (patch.rejectedReason !== undefined) {
      if (next.status !== 'rejected') throw new ServiceError(400, 'A reason is only for a rejected change request');
      next.rejectedReason = cleanOptional(patch.rejectedReason, 'Reason', 2000);
    } else if (next.status !== 'rejected') next.rejectedReason = '';
    if (next.status === 'rejected' && !next.rejectedReason) throw new ServiceError(400, 'Say why this change request is rejected');
    let proposedJson = row.proposedContentJson;
    if (patch.proposedContent !== undefined) { const p = cleanProposed(patch.proposedContent); proposedJson = p ? JSON.stringify(p) : null; }
    const d = diff(row, next, FIELDS);
    if (proposedJson !== row.proposedContentJson) { d.before.proposedContent = row.proposedContentJson ? 'set' : 'none'; d.after.proposedContent = proposedJson ? 'set' : 'none'; d.changed = true; }
    if (!d.changed) return shape(ctx, row, { full: true });
    const decided = d.after.status && ['approved', 'rejected'].includes(next.status);
    db.prepare(`UPDATE sop_change_requests SET title = ?, details = ?, proposed_text = ?, proposed_content_json = ?, priority = ?, status = ?, rejected_reason = ?,
        reviewed_by = ?, reviewed_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(next.title, next.details, next.proposedText, proposedJson, next.priority, next.status, next.rejectedReason,
        decided ? ctx.actor.id : row.reviewedBy, decided ? new Date().toISOString() : row.reviewedAt, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'sopchange.update', objectType: 'sop_change_request', objectId: row.id, before: d.before, after: d.after });
    if (d.after.status === 'needs_review') tellReviewers(db, ctx, row.id, next.title, row.sopId);
    return shape(ctx, find(db, ctx, id), { full: true });
  })();
}

// Adds a new SOP version from the request and records which one. The approved version is never edited.
function publishChange(db, ctx, id, input = {}) {
  need(ctx, 'sopchanges.manage');
  if (isAi(ctx)) throw new ServiceError(403, 'Only a person can publish an SOP change');
  return db.transaction(() => {
    const row = find(db, ctx, id);
    if (row.status === 'published') throw new ServiceError(400, 'This change request is already published');
    if (!PUBLISHABLE.includes(row.status)) throw new ServiceError(400, 'Approve the change request before publishing it');
    const sent = cleanProposed(input.content);
    const content = { ...(proposedOf(row) || {}), ...(sent || {}) };
    if (Object.keys(content).length === 0) throw new ServiceError(400, 'Add the new version content before publishing. Nothing was changed');
    const note = cleanOptional(input.changeNote, 'Change note', 500) || `Change request #${row.id}: ${row.title}`.slice(0, 500);
    const sop = sops.addVersion(db, ctx, row.sopId, { ...content, changeNote: note, major: !!input.major });
    db.prepare("UPDATE sop_change_requests SET status = 'published', published_version_id = ?, published_by = ?, published_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(sop.versionId, ctx.actor.id, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'sopchange.publish', objectType: 'sop_change_request', objectId: row.id, before: { status: row.status }, after: { status: 'published', sopId: row.sopId, version: sop.version } });
    // The people working to this SOP and its owner hear that a new version exists.
    const working = db.prepare("SELECT DISTINCT assignee_id AS id FROM tasks WHERE organization_id = ? AND sop_id = ? AND status != 'done' AND assignee_id IS NOT NULL").all(ctx.organizationId, row.sopId).map((r) => r.id);
    const sopRow = db.prepare('SELECT owner_id AS ownerId FROM sops WHERE organization_id = ? AND id = ?').get(ctx.organizationId, row.sopId);
    notifications.notify(db, ctx, { userIds: [...working, sopRow && sopRow.ownerId], type: 'sop_published', title: `SOP updated: ${row.sopTitle}`, body: `Version ${sop.version} is published. ${row.title}`.slice(0, 300), link: `#/sops/${row.sopId}`, objectType: 'sop', objectId: row.sopId, dedupeKey: `sop_published:${row.id}` });
    return shape(ctx, find(db, ctx, id), { full: true });
  })();
}

module.exports = { STATUSES, PRIORITIES, SOURCE_TYPES, listChanges, getChange, createChange, updateChange, publishChange };
