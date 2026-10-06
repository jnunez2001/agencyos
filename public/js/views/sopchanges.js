// Joshua Nunez
// SOP change requests: the list, the panel on an SOP page, and the sheets to raise, read, decide and publish one.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, pill, priorityPill, formatWhen, PRIORITY_LABEL } from '../ui.js';

export const CHANGE_STATUS_LABEL = { identified: 'Identified', needs_review: 'Needs review', approved: 'Approved', in_progress: 'In progress', testing: 'Testing', published: 'Published', rejected: 'Rejected' };
const OPEN = ['identified', 'needs_review', 'approved', 'in_progress', 'testing'];
const SOURCE_LABEL = { task: 'Task', qa_review: 'QA review', meeting_note: 'Meeting note', follow_up: 'Follow-up' };
export const changePill = (s) => pill('sc', s, CHANGE_STATUS_LABEL[s] || s);
const SOURCE_PLAIN = { task: 'task', qa_review: 'QA review', meeting_note: 'meeting note', follow_up: 'follow-up' };
let filter = 'open';

const lines = (value) => String(value || '').split('\n').map((l) => l.trim()).filter(Boolean);
const sourceText = (c) => (c.sourceType ? `${SOURCE_LABEL[c.sourceType]}${c.sourceTitle ? `: ${c.sourceTitle}` : ` #${c.sourceId}`}` : null);

// Raise a request on an SOP. `from` may carry where it came from and some starting text.
export function openRaiseChange(session, { sopId, sopTitle, sourceType, sourceId, title, details }, onDone) {
  openSheet(`Raise change request${sopTitle ? `: ${sopTitle}` : ''}`, (close) => {
    const name = field('Title', { name: 'title', maxlength: 200, required: true, value: title || '', placeholder: 'Add a page speed check' });
    const what = textareaField('What should change and why', { name: 'details', rows: 4, maxlength: 10000, required: true }, details || '');
    const proposed = textareaField('Proposed wording (optional)', { name: 'proposedText', rows: 3, maxlength: 10000 });
    const priority = selectField('Priority', Object.entries(PRIORITY_LABEL), 'normal', { name: 'priority' });
    const review = h('input', { type: 'checkbox', name: 'needsReview' });
    return sheetForm([name, what, proposed, priority, h('label', { class: 'check' }, review, h('span', {}, 'Ask a manager to review it now'))], 'Raise change request', async () => {
      const made = await api('POST', '/sop-changes', { sopId, title: name.input.value, details: what.input.value, proposedText: proposed.input.value, priority: priority.input.value, status: review.checked ? 'needs_review' : 'identified', sourceType, sourceId });
      if (onDone) await onDone(made);
    }, close, sourceType ? h('p', { class: 'muted' }, `This will be linked to the ${SOURCE_PLAIN[sourceType]} it came from.`) : null);
  });
}

function openEdit(c, onChanged) {
  openSheet('Edit change request', (close) => {
    const name = field('Title', { name: 'title', maxlength: 200, required: true, value: c.title });
    const what = textareaField('What should change and why', { name: 'details', rows: 4, maxlength: 10000, required: true }, c.details);
    const proposed = textareaField('Proposed wording (optional)', { name: 'proposedText', rows: 3, maxlength: 10000 }, c.proposedText);
    const priority = selectField('Priority', Object.entries(PRIORITY_LABEL), c.priority, { name: 'priority' });
    return sheetForm([name, what, proposed, priority], 'Save', async () => {
      await api('PATCH', `/sop-changes/${c.id}`, { title: name.input.value, details: what.input.value, proposedText: proposed.input.value, priority: priority.input.value });
      await onChanged();
    }, close);
  });
}

// Publishing adds a new SOP version. The current version stays readable.
async function openPublish(c, onChanged) {
  const sop = c.hasProposedContent ? null : await api('GET', `/sops/${c.sopId}`);
  openSheet(`Publish: ${c.title}`, (close) => {
    const note = field('What changed', { name: 'changeNote', maxlength: 500, value: `Change request #${c.id}: ${c.title}`.slice(0, 500) });
    const major = h('input', { type: 'checkbox', name: 'major' });
    const cur = sop ? sop.content : {};
    const purpose = sop ? textareaField('Purpose', { name: 'purpose', rows: 2, maxlength: 5000 }, cur.purpose || '') : null;
    const steps = sop ? textareaField('Steps (one per line)', { name: 'steps', rows: 6 }, (cur.steps || []).join('\n')) : null;
    const checklist = sop ? textareaField('Quality checklist (one per line)', { name: 'checklist', rows: 4 }, (cur.checklist || []).join('\n')) : null;
    const intro = c.hasProposedContent
      ? h('p', { class: 'muted' }, 'This request carries the new content. Publishing adds it as a new version of the SOP.')
      : h('p', { class: 'muted' }, 'This request has no new content yet. Write it below. It becomes a new version of the SOP.');
    return sheetForm([intro, purpose, steps, checklist, note, h('label', { class: 'check' }, major, h('span', {}, 'Major change (a new whole version number)'))], 'Publish new version', async () => {
      const body = { changeNote: note.input.value, major: major.checked };
      if (sop) body.content = { purpose: purpose.input.value, steps: lines(steps.input.value), checklist: lines(checklist.input.value) };
      await api('POST', `/sop-changes/${c.id}/publish`, body);
      await onChanged();
    }, close, h('p', { class: 'muted' }, 'The approved version is not edited. Tasks already using it keep it.'));
  });
}

// One request: its details, and for a manager the next steps.
export async function openChange(session, id, onChanged) {
  const c = await api('GET', `/sop-changes/${id}`);
  const manage = session.can['sopchanges.manage'];
  openSheet(c.title, (close) => {
    const error = h('div', { class: 'error', role: 'alert' });
    const done = async () => { close(); await onChanged(); };
    const move = (status, label, kind = 'btn') => h('button', { class: kind, type: 'button', onclick: async () => {
      error.textContent = '';
      try { await api('PATCH', `/sop-changes/${c.id}`, { status }); await done(); } catch (err) { error.textContent = err.message; }
    } }, label);
    const reason = textareaField('Why is it rejected', { name: 'rejectedReason', rows: 3, maxlength: 2000 });
    const rejectBox = h('div', { class: 'stack' }, reason.el, h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
      error.textContent = '';
      try { await api('PATCH', `/sop-changes/${c.id}`, { status: 'rejected', rejectedReason: reason.input.value }); await done(); } catch (err) { error.textContent = err.message; }
    } }, 'Confirm reject'));
    rejectBox.hidden = true;
    const rejectButton = h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { rejectBox.hidden = false; rejectButton.hidden = true; } }, 'Reject');
    const next = [];
    if (manage) {
      if (c.status === 'identified') next.push(move('needs_review', 'Send to review'), rejectButton);
      if (c.status === 'needs_review') next.push(move('approved', 'Approve', 'btn btn-primary'), rejectButton);
      if (c.status === 'approved') next.push(move('in_progress', 'Start work'), move('testing', 'Move to testing'), rejectButton);
      if (c.status === 'in_progress') next.push(move('testing', 'Move to testing'));
      if (c.status === 'testing') next.push(move('in_progress', 'Back to in progress'));
      if (c.status === 'rejected') next.push(move('needs_review', 'Reopen'));
      if (c.canPublish) next.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { close(); openPublish(c, onChanged).catch((e) => alert(e.message)); } }, 'Publish'));
    } else if (c.canEdit && c.status === 'identified') next.push(move('needs_review', 'Ask for review'));
    const pc = c.proposedContent;
    return h('div', { class: 'sheet-body' },
      h('div', { class: 'head-meta' }, changePill(c.status), priorityPill(c.priority), h('a', { class: 'link', href: `#/sops/${c.sopId}`, onclick: () => close() }, c.sopTitle)),
      h('dl', { class: 'facts' }, h('dt', {}, 'Raised by'), h('dd', {}, `${c.createdByName || 'Someone'}, ${formatWhen(c.createdAt)}`),
        sourceText(c) ? h('dt', {}, 'Came from') : null, sourceText(c) ? h('dd', {}, sourceText(c)) : null,
        c.reviewedByName ? h('dt', {}, 'Decided by') : null, c.reviewedByName ? h('dd', {}, `${c.reviewedByName}, ${formatWhen(c.reviewedAt)}`) : null,
        c.publishedVersion ? h('dt', {}, 'Published as') : null, c.publishedVersion ? h('dd', {}, `Version ${c.publishedVersion} by ${c.publishedByName || 'someone'}, ${formatWhen(c.publishedAt)}`) : null),
      h('h3', { class: 'section-title' }, 'What should change and why'), h('p', { class: 'prose' }, c.details),
      c.proposedText ? h('h3', { class: 'section-title' }, 'Proposed wording') : null, c.proposedText ? h('p', { class: 'prose' }, c.proposedText) : null,
      pc ? h('h3', { class: 'section-title' }, 'New version content') : null,
      pc && pc.steps ? h('ol', { class: 'steps' }, pc.steps.map((s) => h('li', {}, s))) : null,
      pc && !pc.steps ? h('p', { class: 'muted' }, 'Changes to the SOP text, applied when it is published.') : null,
      c.status === 'rejected' ? h('p', { class: 'prose' }, `Rejected: ${c.rejectedReason}`) : null,
      rejectBox, error,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close'),
        c.canEdit ? h('button', { class: 'btn', type: 'button', onclick: () => { close(); openEdit(c, onChanged); } }, 'Edit') : null,
        ...next));
  });
}

