// Joshua Nunez
// Projects: the list, a project page with its tasks, and the add and edit form.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, pill, formatDay, PROJECT_STATUS_LABEL } from '../ui.js';
import { taskRow, openTaskForm } from './tasks.js';

const STATUSES = Object.keys(PROJECT_STATUS_LABEL);
export const projectPill = (s) => pill('ps', s, PROJECT_STATUS_LABEL[s] || s);
let statusFilter = 'open';

export async function openProjectForm(session, { project, clientId } = {}, onChanged) {
  const [clients, members] = await Promise.all([api('GET', '/clients'), api('GET', '/members')]);
  const usable = clients.filter((c) => c.status !== 'archived' || (project && project.clientId === c.id));
  openSheet(project ? 'Edit project' : 'New project', (close) => {
    const name = field('Name', { name: 'name', maxlength: 120, required: true, value: project ? project.name : '' });
    const client = selectField('Client', usable.map((c) => [c.id, c.name]), project ? project.clientId : clientId || (usable[0] && usable[0].id), { name: 'clientId' });
    const status = selectField('Status', Object.entries(PROJECT_STATUS_LABEL), project ? project.status : 'planning', { name: 'status' });
    const manager = selectField('Manager', [['', 'Nobody'], ...members.filter((m) => m.isActive || (project && project.managerId === m.id)).map((m) => [m.id, m.displayName])], project && project.managerId ? project.managerId : '', { name: 'managerId' });
    const start = field('Start date', { name: 'startDate', type: 'date', value: project && project.startDate ? project.startDate : '' });
    const due = field('Due date', { name: 'dueDate', type: 'date', value: project && project.dueDate ? project.dueDate : '' });
    const description = textareaField('Description', { name: 'description', maxlength: 5000 }, project ? project.description : '');
    return sheetForm([name, client, h('div', { class: 'two' }, status.el, manager.el), h('div', { class: 'two' }, start.el, due.el), description], project ? 'Save' : 'Add project', async () => {
      const body = { name: name.input.value, clientId: Number(client.input.value), status: status.input.value, managerId: manager.input.value === '' ? null : Number(manager.input.value), startDate: start.input.value || null, dueDate: due.input.value || null, description: description.input.value };
      if (project) await api('PATCH', `/projects/${project.id}`, body); else await api('POST', '/projects', body);
      await onChanged();
    }, close);
  });
}

async function projectPage(session, id, rerender) {
  const [project, tasks] = await Promise.all([api('GET', `/projects/${id}`), api('GET', `/tasks?projectId=${id}`)]);
  const manage = session.can['projects.manage'];
  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Client'), h('dd', {}, session.can['clients.view'] ? h('a', { class: 'link', href: `#/clients/${project.clientId}` }, project.clientName) : project.clientName),
    h('dt', {}, 'Manager'), h('dd', {}, project.managerName || 'Nobody'),
    h('dt', {}, 'Start'), h('dd', {}, project.startDate ? formatDay(project.startDate) : 'No date'),
    h('dt', {}, 'Due'), h('dd', {}, project.dueDate ? formatDay(project.dueDate) : 'No date'),
    h('dt', {}, 'Tasks'), h('dd', {}, `${project.openTasks} open, ${project.doneTasks} done`));
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/projects' }, icon('back'), 'Projects'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, project.name), h('div', { class: 'head-meta' }, projectPill(project.status))),
      manage && h('div', { class: 'head-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => openProjectForm(session, { project }, rerender).catch((e) => alert(e.message)) }, 'Edit'),
        session.can['tasks.manage'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openTaskForm(session, { projectId: project.id }, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'New task'))),
    h('div', { class: 'split' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Details')), project.description && h('p', { class: 'prose' }, project.description), facts),
      h('section', { class: 'panel list' }, tasks.length ? tasks.map((t) => taskRow(session, t, rerender, { showProject: false })) : h('p', { class: 'muted pad' }, 'No tasks yet.'))));
}

export async function projectsView(session, { param, rerender }) {
  if (param) return projectPage(session, param, rerender);
  const list = await api('GET', '/projects');
  const shown = list.filter((p) => (statusFilter === 'open' ? !['completed', 'archived'].includes(p.status) : statusFilter === 'all' ? true : p.status === statusFilter));
  const chip = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(statusFilter === key), onclick: () => { statusFilter = key; rerender(); } }, label);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Projects'),
      session.can['projects.manage'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openProjectForm(session, {}, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'New project')),
    h('div', { class: 'chips' }, chip('open', 'Open'), chip('completed', 'Completed'), chip('archived', 'Archived'), chip('all', 'All')),
    shown.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No projects here.'))
      : h('section', { class: 'panel list' }, shown.map((p) => h('a', { class: 'row', href: `#/projects/${p.id}` },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, p.name), h('div', { class: 'row-sub' }, [p.clientName, p.managerName].filter(Boolean).join(' · '))),
        p.dueDate && h('span', { class: 'muted nowrap' }, `Due ${formatDay(p.dueDate)}`),
        h('span', { class: 'muted nowrap' }, `${p.openTasks} open`),
        projectPill(p.status), icon('chevron')))));
}
