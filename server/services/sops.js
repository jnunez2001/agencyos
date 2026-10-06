// Joshua Nunez
// SOPs: how the agency does repeatable work. Content is versioned and never overwritten. Status, owner and the
// QA flag belong to the SOP itself. Every query is scoped by the organization.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText, cleanOptional, cleanEnum, cleanTeamMember, diff } = require('./validate');
const perms = require('./permissions');

const STATUSES = ['draft', 'testing', 'approved', 'deprecated'];
const MAX_STEPS = 50;
const MAX_CHECKLIST = 30;
const TEXT_FIELDS = [['purpose', 'Purpose'], ['whenToUse', 'When to use'], ['inputs', 'Required inputs'], ['expectedOutput', 'Expected output'], ['commonMistakes', 'Common mistakes'], ['examples', 'Examples']];

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const sees = (ctx) => perms.can(ctx.actor.role, 'sops.manage'); // managers see drafts, staff only what is in use
const label = (v) => `${v.major}.${v.minor}`;

const SELECT = `
  SELECT s.id, s.title, s.service, s.owner_id AS ownerId, ou.display_name AS ownerName, s.status, s.requires_qa AS requiresQa,
         s.created_at AS createdAt, s.updated_at AS updatedAt,
         v.id AS versionId, v.major, v.minor
    FROM sops s
    LEFT JOIN users ou ON ou.id = s.owner_id
    JOIN sop_versions v ON v.id = (SELECT id FROM sop_versions WHERE sop_id = s.id AND organization_id = s.organization_id ORDER BY major DESC, minor DESC LIMIT 1)
   WHERE s.organization_id = ?`;

const shape = (r) => ({ id: r.id, title: r.title, service: r.service, ownerId: r.ownerId, ownerName: r.ownerName, status: r.status, requiresQa: !!r.requiresQa, version: label(r), versionId: r.versionId, createdAt: r.createdAt, updatedAt: r.updatedAt });

function find(db, ctx, id) {
  const row = db.prepare(`${SELECT} AND s.id = ?`).get(ctx.organizationId, Number(id));
  if (!row || (!sees(ctx) && row.status === 'draft')) throw new ServiceError(404, 'SOP not found');
  return row;
}

function listSops(db, ctx, { status, service, q } = {}) {
  need(ctx, 'sops.view');
  const where = [];
  const params = [ctx.organizationId];
  if (!sees(ctx)) where.push("s.status != 'draft'");
  if (status) { where.push('s.status = ?'); params.push(cleanEnum(status, STATUSES, 'status')); }
  if (service) { where.push('s.service = ?'); params.push(String(service)); }
  if (q) { const like = `%${String(q).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`; where.push("(s.title LIKE ? ESCAPE '\\' OR s.service LIKE ? ESCAPE '\\' OR v.purpose LIKE ? ESCAPE '\\')"); params.push(like, like, like); }
  const rows = db.prepare(`${SELECT.replace('JOIN sop_versions v ON', 'JOIN sop_versions v ON')} ${where.map((w) => `AND ${w}`).join(' ')} ORDER BY s.title COLLATE NOCASE`).all(...params);
  return rows.map(shape);
}

const contentOf = (row) => ({
  purpose: row.purpose, whenToUse: row.when_to_use, inputs: row.inputs, expectedOutput: row.expected_output, commonMistakes: row.common_mistakes, examples: row.examples,
  steps: JSON.parse(row.steps_json), checklist: JSON.parse(row.checklist_json),
});

function readVersion(db, organizationId, sopId, versionId) {
  const row = db.prepare('SELECT v.*, u.display_name AS createdByName FROM sop_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.organization_id = ? AND v.sop_id = ? AND v.id = ?').get(organizationId, sopId, Number(versionId));
  if (!row) throw new ServiceError(404, 'Version not found');
  return row;
}

