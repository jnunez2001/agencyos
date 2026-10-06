// Joshua Nunez
// QA: the queue of work waiting for review, and the review sheet.
import { h, openSheet } from '../dom.js';
import { api } from '../api.js';
import { avatar, formatWhen, textareaField } from '../ui.js';

export async function openReview(session, taskId, onChanged) {
  const task = await api('GET', `/tasks/${taskId}`);
  const pending = task.qa.pending;
  if (!pending) throw new Error('This task is not waiting for QA');
  openSheet(`Review: ${task.title}`, (close) => {
    const boxes = pending.checklist.map((item) => h('input', { type: 'checkbox', 'aria-label': item.text }));
    const comments = textareaField('Comments', { name: 'comments', rows: 4, maxlength: 5000 });
    const error = h('div', { class: 'error', role: 'alert' });
    const approve = h('button', { class: 'btn btn-primary', type: 'button' }, 'Approve');
    const changes = h('button', { class: 'btn btn-danger', type: 'button' }, 'Request changes');
    const sync = () => { approve.disabled = !boxes.every((b) => b.checked); };
    boxes.forEach((b) => b.addEventListener('change', sync));
    sync();
    const send = (result) => async () => {
      error.textContent = '';
      approve.disabled = changes.disabled = true;
      try {
        await api('POST', `/tasks/${task.id}/qa`, { result, comments: comments.input.value, checklist: boxes.map((b) => b.checked) });
        close();
        await onChanged();
      } catch (err) { error.textContent = err.message; changes.disabled = false; sync(); }
    };
    approve.addEventListener('click', send('approved'));
    changes.addEventListener('click', send('changes_requested'));
    return h('div', { class: 'sheet-body' },
      h('p', { class: 'muted' }, `${task.projectName}, ${task.clientName}. Submitted by ${pending.submittedByName || 'someone'} ${formatWhen(pending.submittedAt)}.`),
      task.sop ? h('p', {}, `Following ${task.sop.title} v${task.sop.version}.`) : null,
      pending.checklist.length
        ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quality checklist'), h('div', { class: 'checks' }, pending.checklist.map((item, i) => h('label', { class: 'check' }, boxes[i], h('span', {}, item.text)))))
        : h('p', { class: 'muted' }, 'This task has no checklist.'),
      comments.el, error,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), changes, approve));
  });
}

export async function qaView(session, { rerender }) {
  const queue = await api('GET', '/qa');
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'QA')),
    queue.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'Nothing is waiting for review.'))
      : h('section', { class: 'panel list' }, queue.map((q) => h('button', { class: 'row', type: 'button', onclick: () => openReview(session, q.taskId, rerender).catch((e) => alert(e.message)) },
        q.assigneeName ? avatar({ id: 0, displayName: q.assigneeName }, 'md') : null,
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, q.title),
          h('div', { class: 'row-sub' }, [`${q.projectName}, ${q.clientName}`, q.sopTitle ? `${q.sopTitle} v${q.sopVersion}` : null, `submitted ${formatWhen(q.submittedAt)}`].filter(Boolean).join(' · '))),
        q.checklistTotal ? h('span', { class: 'muted nowrap' }, `${q.checklistTotal} checks`) : null))));
}
