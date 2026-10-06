// Joshua Nunez
// SOPs: the list, an SOP page with its content and versions, and the forms.
import { h, icon, openSheet, goAfterSheets } from '../dom.js';
import { api } from '../api.js';
import { changesPanel, changesListView, openRaiseChange } from './sopchanges.js';
import { field, selectField, textareaField, sheetForm, pill, formatWhen, SOP_STATUS_LABEL, PRIORITY_LABEL } from '../ui.js';

const STATUSES = Object.keys(SOP_STATUS_LABEL);
export const sopPill = (s) => pill('sp', s, SOP_STATUS_LABEL[s] || s);
let statusFilter = 'approved';
let search = '';

const lines = (value) => String(value || '').split('\n').map((l) => l.trim()).filter(Boolean);

// Content fields, filled from `content` when editing. Steps and checklist are one item per line.
function contentFields(content = {}) {
  return {
    purpose: textareaField('Purpose', { name: 'purpose', rows: 2, maxlength: 5000 }, content.purpose || ''),
    whenToUse: textareaField('When to use', { name: 'whenToUse', rows: 2, maxlength: 5000 }, content.whenToUse || ''),
    inputs: textareaField('Required inputs', { name: 'inputs', rows: 2, maxlength: 5000 }, content.inputs || ''),
    steps: textareaField('Steps (one per line)', { name: 'steps', rows: 6 }, (content.steps || []).join('\n')),
    checklist: textareaField('Quality checklist (one per line)', { name: 'checklist', rows: 4 }, (content.checklist || []).join('\n')),
    expectedOutput: textareaField('Expected output', { name: 'expectedOutput', rows: 2, maxlength: 5000 }, content.expectedOutput || ''),
    commonMistakes: textareaField('Common mistakes', { name: 'commonMistakes', rows: 2, maxlength: 5000 }, content.commonMistakes || ''),
    examples: textareaField('Examples', { name: 'examples', rows: 2, maxlength: 5000 }, content.examples || ''),
  };
}
const contentBody = (c) => ({
  purpose: c.purpose.input.value, whenToUse: c.whenToUse.input.value, inputs: c.inputs.input.value, steps: lines(c.steps.input.value), checklist: lines(c.checklist.input.value),
  expectedOutput: c.expectedOutput.input.value, commonMistakes: c.commonMistakes.input.value, examples: c.examples.input.value,
});

async function openNewSop(session, onCreated) {
  const [members, services] = await Promise.all([api('GET', '/members'), session.can['services.view'] ? api('GET', '/services') : []]);
  openSheet('New SOP', (close) => {
    const title = field('Title', { name: 'title', maxlength: 120, required: true });
    const service = field('Service', { name: 'service', maxlength: 80, placeholder: 'SEO', list: 'service-names' });
    const owner = selectField('Owner', members.filter((m) => m.isActive).map((m) => [m.id, m.displayName]), session.user.id, { name: 'ownerId' });
    const status = selectField('Status', STATUSES.filter((s) => s !== 'deprecated').map((s) => [s, SOP_STATUS_LABEL[s]]), 'draft', { name: 'status' });
    const qa = h('input', { type: 'checkbox', name: 'requiresQa' });
    const c = contentFields();
    const names = h('datalist', { id: 'service-names' }, services.map((x) => h('option', { value: x.name })));
    return sheetForm([title, h('div', { class: 'two' }, service.el, owner.el), names, status, h('label', { class: 'check' }, qa, h('span', {}, 'Work following this SOP needs QA')), c.purpose, c.whenToUse, c.inputs, c.steps, c.checklist, c.expectedOutput, c.commonMistakes, c.examples], 'Create SOP', async () => {
      const made = await api('POST', '/sops', { title: title.input.value, service: service.input.value, ownerId: Number(owner.input.value), status: status.input.value, requiresQa: qa.checked, ...contentBody(c) });
      await onCreated(made);
    }, close);
  });
}

