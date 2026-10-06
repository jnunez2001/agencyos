// Joshua Nunez
// Client requests: the list, a request page with its status and Convert to Task, and the add and edit form.
import { h, icon, openSheet, goAfterSheets } from '../dom.js';
import { api } from '../api.js';
import { traceSection } from './trace.js';
import { emptyNote, field, selectField, textareaField, sheetForm, confirmButton, pill, formatDay, PRIORITY_LABEL, priorityPill } from '../ui.js';

export const REQUEST_STATUS_LABEL = { new: 'New', reviewing: 'Reviewing', approved: 'Approved', in_progress: 'In progress', waiting: 'Waiting', completed: 'Completed', rejected: 'Rejected' };
const STAFF_STATUSES = ['new', 'reviewing'];
export const requestPill = (s) => pill('rs', s, REQUEST_STATUS_LABEL[s] || s);
const filters = { show: 'open', clientId: '' };

export async function openRequestForm(session, { request, clientId } = {}, onSaved) {
  const manage = session.can['requests.manage'];
  const [clients, members] = await Promise.all([api('GET', '/clients'), manage ? api('GET', '/members') : []]);
  const usable = clients.filter((c) => c.status !== 'archived' || (request && request.clientId === c.id));
  openSheet(request ? 'Edit request' : 'New client request', (close) => {
    const title = field('Request', { name: 'title', maxlength: 200, required: true, value: request ? request.title : '' });
    const client = selectField('Client', usable.map((c) => [c.id, c.name]), request ? request.clientId : clientId || (usable[0] && usable[0].id), { name: 'clientId' });
    const project = selectField('Project', [['', 'No project']], '', { name: 'projectId' });
    const loadProjects = async () => {
      const list = await api('GET', `/projects?clientId=${client.input.value}`).catch(() => []);
      const keep = request && Number(client.input.value) === request.clientId ? request.projectId : null;
      project.input.replaceChildren(...[['', 'No project'], ...list.map((p) => [p.id, p.name])].map(([v, l]) => h('option', { value: v, selected: String(v) === String(keep || '') }, l)));
    };
    client.input.addEventListener('change', loadProjects);
    loadProjects();
    const by = field('Asked by', { name: 'requestedBy', maxlength: 120, value: request ? request.requestedBy : '' });
    const due = field('Wanted by', { name: 'dueDate', type: 'date', value: request && request.dueDate ? request.dueDate : '' });
    const priority = selectField('Priority', Object.entries(PRIORITY_LABEL), request ? request.priority : 'normal', { name: 'priority' });
    const source = field('Where it came from', { name: 'source', maxlength: 200, placeholder: 'Client call, email', value: request ? request.source : '' });
    const received = field(request ? 'Received on' : 'Received on (blank is today)', { name: 'receivedOn', type: 'date', value: request && request.receivedOn ? request.receivedOn : '' });
    const owner = manage ? selectField('Who handles it', [['', 'Nobody yet'], ...members.filter((m) => m.isActive || (request && request.ownerId === m.id)).map((m) => [m.id, m.displayName])], request && request.ownerId ? request.ownerId : '', { name: 'ownerId' }) : null;
    const statuses = manage ? Object.entries(REQUEST_STATUS_LABEL) : STAFF_STATUSES.map((s) => [s, REQUEST_STATUS_LABEL[s]]);
    const status = selectField('Status', statuses, request ? request.status : 'new', { name: 'status' });
    const description = textareaField('Details', { name: 'description', maxlength: 10000 }, request ? request.description : '');
    return sheetForm([title, h('div', { class: 'two' }, client.el, project.el), h('div', { class: 'two' }, by.el, due.el), h('div', { class: 'two' }, source.el, received.el), priority.el, owner, request && status, description], request ? 'Save' : 'Add request', async () => {
      const body = { title: title.input.value, clientId: Number(client.input.value), projectId: project.input.value === '' ? null : Number(project.input.value), requestedBy: by.input.value, dueDate: due.input.value || null, priority: priority.input.value, source: source.input.value, receivedOn: received.input.value || undefined, description: description.input.value };
      if (owner) body.ownerId = owner.input.value === '' ? null : Number(owner.input.value);
      if (request) body.status = status.input.value;
      const saved = request ? await api('PATCH', `/requests/${request.id}`, body) : await api('POST', '/requests', body);
      await onSaved(saved);
    }, close);
  });
}

async function openConvert(session, request, onDone) {
  const [projects, members] = await Promise.all([api('GET', `/projects?clientId=${request.clientId}`), api('GET', '/members')]);
  const open = projects.filter((p) => p.status !== 'archived');
  if (!open.length) { alert('This client has no project yet. Add a project first, then convert the request.'); return; }
  openSheet('Convert to task', (close) => {
    const project = selectField('Project', open.map((p) => [p.id, p.name]), request.projectId || open[0].id, { name: 'projectId' });
    const title = field('Task title', { name: 'title', maxlength: 200, required: true, value: request.title });
    const assignee = selectField('Assign to', [['', 'Nobody'], ...members.filter((m) => m.isActive).map((m) => [m.id, m.displayName])], request.ownerId || '', { name: 'assigneeId' });
    const due = field('Due date', { name: 'dueDate', type: 'date', value: request.dueDate || '' });
    const priority = selectField('Priority', [['normal', 'Normal'], ['low', 'Low'], ['high', 'High'], ['urgent', 'Urgent']], 'normal', { name: 'priority' });
    return sheetForm([project, title, h('div', { class: 'two' }, assignee.el, priority.el), due], 'Create task', async () => {
      await api('POST', `/requests/${request.id}/convert`, { projectId: Number(project.input.value), title: title.input.value, assigneeId: assignee.input.value === '' ? null : Number(assignee.input.value), dueDate: due.input.value || null, priority: priority.input.value });
      await onDone();
    }, close);
  });
}

