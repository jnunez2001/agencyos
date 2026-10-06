// Joshua Nunez
// QA records: one per submission of a task for review. The checklist is a snapshot of the SOP's quality checklist
// at that moment, with a tick for each item. Low level on purpose: the rules live in tasks.js and qa.js.
const record = (r) => ({
  id: r.id, status: r.status, submittedByName: r.submittedByName || null, submittedAt: r.submitted_at,
  reviewerName: r.reviewerName || null, reviewedAt: r.reviewed_at, comments: r.comments, checklist: JSON.parse(r.checklist_json),
});

const SELECT = `
  SELECT r.*, su.display_name AS submittedByName, ru.display_name AS reviewerName
    FROM qa_reviews r
    LEFT JOIN users su ON su.id = r.submitted_by
    LEFT JOIN users ru ON ru.id = r.reviewed_by
   WHERE r.organization_id = ?`;

function createPending(db, ctx, taskId, checklistTexts) {
  const checklist = checklistTexts.map((text) => ({ text, checked: false }));
  const id = Number(db.prepare('INSERT INTO qa_reviews (organization_id, task_id, submitted_by, checklist_json) VALUES (?, ?, ?, ?)').run(ctx.organizationId, taskId, ctx.actor.id, JSON.stringify(checklist)).lastInsertRowid);
  return id;
}

const pendingRow = (db, organizationId, taskId) => db.prepare(`${SELECT} AND r.task_id = ? AND r.status = 'pending' ORDER BY r.id DESC LIMIT 1`).get(organizationId, taskId) || null;

function pending(db, organizationId, taskId) {
  const row = pendingRow(db, organizationId, taskId);
  return row ? record(row) : null;
}

function withdrawPending(db, organizationId, taskId) {
  db.prepare("UPDATE qa_reviews SET status = 'withdrawn' WHERE organization_id = ? AND task_id = ? AND status = 'pending'").run(organizationId, taskId);
}

function history(db, organizationId, taskId) {
  return db.prepare(`${SELECT} AND r.task_id = ? ORDER BY r.id DESC`).all(organizationId, taskId).map(record);
}

module.exports = { createPending, pending, pendingRow, withdrawPending, history, record };
