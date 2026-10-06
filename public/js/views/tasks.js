// Joshua Nunez
// Tasks: the list and board, the task sheet with comments, and the add and edit form.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { avatar, field, selectField, textareaField, sheetForm, confirmButton, statusPill, priorityPill, dueLabel, formatDay, formatWhen, STATUS_LABEL, PRIORITY_LABEL } from '../ui.js';

const STATUSES = Object.keys(STATUS_LABEL);
let view = 'list';
let filter = { mine: false, projectId: '', assigneeId: '', status: '', overdue: false, q: '' };

function queryOf(session) {
  const q = new URLSearchParams();
  if (filter.mine) q.set('mine', '1');
  if (filter.overdue) q.set('overdue', '1');
  for (const k of ['projectId', 'assigneeId', 'status', 'q']) if (filter[k]) q.set(k, filter[k]);
  return q.toString();
}

// ---- the task sheet ----

async function loadComments(box, taskId) {
  const list = await api('GET', `/tasks/${taskId}/comments`);
  box.replaceChildren(...list.map((c) => h('div', { class: 'comment' },
    h('div', { class: 'comment-head' }, h('strong', {}, c.authorName), h('span', { class: 'muted' }, formatWhen(c.createdAt))),
    h('p', {}, c.body))));
}

export async function openTask(session, taskId, onChanged) {
  const task = await api('GET', `/tasks/${taskId}`);
  openSheet(task.title, (close) => {
    const facts = h('dl', { class: 'facts' },
      h('dt', {}, 'Project'), h('dd', {}, `${task.projectName}, ${task.clientName}`),
      h('dt', {}, 'Assigned to'), h('dd', {}, task.assigneeName || 'Nobody'),
      h('dt', {}, 'Due'), h('dd', {}, task.dueDate ? h('span', { class: task.isOverdue ? 'due overdue' : '' }, `${formatDay(task.dueDate)}${task.isOverdue ? ' (overdue)' : ''}`) : 'No date'),
      h('dt', {}, 'Priority'), h('dd', {}, priorityPill(task.priority)),
      h('dt', {}, 'Estimate'), h('dd', {}, task.estimateHours == null ? 'None' : `${task.estimateHours} hours`));
    const error = h('div', { class: 'error', role: 'alert' });
    const status = selectField('Status', STATUSES.map((s) => [s, STATUS_LABEL[s]]), task.status, { name: 'status', disabled: !task.canChangeStatus });
    status.input.addEventListener('change', async () => {
      error.textContent = '';
      try { await api('PATCH', `/tasks/${task.id}`, { status: status.input.value }); await onChanged(); } catch (err) { error.textContent = err.message; status.input.value = task.status; }
    });
    const comments = h('div', { class: 'comments' });
    const body = textareaField('Add a comment', { name: 'body', rows: 3, maxlength: 5000 });
    const cError = h('div', { class: 'error', role: 'alert' });
    const post = h('button', { class: 'btn', type: 'submit' }, 'Comment');
    const form = h('form', { class: 'sheet-body', onsubmit: async (e) => {
      e.preventDefault();
      cError.textContent = '';
      post.disabled = true;
      try { await api('POST', `/tasks/${task.id}/comments`, { body: body.input.value }); body.input.value = ''; await loadComments(comments, task.id); } catch (err) { cError.textContent = err.message; }
      post.disabled = false;
    } }, body.el, cError, h('div', { class: 'sheet-actions' }, post));
    loadComments(comments, task.id).catch((err) => { cError.textContent = err.message; });
    return h('div', { class: 'sheet-body' },
      h('div', { class: 'row-between' }, statusPill(task.status), task.canEdit && h('button', { class: 'btn', type: 'button', onclick: () => { close(); openTaskForm(session, { task }, onChanged).catch((e) => alert(e.message)); } }, 'Edit')),
      task.description && h('p', { class: 'prose' }, task.description),
      facts, status.el, error,
      h('h3', { class: 'section-title' }, 'Comments'), comments, form);
  });
}

// ---- the add and edit form ----