async function requestPage(session, id, rerender) {
  const r = await api('GET', `/requests/${id}`);
  // The chain behind a request: its meeting note, and once converted the whole trace of its task.
  const trace = r.taskId ? await api('GET', `/tasks/${r.taskId}/trace`).catch(() => null) : null;
  const where = trace || (r.sourceNoteId ? { meetingNote: { id: r.sourceNoteId, title: r.sourceNoteTitle || 'Meeting notes', date: null, hash: `#/meetings/${r.sourceNoteId}` } } : {});
  const act = (fn) => async () => { try { await fn(); await rerender(); } catch (e) { alert(e.message); } };
  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Client'), h('dd', {}, session.can['clients.view'] ? h('a', { class: 'link', href: `#/clients/${r.clientId}` }, r.clientName) : r.clientName),
    r.projectName && h('dt', {}, 'Project'), r.projectName && h('dd', {}, h('a', { class: 'link', href: `#/projects/${r.projectId}` }, r.projectName)),
    r.requestedBy && h('dt', {}, 'Asked by'), r.requestedBy && h('dd', {}, r.requestedBy),
    r.source && h('dt', {}, 'Came from'), r.source && h('dd', {}, r.source),
    r.receivedOn && h('dt', {}, 'Received'), r.receivedOn && h('dd', {}, formatDay(r.receivedOn)),
    r.dueDate && h('dt', {}, 'Wanted by'), r.dueDate && h('dd', {}, formatDay(r.dueDate)),
    h('dt', {}, 'Handled by'), h('dd', {}, r.ownerName || 'Nobody yet'),
    r.sourceNoteId && h('dt', {}, 'From meeting'), r.sourceNoteId && h('dd', {}, h('a', { class: 'link', href: `#/meetings/${r.sourceNoteId}` }, r.sourceNoteTitle || 'Meeting notes')),
    r.taskId && h('dt', {}, 'Task'), r.taskId && h('dd', {}, h('a', { class: 'link', href: `#/projects/${r.projectId}` }, `${r.taskTitle} (${r.taskStatus === 'done' ? 'done' : 'open'})`)),
    h('dt', {}, 'Added by'), h('dd', {}, r.createdByName || 'Unknown'));
  const statusSelect = r.canManage ? selectField('Status', Object.entries(REQUEST_STATUS_LABEL), r.status, { name: 'status' }) : null;
  if (statusSelect) statusSelect.input.addEventListener('change', act(() => api('PATCH', `/requests/${r.id}`, { status: statusSelect.input.value })));
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/requests' }, icon('back'), 'Requests'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, r.title), h('div', { class: 'head-meta' }, requestPill(r.status), priorityPill(r.priority))),
      h('div', { class: 'head-actions' },
        r.canEdit && h('button', { class: 'btn', type: 'button', onclick: () => openRequestForm(session, { request: r }, rerender).catch((e) => alert(e.message)) }, 'Edit'),
        r.canConvert && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openConvert(session, r, rerender).catch((e) => alert(e.message)) }, 'Convert to task'),
        r.canManage && confirmButton('Delete', 'Confirm delete', async () => { try { await api('DELETE', `/requests/${r.id}`); goAfterSheets('#/requests'); } catch (e) { alert(e.message); } }))),
    h('section', { class: 'panel' }, r.description && h('p', { class: 'prose' }, r.description), facts, statusSelect && statusSelect.el, traceSection(session, { ...where, request: null })));
}

export async function requestsView(session, { param, rerender }) {
  if (param) return requestPage(session, param, rerender);
  const clients = await api('GET', '/clients');
  const query = new URLSearchParams();
  if (filters.show === 'open') query.set('open', '1');
  if (filters.clientId) query.set('clientId', filters.clientId);
  const list = await api('GET', `/requests${query.size ? `?${query}` : ''}`);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, [['open', 'Open'], ['all', 'All']].map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filters.show === v), onclick: () => { filters.show = v; rerender(); } }, l)));
  const pick = h('select', { class: 'input', 'aria-label': 'Client', onchange: (e) => { filters.clientId = e.target.value; rerender(); } }, [h('option', { value: '' }, 'All clients'), ...clients.map((c) => h('option', { value: c.id, selected: String(c.id) === String(filters.clientId) }, c.name))]);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Client requests')),
      session.can['requests.create'] && h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openRequestForm(session, {}, (r) => goAfterSheets(`#/requests/${r.id}`)).catch((e) => alert(e.message)) }, icon('plus'), 'New request'))),
    chips, h('div', { class: 'filters' }, pick),
    h('section', { class: 'panel list' }, list.length ? list.map((r) => h('a', { class: 'row', href: `#/requests/${r.id}` },
      h('div', { class: 'grow' }, h('div', { class: 'row-title' }, r.title), h('div', { class: 'row-sub' }, [r.clientName, r.requestedBy && `asked by ${r.requestedBy}`, r.taskId && 'has a task'].filter(Boolean).join(', '))),
      r.priority !== 'normal' && priorityPill(r.priority), requestPill(r.status), icon('chevron'))) : emptyNote(!!filters.clientId, `${filters.show === 'open' ? 'No open requests.' : 'No requests yet.'} ${session.can['requests.create'] ? 'Add one here, or write them in a meeting note and choose Create records.' : 'They come from meeting notes.'}`, { pad: true })));
}