function openSopDetails(sop, members, onChanged) {
  openSheet('SOP details', (close) => {
    const title = field('Title', { name: 'title', maxlength: 120, required: true, value: sop.title });
    const service = field('Service', { name: 'service', maxlength: 80, value: sop.service });
    const owner = selectField('Owner', members.filter((m) => m.isActive || m.id === sop.ownerId).map((m) => [m.id, m.displayName]), sop.ownerId || '', { name: 'ownerId' });
    const status = selectField('Status', Object.entries(SOP_STATUS_LABEL), sop.status, { name: 'status' });
    const qa = h('input', { type: 'checkbox', name: 'requiresQa', checked: sop.requiresQa });
    return sheetForm([title, h('div', { class: 'two' }, service.el, owner.el), status, h('label', { class: 'check' }, qa, h('span', {}, 'Work following this SOP needs QA'))], 'Save', async () => {
      await api('PATCH', `/sops/${sop.id}`, { title: title.input.value, service: service.input.value, ownerId: owner.input.value ? Number(owner.input.value) : undefined, status: status.input.value, requiresQa: qa.checked });
      await onChanged();
    }, close);
  });
}

function openNewVersion(sop, onChanged) {
  openSheet(`New version of ${sop.title}`, (close) => {
    const c = contentFields(sop.content);
    const note = field('What changed', { name: 'changeNote', maxlength: 500, placeholder: 'Added a speed check step' });
    const major = h('input', { type: 'checkbox', name: 'major' });
    return sheetForm([c.purpose, c.whenToUse, c.inputs, c.steps, c.checklist, c.expectedOutput, c.commonMistakes, c.examples, note, h('label', { class: 'check' }, major, h('span', {}, `Major change (becomes ${Number(sop.version.split('.')[0]) + 1}.0)`))], 'Save new version', async () => {
      await api('POST', `/sops/${sop.id}/versions`, { ...contentBody(c), changeNote: note.input.value, major: major.checked });
      await onChanged();
    }, close, h('p', { class: 'muted' }, `This adds version ${sop.version.split('.')[0]}.${Number(sop.version.split('.')[1]) + 1}. Older versions stay readable.`));
  });
}

async function openUse(sop) {
  const [projects, members] = await Promise.all([api('GET', '/projects'), api('GET', '/members')]);
  const usable = projects.filter((p) => p.status !== 'archived');
  openSheet(`Use ${sop.title}`, (close) => {
    const project = selectField('Project', usable.map((p) => [p.id, `${p.name}, ${p.clientName}`]), usable[0] && usable[0].id, { name: 'projectId' });
    const mode = selectField('Create', [['task', 'One task'], ['steps', 'One task for each step']], 'task', { name: 'mode' });
    const assignee = selectField('Assigned to', [['', 'Nobody'], ...members.filter((m) => m.isActive).map((m) => [m.id, m.displayName])], '', { name: 'assigneeId' });
    const priority = selectField('Priority', Object.entries(PRIORITY_LABEL), 'normal', { name: 'priority' });
    const due = field('Due date', { name: 'dueDate', type: 'date' });
    return sheetForm([project, mode, h('div', { class: 'two' }, assignee.el, priority.el), due], 'Create tasks', async () => {
      const made = await api('POST', `/sops/${sop.id}/tasks`, { projectId: Number(project.input.value), mode: mode.input.value, assigneeId: assignee.input.value === '' ? undefined : Number(assignee.input.value), priority: priority.input.value, dueDate: due.input.value || undefined });
      goAfterSheets(`#/projects/${project.input.value}`);
      return made;
    }, close);
  });
}

function section(title, body) {
  return body ? h('div', { class: 'sop-section' }, h('h3', { class: 'section-title' }, title), body) : null;
}
const textBlock = (value) => (value ? h('p', { class: 'prose' }, value) : null);
const listBlock = (tag, items) => (items.length ? h(tag, { class: 'steps' }, items.map((i) => h('li', {}, i))) : null);