function versionsOf(db, organizationId, sopId) {
  return db.prepare('SELECT v.id, v.major, v.minor, v.change_note, v.created_at, u.display_name AS createdByName FROM sop_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.organization_id = ? AND v.sop_id = ? ORDER BY v.major DESC, v.minor DESC').all(organizationId, sopId)
    .map((v) => ({ id: v.id, label: label(v), changeNote: v.change_note, createdAt: v.created_at, createdByName: v.createdByName }));
}

function getSop(db, ctx, id) {
  need(ctx, 'sops.view');
  const row = find(db, ctx, id);
  return { ...shape(row), content: contentOf(readVersion(db, ctx.organizationId, row.id, row.versionId)), versions: versionsOf(db, ctx.organizationId, row.id) };
}

function getVersion(db, ctx, sopId, versionId) {
  need(ctx, 'sops.view');
  const row = find(db, ctx, sopId);
  const v = readVersion(db, ctx.organizationId, row.id, versionId);
  return { id: v.id, label: label(v), changeNote: v.change_note, createdAt: v.created_at, createdByName: v.createdByName, content: contentOf(v) };
}

function cleanList(value, what, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ServiceError(400, `${what} must be a list`);
  if (value.length > max) throw new ServiceError(400, `${what} can have at most ${max} items`);
  return value.map((item) => cleanText(item, `Each ${what.toLowerCase().replace(/s$/, '')}`, 1, 500));
}

// Content fields from `input`, with anything not sent taken from `base`.
function readContent(input, base = {}) {
  const out = {};
  for (const [key, labelText] of TEXT_FIELDS) out[key] = input[key] === undefined ? (base[key] || '') : cleanOptional(input[key], labelText, 5000);
  out.steps = input.steps === undefined ? (base.steps || []) : cleanList(input.steps, 'Steps', MAX_STEPS);
  out.checklist = input.checklist === undefined ? (base.checklist || []) : cleanList(input.checklist, 'Checklist', MAX_CHECKLIST);
  return out;
}

// A person must approve an SOP. An AI may draft and test, never approve.
function checkApprover(ctx, status) {
  if (status === 'approved' && ctx.source === 'ai') throw new ServiceError(403, 'Only a person can approve an SOP');
}

