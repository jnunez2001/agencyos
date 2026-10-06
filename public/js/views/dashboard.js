// Joshua Nunez
import { h } from '../dom.js';
import { api } from '../api.js';
import { greeting, ROLE_LABEL } from '../ui.js';
import { taskRow } from './tasks.js';
import { workspacePanels } from './workspace.js';

const figure = (value, label, warn) => h('div', { class: `figure${warn && value > 0 ? ' warn' : ''}` }, h('span', { class: 'figure-value' }, String(value)), h('span', { class: 'figure-label' }, label));

function loadBar(w) {
  const pct = w.capacityHours > 0 ? Math.min(100, Math.round((w.openHours / w.capacityHours) * 100)) : 0;
  const fill = h('span', { class: `bar-fill${w.openHours > w.capacityHours ? ' over' : ''}` });
  fill.style.width = `${pct}%`; // set from script, so the page's style rules stay strict
  return h('div', { class: 'load-row' },
    h('div', { class: 'load-name' }, h('span', {}, w.displayName), h('span', { class: 'muted' }, `${w.openTasks} ${w.openTasks === 1 ? 'task' : 'tasks'}${w.overdue ? `, ${w.overdue} overdue` : ''}`)),
    h('div', { class: 'bar' }, fill),
    h('span', { class: 'muted nowrap load-hours' }, `${w.openHours} of ${w.capacityHours} h`));
}

export async function dashboardView(session, { rerender }) {
  const [d, ws] = await Promise.all([api('GET', '/dashboard'), workspacePanels(session)]);
  const t = d.team;
  const mine = h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'My work'), h('a', { class: 'link', href: '#/tasks' }, 'All tasks')),
    h('div', { class: 'figures three' }, figure(d.work.open, 'Open'), figure(d.work.overdue, 'Overdue', true), figure(d.work.dueSoon, 'Due this week')),
    d.work.items.length
      ? h('div', { class: 'list-inner' }, d.work.items.map((x) => taskRow(session, x, rerender)))
      : h('p', { class: 'muted' }, 'Nothing is assigned to you.'));
  const agency = d.agency && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Agency')),
    h('div', { class: 'figures' }, figure(d.agency.activeClients, 'Active clients'), figure(d.agency.activeProjects, 'Active projects'), figure(d.agency.openTasks, 'Open tasks'), figure(d.agency.overdueTasks, 'Overdue tasks', true)));
  const workload = d.workload && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Workload')),
    h('div', { class: 'loads' }, d.workload.map(loadBar)));
  const team = t && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Team'), h('a', { class: 'link', href: '#/team' }, 'View team')),
    h('div', { class: 'figures' }, figure(t.active, 'Active members'), figure(t.mustChangePassword, 'Not signed in yet')),
    h('ul', { class: 'roles' }, Object.entries(t.byRole).filter(([, n]) => n > 0).map(([role, n]) => h('li', {}, h('span', {}, ROLE_LABEL[role]), h('strong', {}, String(n))))));
  const inbox = d.aiPending > 0 && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'AI inbox'), h('a', { class: 'link', href: '#/ai' }, 'Review')),
    h('p', {}, `${d.aiPending} ${d.aiPending === 1 ? 'plan is' : 'plans are'} waiting for your approval.`));
  const qa = d.qaWaiting > 0 && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'QA'), h('a', { class: 'link', href: '#/qa' }, 'Review')),
    h('p', {}, `${d.qaWaiting} ${d.qaWaiting === 1 ? 'task is' : 'tasks are'} waiting for review.`));
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, d.organization.name), h('h1', { class: 'page-title' }, greeting(d.organization.timezone, d.me.displayName)))),
    h('div', { class: 'dash' }, h('div', { class: 'stack' }, ws.myDay, qa, inbox, mine, workload), h('div', { class: 'stack' }, ws.owner, ws.manager, agency, team)));
}
