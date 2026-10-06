// Joshua Nunez
// The Decisions and Follow-ups tabs of the Meetings screen, and the tab bar they share with the notes list.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, confirmButton, pill, formatDay, PRIORITY_LABEL } from '../ui.js';

const DECISION_STATUS = { active: 'Active', reversed: 'Reversed' };
const FOLLOWUP_STATUS = { open: 'Open', done: 'Done', cancelled: 'Cancelled' };

export function tabBar(session, active) {
  const tabs = [['notes', 'Notes', '#/meetings'], ...(session.can['decisions.view'] ? [['decisions', 'Decisions', '#/meetings/decisions']] : []), ['follow-ups', 'Follow-ups', '#/meetings/follow-ups']];
  return h('div', { class: 'tabs', role: 'group', 'aria-label': 'Meeting records' }, tabs.map(([key, label, href]) => h('a', { class: 'chip', href, 'aria-pressed': String(active === key), 'aria-current': active === key ? 'page' : null }, label)));
}

async function clientAndProject(selected) {
  const clients = await api('GET', '/clients').catch(() => []);
  const client = selectField('Client', [['', 'No client'], ...clients.map((c) => [c.id, c.name])], selected.clientId || '', { name: 'clientId' });
  const project = selectField('Project', [['', 'No project']], '', { name: 'projectId' });
  const load = async () => {
    const list = client.input.value ? await api('GET', `/projects?clientId=${client.input.value}`).catch(() => []) : [];
    const keep = Number(client.input.value) === selected.clientId ? selected.projectId : null;
    project.input.replaceChildren(...[['', 'No project'], ...list.map((p) => [p.id, p.name])].map(([v, l]) => h('option', { value: v, selected: String(v) === String(keep || '') }, l)));
  };
  client.input.addEventListener('change', load);
  await load();
  const ids = () => ({ clientId: client.input.value === '' ? null : Number(client.input.value), projectId: project.input.value === '' ? null : Number(project.input.value) });
  return { row: h('div', { class: 'two' }, client.el, project.el), ids };
}

// ---- decisions ----
export async function openDecisionForm(session, { decision } = {}, onSaved) {
  const links = await clientAndProject(decision || {});
  openSheet(decision ? 'Edit decision' : 'New decision', (close) => {
    const title = field('Decision', { name: 'title', maxlength: 200, required: true, value: decision ? decision.title : '' });
    const date = field('Decided on', { name: 'decidedOn', type: 'date', required: true, value: decision ? decision.decidedOn : new Date().toISOString().slice(0, 10) });
    const status = decision ? selectField('Status', Object.entries(DECISION_STATUS), decision.status, { name: 'status' }) : null;
    const people = field('People involved', { name: 'peopleInvolved', maxlength: 500, value: decision ? decision.peopleInvolved : '' });
    const details = textareaField('Why, and the details', { name: 'details', maxlength: 10000 }, decision ? decision.details : '');
    return sheetForm([title, date, links.row, people, status, details], decision ? 'Save' : 'Add decision', async () => {
      const body = { title: title.input.value, decidedOn: date.input.value, details: details.input.value, peopleInvolved: people.input.value, ...links.ids() };
      if (status) body.status = status.input.value;
      await (decision ? api('PATCH', `/decisions/${decision.id}`, body) : api('POST', '/decisions', body));
      await onSaved();
    }, close);
  });
}

export async function decisionsPage(session, rerender, state) {
  const list = await api('GET', `/decisions${state.status ? `?status=${state.status}` : ''}`);
  const manage = session.can['decisions.manage'];
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Status' }, [['', 'All'], ['active', 'Active'], ['reversed', 'Reversed']].map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.status === v), onclick: () => { state.status = v; rerender(); } }, l)));
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Meetings')),
      manage && h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openDecisionForm(session, {}, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'New decision'))),
    tabBar(session, 'decisions'), chips,
    h('section', { class: 'panel list' }, list.length ? list.map((d) => h('div', { class: 'row static' },
      h('div', { class: 'grow' }, h('div', { class: 'row-title' }, d.title), h('div', { class: 'row-sub' }, [formatDay(d.decidedOn), d.clientName, d.projectName, d.peopleInvolved && `with ${d.peopleInvolved}`].filter(Boolean).join(', ')),
        d.details && h('p', { class: 'prose' }, d.details),
        d.sourceNoteId && h('a', { class: 'link', href: `#/meetings/${d.sourceNoteId}` }, `From ${d.sourceNoteTitle || 'meeting notes'}`)),
      pill('ds', d.status, DECISION_STATUS[d.status]),
      d.canEdit && h('button', { class: 'btn', type: 'button', onclick: () => openDecisionForm(session, { decision: d }, rerender).catch((e) => alert(e.message)) }, 'Edit'),
      d.canEdit && confirmButton('Delete', 'Confirm', async () => { try { await api('DELETE', `/decisions/${d.id}`); await rerender(); } catch (e) { alert(e.message); } }))) : h('p', { class: 'muted pad' }, 'No decisions yet. Write them in meeting notes and choose Create records.')));
}