function insertVersion(db, ctx, sopId, major, minor, content, changeNote) {
  return Number(db.prepare(
    `INSERT INTO sop_versions (organization_id, sop_id, major, minor, purpose, when_to_use, inputs, steps_json, checklist_json, expected_output, common_mistakes, examples, change_note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ctx.organizationId, sopId, major, minor, content.purpose, content.whenToUse, content.inputs, JSON.stringify(content.steps), JSON.stringify(content.checklist), content.expectedOutput, content.commonMistakes, content.examples, changeNote, ctx.actor.id).lastInsertRowid);
}

function createSop(db, ctx, input = {}) {
  need(ctx, 'sops.manage');
  const next = {
    title: cleanText(input.title, 'Title', 1, 120),
    service: cleanOptional(input.service, 'Service', 80),
    status: input.status === undefined ? 'draft' : cleanEnum(input.status, STATUSES, 'status'),
    requiresQa: !!input.requiresQa,
  };
  checkApprover(ctx, next.status);
  return db.transaction(() => {
    const ownerId = cleanTeamMember(db, ctx.organizationId, input.ownerId === undefined ? ctx.actor.id : input.ownerId);
    const content = readContent(input);
    const id = Number(db.prepare('INSERT INTO sops (organization_id, title, service, owner_id, status, requires_qa, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ctx.organizationId, next.title, next.service, ownerId, next.status, next.requiresQa ? 1 : 0, ctx.actor.id).lastInsertRowid);
    insertVersion(db, ctx, id, 1, 0, content, 'First version');
    logActivity(db, { ...logCtx(ctx), action: 'sop.create', objectType: 'sop', objectId: id, after: { title: next.title, status: next.status, version: '1.0' } });
    return shape(find(db, ctx, id));
  })();
}

function updateSop(db, ctx, id, patch = {}) {
  need(ctx, 'sops.manage');
  return db.transaction(() => {
    const row = find(db, ctx, id);
    const current = { title: row.title, service: row.service, ownerId: row.ownerId, status: row.status, requiresQa: !!row.requiresQa };
    const next = { ...current };
    if (patch.title !== undefined) next.title = cleanText(patch.title, 'Title', 1, 120);
    if (patch.service !== undefined) next.service = cleanOptional(patch.service, 'Service', 80);
    if (patch.status !== undefined) next.status = cleanEnum(patch.status, STATUSES, 'status');
    if (patch.requiresQa !== undefined) next.requiresQa = !!patch.requiresQa;
    if (patch.ownerId !== undefined && Number(patch.ownerId) !== row.ownerId) next.ownerId = cleanTeamMember(db, ctx.organizationId, patch.ownerId);
    const d = diff(current, next, ['title', 'service', 'ownerId', 'status', 'requiresQa']);
    if (!d.changed) return shape(row);
    if (d.after.status) checkApprover(ctx, next.status);
    db.prepare("UPDATE sops SET title = ?, service = ?, owner_id = ?, status = ?, requires_qa = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?")
      .run(next.title, next.service, next.ownerId, next.status, next.requiresQa ? 1 : 0, ctx.organizationId, row.id);
    logActivity(db, { ...logCtx(ctx), action: 'sop.update', objectType: 'sop', objectId: row.id, before: d.before, after: d.after });
    return shape(find(db, ctx, id));
  })();
}

// Editing the content adds a new version. Fields not sent carry over from the latest one.
function addVersion(db, ctx, id, input = {}) {
  need(ctx, 'sops.manage');
  return db.transaction(() => {
    const row = find(db, ctx, id);
    const latest = readVersion(db, ctx.organizationId, row.id, row.versionId);
    const base = contentOf(latest);
    const content = readContent(input, base);
    if (JSON.stringify(content) === JSON.stringify(base)) throw new ServiceError(400, 'Nothing changed, so there is no new version');
    const changeNote = cleanOptional(input.changeNote, 'Change note', 500);
    const major = input.major ? latest.major + 1 : latest.major;
    const minor = input.major ? 0 : latest.minor + 1;
    insertVersion(db, ctx, row.id, major, minor, content, changeNote);
    db.prepare("UPDATE sops SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
    logActivity(db, { ...logCtx(ctx), action: 'sop.version', objectType: 'sop', objectId: row.id, after: { version: `${major}.${minor}`, changeNote } });
    return shape(find(db, ctx, id));
  })();
}

// For tasks: an SOP that may be attached (testing or approved), with its latest version.
function forAttach(db, organizationId, sopId) {
  const row = db.prepare(`${SELECT} AND s.id = ?`).get(organizationId, Number(sopId));
  if (!row) throw new ServiceError(404, 'SOP not found');
  if (!['testing', 'approved'].includes(row.status)) throw new ServiceError(400, 'Only a testing or approved SOP can be attached to a task');
  return { id: row.id, title: row.title, requiresQa: !!row.requiresQa, versionId: row.versionId, version: label(row) };
}

// For task pages: a pinned version's content, and the label of the newest one.
function pinned(db, organizationId, sopId, versionId) {
  if (!sopId || !versionId) return null;
  const sop = db.prepare(`${SELECT} AND s.id = ?`).get(organizationId, Number(sopId));
  const v = db.prepare('SELECT * FROM sop_versions WHERE organization_id = ? AND sop_id = ? AND id = ?').get(organizationId, Number(sopId), Number(versionId));
  if (!sop || !v) return null;
  return { id: sop.id, title: sop.title, status: sop.status, version: label(v), latestVersion: label(sop), isLatest: v.id === sop.versionId, content: contentOf(v) };
}

module.exports = { STATUSES, MAX_STEPS, readContent, listSops, getSop, getVersion, createSop, updateSop, addVersion, forAttach, pinned };
