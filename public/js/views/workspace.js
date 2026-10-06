// Joshua Nunez
// The role panels on the dashboard: My Day for everyone, "Needs a manager" for managers, and the owner overview.
import { h } from '../dom.js';
import { api } from '../api.js';
import { formatDay } from '../ui.js';
import { EVENT_TYPE_LABEL } from './calendar.js';

const timeOf = (e) => (e.allDay ? 'All day' : new Date(e.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
const figure = (value, label, warn) => h('div', { class: `figure${warn && value > 0 ? ' warn' : ''}` }, h('span', { class: 'figure-value' }, String(value)), h('span', { class: 'figure-label' }, label));
const item = (href, title, sub, flag) => h('a', { class: 'row', href }, h('div', { class: 'grow' }, h('div', { class: 'row-title' }, title), sub && h('div', { class: `row-sub${flag ? ' overdue' : ''}` }, sub)));

export async function workspacePanels(session) {
  let w;
  try { w = await api('GET', '/workspace'); } catch { return {}; }
  const d = w.myDay;
  const nothing = !d.events.length && !d.tasks.length && !d.followUps.length && !d.requests.length;
  const myDay = h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Today'), h('a', { class: 'link', href: '#/calendar' }, 'Calendar')),
    nothing ? h('p', { class: 'muted' }, 'Nothing is due today. Enjoy the quiet.') : h('div', { class: 'list-inner' },
      d.events.map((e) => item('#/calendar', e.title, `${timeOf(e)}, ${EVENT_TYPE_LABEL[e.type] || e.type}`)),
      d.tasks.map((t) => item(session.can['projects.view'] ? `#/projects/${t.projectId}` : '#/tasks', t.title, `${t.isOverdue ? 'Overdue, ' : 'Due today, '}${t.dueDate === w.today ? 'today' : formatDay(t.dueDate)}${t.projectName ? `, ${t.projectName}` : ''}`, t.isOverdue)),
      d.followUps.map((f) => item('#/meetings/follow-ups', f.title, `Follow-up, ${f.isOverdue ? `overdue ${formatDay(f.dueDate)}` : 'due today'}`, f.isOverdue)),
      d.requests.map((r) => item(`#/requests/${r.id}`, r.title, `Client request, ${r.clientName}`))));
  const m = w.manager;
  const manager = m && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Needs a manager')),
    h('div', { class: 'figures' }, figure(m.requestsToReview, 'Requests to review', true), figure(m.overdueFollowUps, 'Overdue follow-ups', true), figure(m.unassignedTasks, 'Unassigned tasks', true)),
    m.meetingsWithoutNotes.length > 0 && h('div', { class: 'list-inner' }, h('p', { class: 'muted' }, 'Meetings with no notes yet'),
      m.meetingsWithoutNotes.map((e) => item('#/calendar', e.title, formatDay(e.date)))));
  const o = w.owner;
  const owner = o && h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Owner overview')),
    h('div', { class: 'figures' }, figure(o.clientsAtRisk.length, 'Clients at risk', true), figure(o.overdueTasks, 'Overdue tasks', true), figure(o.openRequests, 'Open requests')),
    o.approvals && h('div', { class: 'figures' }, figure(o.approvals.timeToApprove, 'Time to approve', true), figure(o.approvals.qaWaiting, 'In QA', true), figure(o.approvals.sopChangesToReview, 'SOP changes to review', true)),
    o.happening && h('div', { class: 'figures' }, figure(o.happening.activeClients, 'Active clients'), figure(o.happening.activeProjects, 'Active projects'), figure(o.happening.workInProgress, 'Work in progress')),
    o.improve && (o.improve.overCapacity.length > 0 || o.improve.tasksNeedingChanges > 0) && h('div', { class: 'list-inner' }, h('p', { class: 'muted' }, 'Needs improvement'),
      o.improve.tasksNeedingChanges > 0 && item('#/qa', `${o.improve.tasksNeedingChanges} ${o.improve.tasksNeedingChanges === 1 ? 'task needs' : 'tasks need'} changes after QA`, null),
      o.improve.overCapacity.map((p) => item('#/time', `${p.displayName} is over capacity`, `${p.utilizationPercent}% of the week`, true))),
    o.happening && o.happening.recentResults.length > 0 && h('div', { class: 'list-inner' }, h('p', { class: 'muted' }, 'Recent results'),
      o.happening.recentResults.map((r) => item(`#/clients/${r.clientId}`, `${r.clientName}: ${r.metric} ${r.value}${r.unit ? ` ${r.unit}` : ''}`, formatDay(r.recordedOn)))),
    o.clientsAtRisk.length > 0 && h('div', { class: 'list-inner' }, o.clientsAtRisk.map((c) => item(`#/clients/${c.id}`, c.name, 'At risk', true))),
    o.upcomingClientMeetings.length > 0 && h('div', { class: 'list-inner' }, h('p', { class: 'muted' }, 'Client meetings this week'),
      o.upcomingClientMeetings.map((e) => item('#/calendar', e.title, `${formatDay(e.startsAt.slice(0, 10))}${e.clientName ? `, ${e.clientName}` : ''}`))));
  return { myDay, manager, owner };
}