export const changeRow = (session, c, onChanged, { showSop = true } = {}) => h('button', { class: 'row', type: 'button', onclick: () => openChange(session, c.id, onChanged).catch((e) => alert(e.message)) },
  h('div', { class: 'grow' }, h('div', { class: 'row-title' }, c.title), h('div', { class: 'row-sub' }, [showSop ? c.sopTitle : null, `raised by ${c.createdByName || 'someone'} ${formatWhen(c.createdAt)}`, c.publishedVersion ? `published as v${c.publishedVersion}` : null].filter(Boolean).join(' · '))),
  priorityPill(c.priority), changePill(c.status), icon('chevron'));

// The panel on an SOP page.
export async function changesPanel(session, sop, rerender) {
  if (!session.can['sopchanges.view']) return null;
  const list = await api('GET', `/sop-changes?sopId=${sop.id}`);
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Change requests')),
    list.length === 0 ? h('p', { class: 'muted' }, 'No change requests for this SOP.') : h('div', { class: 'list-inner' }, list.map((c) => changeRow(session, c, rerender, { showSop: false }))));
}

// #/sops/changes
export async function changesListView(session, { rerender }) {
  const all = await api('GET', '/sop-changes');
  const shown = filter === 'all' ? all : filter === 'open' ? all.filter((c) => OPEN.includes(c.status)) : all.filter((c) => c.status === filter);
  const chip = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === key), onclick: () => { filter = key; rerender(); } }, label);
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/sops' }, icon('back'), 'SOPs'),
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'SOP change requests')),
    h('div', { class: 'chips' }, chip('open', 'Open'), Object.entries(CHANGE_STATUS_LABEL).map(([k, l]) => chip(k, l)), chip('all', 'All')),
    shown.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No change requests here.'))
      : h('section', { class: 'panel list' }, shown.map((c) => changeRow(session, c, rerender))));
}