async function sopPage(session, id, rerender) {
  const sop = await api('GET', `/sops/${id}`);
  const manage = session.can['sops.manage'];
  const members = manage ? await api('GET', '/members') : [];
  const c = sop.content;
  const changes = await changesPanel(session, sop, rerender);
  const versions = h('div', { class: 'list-inner' }, sop.versions.map((v, i) => h('div', { class: 'row static' },
    h('div', { class: 'grow' }, h('div', { class: 'row-title' }, `Version ${v.label}`, i === 0 ? h('span', { class: 'pill role-owner' }, 'Current') : null), h('div', { class: 'row-sub' }, [v.changeNote, `${v.createdByName || 'Someone'}, ${formatWhen(v.createdAt)}`].filter(Boolean).join(' · ')),
      i === 0 ? null : h('button', { class: 'btn-text', type: 'button', onclick: async () => {
        const old = await api('GET', `/sops/${sop.id}/versions/${v.id}`);
        openSheet(`${sop.title} v${old.label}`, (close) => h('div', { class: 'sheet-body' },
          section('Purpose', textBlock(old.content.purpose)), section('Steps', listBlock('ol', old.content.steps)), section('Quality checklist', listBlock('ul', old.content.checklist)),
          h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close'))));
      } }, 'View')))));
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/sops' }, icon('back'), 'SOPs'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, sop.title), h('div', { class: 'head-meta' }, sopPill(sop.status), h('span', { class: 'pill' }, `v${sop.version}`), sop.requiresQa ? h('span', { class: 'pill role-owner' }, 'Needs QA') : null)),
      h('div', { class: 'head-actions' },
        session.can['tasks.manage'] && ['approved', 'testing'].includes(sop.status) ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openUse(sop).catch((e) => alert(e.message)) }, 'Use in a project') : null,
        session.can['sopchanges.create'] && h('button', { class: 'btn', type: 'button', onclick: () => openRaiseChange(session, { sopId: sop.id, sopTitle: sop.title }, rerender) }, 'Raise change request'),
        manage && h('button', { class: 'btn', type: 'button', onclick: () => openNewVersion(sop, rerender) }, 'New version'),
        manage && h('button', { class: 'btn', type: 'button', onclick: () => openSopDetails(sop, members, rerender) }, 'Details'))),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'About')),
          h('dl', { class: 'facts' }, h('dt', {}, 'Service'), h('dd', {}, sop.service || 'Not set'), h('dt', {}, 'Owner'), h('dd', {}, sop.ownerName || 'Nobody'), h('dt', {}, 'Updated'), h('dd', {}, formatWhen(sop.updatedAt)))),
        h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Versions')), versions),
        changes),
      h('section', { class: 'panel' },
        section('Purpose', textBlock(c.purpose)), section('When to use', textBlock(c.whenToUse)), section('Required inputs', textBlock(c.inputs)),
        section('Steps', listBlock('ol', c.steps)), section('Quality checklist', listBlock('ul', c.checklist)),
        section('Expected output', textBlock(c.expectedOutput)), section('Common mistakes', textBlock(c.commonMistakes)), section('Examples', textBlock(c.examples)))));
}

export async function sopsView(session, { param, rerender }) {
  if (param === 'changes') return changesListView(session, { rerender });
  if (param) return sopPage(session, param, rerender);
  const query = new URLSearchParams();
  if (statusFilter !== 'all') query.set('status', statusFilter);
  if (search) query.set('q', search);
  const list = await api('GET', `/sops?${query}`);
  const chip = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(statusFilter === key), onclick: () => { statusFilter = key; rerender(); } }, label);
  const box = field('Search', { name: 'q', type: 'search', value: search, placeholder: 'Search SOPs' });
  box.input.addEventListener('change', () => { search = box.input.value.trim(); rerender(); });
  const statuses = session.can['sops.manage'] ? STATUSES : ['approved', 'testing', 'deprecated'];
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'SOPs'),
      session.can['sopchanges.view'] && h('a', { class: 'btn', href: '#/sops/changes' }, 'Change requests'),
      session.can['sops.manage'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openNewSop(session, async (made) => goAfterSheets(`#/sops/${made.id}`)).catch((e) => alert(e.message)) }, icon('plus'), 'New SOP')),
    h('div', { class: 'chips' }, statuses.map((s) => chip(s, SOP_STATUS_LABEL[s])), chip('all', 'All')),
    box.el,
    list.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No SOPs here.'))
      : h('section', { class: 'panel list' }, list.map((s) => h('a', { class: 'row', href: `#/sops/${s.id}` },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, s.title), h('div', { class: 'row-sub' }, [s.service, s.ownerName].filter(Boolean).join(' · '))),
        s.requiresQa ? h('span', { class: 'muted nowrap' }, 'QA') : null, h('span', { class: 'muted nowrap' }, `v${s.version}`), sopPill(s.status), icon('chevron')))));
}