export async function openTaskForm(session, { task, projectId } = {}, onChanged) {
  const [projects, members] = await Promise.all([api('GET', '/projects'), api('GET', '/members')]);
  const usable = projects.filter((p) => p.status !== 'archived' || (task && task.projectId === p.id));
  openSheet(task ? 'Edit task' : 'New task', (close) => {
    const title = field('Title', { name: 'title', maxlength: 200, required: true, value: task ? task.title : '' });
    const project = selectField('Project', usable.map((p) => [p.id, `${p.name}, ${p.clientName}`]), task ? task.projectId : projectId || (usable[0] && usable[0].id), { name: 'projectId' });
    const people = members.filter((m) => m.isActive || (task && task.assigneeId === m.id));
    const assignee = selectField('Assigned to', [['', 'Nobody'], ...people.map((m) => [m.id, m.displayName])], task && task.assigneeId ? task.assigneeId : '', { name: 'assigneeId' });
    const status = selectField('Status', STATUSES.map((s) => [s, STATUS_LABEL[s]]), task ? task.status : 'todo', { name: 'status' });
    const priority = selectField('Priority', Object.entries(PRIORITY_LABEL), task ? task.priority : 'normal', { name: 'priority' });
    const due = field('Due date', { name: 'dueDate', type: 'date', value: task && task.dueDate ? task.dueDate : '' });
    const estimate = field('Estimate (hours)', { name: 'estimateHours', type: 'number', min: 0, max: 1000, step: '0.25', value: task && task.estimateHours != null ? task.estimateHours : '' });
    const description = textareaField('Description', { name: 'description', maxlength: 10000 }, task ? task.description : '');
    const payload = () => ({
      title: title.input.value, projectId: Number(project.input.value), assigneeId: assignee.input.value === '' ? null : Number(assignee.input.value),
      status: status.input.value, priority: priority.input.value, dueDate: due.input.value || null,
      estimateHours: estimate.input.value === '' ? null : Number(estimate.input.value), description: description.input.value,
    });
    const del = task ? confirmButton('Delete task', 'Click again to delete', async () => { await api('DELETE', `/tasks/${task.id}`); close(); await onChanged(); }) : null;
    return sheetForm([title, project, h('div', { class: 'two' }, assignee.el, priority.el), h('div', { class: 'two' }, status.el, due.el), estimate, description],
      task ? 'Save' : 'Add task', async () => {
        if (task) await api('PATCH', `/tasks/${task.id}`, payload()); else await api('POST', '/tasks', payload());
        await onChanged();
      }, close, del);
  });
}

// ---- rows and board ----

export function taskRow(session, t, onChanged, { showProject = true } = {}) {
  return h('button', { class: 'row task-row', type: 'button', onclick: () => openTask(session, t.id, onChanged).catch((e) => alert(e.message)) },
    h('span', { class: `dot pr-dot-${t.priority}`, title: PRIORITY_LABEL[t.priority] }),
    h('div', { class: 'grow' },
      h('div', { class: 'row-title' }, t.title),
      h('div', { class: 'row-sub' }, [showProject ? `${t.projectName}, ${t.clientName}` : null, t.assigneeName].filter(Boolean).join(' · '))),
    dueLabel(t), statusPill(t.status),
    t.assigneeName ? avatar({ id: t.assigneeId, displayName: t.assigneeName }, 'sm') : null);
}

function boardView(session, list, onChanged) {
  return h('div', { class: 'board' }, STATUSES.map((s) => {
    const items = list.filter((t) => t.status === s);
    return h('section', { class: 'column' },
      h('div', { class: 'column-head' }, h('strong', {}, STATUS_LABEL[s]), h('span', { class: 'muted' }, String(items.length))),
      h('div', { class: 'cards' }, items.map((t) => h('button', { class: 'card', type: 'button', onclick: () => openTask(session, t.id, onChanged).catch((e) => alert(e.message)) },
        h('div', { class: 'row-title' }, t.title),
        h('div', { class: 'row-sub' }, t.projectName),
        h('div', { class: 'card-foot' }, priorityPill(t.priority), dueLabel(t), t.assigneeName ? avatar({ id: t.assigneeId, displayName: t.assigneeName }, 'sm') : null)))));
  }));
}

export async function tasksView(session, { rerender }) {
  const canFilterMore = session.can['projects.view'];
  const [list, projects, members] = await Promise.all([
    api('GET', `/tasks?${queryOf(session)}`),
    canFilterMore ? api('GET', '/projects') : [],
    session.can['members.list'] ? api('GET', '/members') : [],
  ]);
  const chip = (label, key) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter[key]), onclick: () => { filter[key] = !filter[key]; rerender(); } }, label);
  const sel = (label, key, options) => {
    const f = selectField(label, [['', `All`], ...options], filter[key], { 'aria-label': label });
    f.input.addEventListener('change', () => { filter[key] = f.input.value; rerender(); });
    return f.el;
  };
  const search = field('Search', { name: 'q', type: 'search', value: filter.q, placeholder: 'Search tasks' });
  search.input.addEventListener('change', () => { filter.q = search.input.value.trim(); rerender(); });
  const toggle = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(view === key), onclick: () => { view = key; rerender(); } }, label);
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'chips' }, session.can['clients.view'] ? chip('My tasks', 'mine') : null, chip('Overdue', 'overdue'), toggle('list', 'List'), toggle('board', 'Board')),
    h('div', { class: 'filters filters-4' }, search.el,
      canFilterMore ? sel('Project', 'projectId', projects.map((p) => [p.id, p.name])) : null,
      members.length ? sel('Person', 'assigneeId', members.map((m) => [m.id, m.displayName])) : null,
      sel('Status', 'status', STATUSES.map((s) => [s, STATUS_LABEL[s]]))));
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Tasks'),
      session.can['tasks.manage'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openTaskForm(session, {}, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'New task')),
    toolbar,
    list.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No tasks match.'))
      : view === 'board' ? boardView(session, list, rerender)
        : h('section', { class: 'panel list' }, list.map((t) => taskRow(session, t, rerender))));
}
