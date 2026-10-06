// Joshua Nunez
// QA: the queue of work waiting for review, and the review itself. Reviewing is a human decision, so an AI cannot
// do it. A reviewer is an Owner, Admin or Manager. Nobody reviews their own work, except the Owner.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanOptional, cleanText } = require('./validate');
const perms = require('./permissions');
const tasks = require('./tasks');
const qarecords = require('./qarecords');

const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });
const need = (ctx) => { if (!perms.can(ctx.actor.role, 'qa.review')) throw new ServiceError(403, 'Not allowed'); };

function listQueue(db, ctx) {
  need(ctx);
  return db.prepare(
    `SELECT r.id AS reviewId, r.submitted_at AS submittedAt, r.checklist_json, t.id AS taskId, t.title, p.name AS projectName, c.name AS clientName,
            au.display_name AS assigneeName, su.display_name AS submittedByName, sp.title AS sopTitle, sv.major, sv.minor
       FROM qa_reviews r
       JOIN tasks t ON t.id = r.task_id AND t.organization_id = r.organization_id
       JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
       JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
       LEFT JOIN users au ON au.id = t.assignee_id
       LEFT JOIN users su ON su.id = r.submitted_by
       LEFT JOIN sops sp ON sp.id = t.sop_id AND sp.organization_id = t.organization_id
       LEFT JOIN sop_versions sv ON sv.id = t.sop_version_id
      WHERE r.organization_id = ? AND r.status = 'pending'
      ORDER BY r.submitted_at, r.id`
  ).all(ctx.organizationId).map((r) => ({
    reviewId: r.reviewId, taskId: r.taskId, title: r.title, projectName: r.projectName, clientName: r.clientName, assigneeName: r.assigneeName, submittedByName: r.submittedByName,
    submittedAt: r.submittedAt, sopTitle: r.sopTitle, sopVersion: r.major == null ? null : `${r.major}.${r.minor}`, checklistTotal: JSON.parse(r.checklist_json).length,
  }));
}

function waitingCount(db, ctx) {
  if (!perms.can(ctx.actor.role, 'qa.review')) return 0;
  return db.prepare("SELECT COUNT(*) AS n FROM qa_reviews WHERE organization_id = ? AND status = 'pending'").get(ctx.organizationId).n;
}

// result: 'approved' (every checklist item ticked) or 'changes_requested' (a comment says what to change).
function reviewTask(db, ctx, taskId, input = {}) {
  need(ctx);
  if (ctx.source === 'ai') throw new ServiceError(403, 'Only a person can review work');
  return db.transaction(() => {
    const task = tasks.find(db, ctx, taskId);
    const rec = qarecords.pendingRow(db, ctx.organizationId, task.id);
    if (task.status !== 'review' || !rec) throw new ServiceError(400, 'This task is not waiting for QA');
    if (ctx.actor.role !== 'owner' && (rec.submitted_by === ctx.actor.id || task.assigneeId === ctx.actor.id)) throw new ServiceError(403, 'You cannot review your own work');
    if (!['approved', 'changes_requested'].includes(input.result)) throw new ServiceError(400, 'Choose a result: approved or changes_requested');
    const snapshot = JSON.parse(rec.checklist_json);
    const ticks = Array.isArray(input.checklist) ? input.checklist.map(Boolean) : [];
    const checklist = snapshot.map((item, i) => ({ text: item.text, checked: !!ticks[i] }));
    let comments;
    if (input.result === 'approved') {
      if (!checklist.every((c) => c.checked) || (snapshot.length > 0 && ticks.length !== snapshot.length)) throw new ServiceError(400, 'Tick every checklist item to approve');
      comments = cleanOptional(input.comments, 'Comments', 5000);
    } else {
      comments = typeof input.comments === 'string' && input.comments.trim() ? cleanText(input.comments, 'Comments', 1, 5000) : '';
      if (!comments) throw new ServiceError(400, 'Say what needs to change');
    }
    const approved = input.result === 'approved';
    db.prepare("UPDATE qa_reviews SET status = ?, checklist_json = ?, comments = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(input.result, JSON.stringify(checklist), comments, ctx.actor.id, rec.id);
    db.prepare(`UPDATE tasks SET status = ?, completed_at = ${approved ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE organization_id = ? AND id = ?`)
      .run(approved ? 'done' : 'changes', ctx.organizationId, task.id);
    logActivity(db, { ...logCtx(ctx), action: approved ? 'qa.approve' : 'qa.request_changes', objectType: 'task', objectId: task.id, before: { status: 'review' }, after: { status: approved ? 'done' : 'changes' } });
    return tasks.detail(db, ctx, task.id);
  })();
}

module.exports = { listQueue, waitingCount, reviewTask };