// ---- follow-ups ----
export async function openFollowUpForm(session, { followUp } = {}, onSaved) {
  const [members, links] = await Promise.all([api('GET', '/members'), clientAndProject(followUp || {})]);
  openSheet(followUp ? 'Edit follow-up' : 'New follow-up', (close) => {
    const title = field('Follow-up', { name: 'title', maxlength: 200, required: true, value: followUp ? followUp.title : '' });
    const due = field('Due date', { name: 'dueDate', type: 'date', value: followUp && followUp.dueDate ? followUp.dueDate : '' });
    const who = selectField('Assigned to', [['', 'Nobody'], ...members.filter((m) => m.isActive || (followUp && followUp.assigneeId === m.id)).map((m) => [m.id, m.displayName])], followUp && followUp.assigneeId ? followUp.assigneeId : session.user.id, { name: 'assigneeId' });
    const priority = selectField('Priority', Object.entries(PRIORITY_LABEL), followUp ? followUp.priority : 'normal', { name: 'priority' });
    const status = followUp ? selectField('Status', Object.entries(FOLLOWUP_STATUS), followUp.status, { name: 'status' }) : null;
    const details = textareaField('Details', { name: 'details', maxlength: 10000 }, followUp ? followUp.details : '');
    return sheetForm([title, h('div', { class: 'two' }, who.el, due.el), h('div', { class: 'two' }, priority.el, status ? status.el : h('div')), links.row, details], followUp ? 'Save' : 'Add follow-up', async () => {
      const body = { title: title.input.value, dueDate: due.input.value || null, assigneeId: who.input.value === '' ? null : Number(who.input.value), priority: priority.input.value, details: details.input.value, ...links.ids() };
      if (status) body.status = status.input.value;
      await (followUp ? api('PATCH', `/follow-ups/${followUp.id}`, body) : api('POST', '/follow-ups', body));
      await onSaved();
    }, close);
  });
}

export async function followUpsPage(session, rerender, state) {
  const query = new URLSearchParams();
  if (state.show === 'open') query.set('status', 'open');
  if (state.show === 'mine') { query.set('status', 'open'); query.set('mine', '1'); }
  const list = await api('GET', `/follow-ups${query.size ? `?${query}` : ''}`);
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, [['open', 'Open'], ['mine', 'Mine'], ['all', 'All']].map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.show === v), onclick: () => { state.show = v; rerender(); } }, l)));
  const toggle = (f) => async () => { try { await api('PATCH', `/follow-ups/${f.id}`, { status: f.status === 'done' ? 'open' : 'done' }); await rerender(); } catch (e) { alert(e.message); } };
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Meetings')),
      session.can['followups.create'] && h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openFollowUpForm(session, {}, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'New follow-up'))),
    tabBar(session, 'follow-ups'), chips,
    h('section', { class: 'panel list' }, list.length ? list.map((f) => h('div', { class: 'row static' },
      f.canEdit && h('input', { type: 'checkbox', checked: f.status === 'done', 'aria-label': `Mark ${f.title} done`, onchange: toggle(f) }),
      h('div', { class: 'grow' }, h('div', { class: 'row-title' }, f.title), h('div', { class: 'row-sub' }, [f.assigneeName, f.dueDate && `${f.isOverdue ? 'Overdue, ' : 'Due '}${formatDay(f.dueDate)}`, f.clientName].filter(Boolean).join(', ')),
        f.requestId && f.requestTitle && h('a', { class: 'link', href: `#/requests/${f.requestId}` }, `Request: ${f.requestTitle}`),
        f.taskId && f.taskTitle && h('a', { class: 'link', href: `#/tasks/${f.taskId}` }, `Task: ${f.taskTitle}`),
        f.sourceNoteId && session.can['notes.view'] && h('a', { class: 'link', href: `#/meetings/${f.sourceNoteId}` }, `From ${f.sourceNoteTitle || 'meeting notes'}`)),
      f.priority && f.priority !== 'normal' && pill('pr', f.priority, PRIORITY_LABEL[f.priority]),
      f.status !== 'open' && pill('fs', f.status, FOLLOWUP_STATUS[f.status]),
      f.canEdit && h('button', { class: 'btn', type: 'button', onclick: () => openFollowUpForm(session, { followUp: f }, rerender).catch((e) => alert(e.message)) }, 'Edit'),
      f.canDelete && confirmButton('Delete', 'Confirm', async () => { try { await api('DELETE', `/follow-ups/${f.id}`); await rerender(); } catch (e) { alert(e.message); } }))) : h('p', { class: 'muted pad' }, 'No follow-ups here.')));
}
