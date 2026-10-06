// Joshua Nunez
// The calendar: Day, Week, Month and Agenda, for me, the team or one client. Times are shown in this browser's time zone;
// the server keeps them in UTC. Task and project due dates appear as read-only deadlines.
import { h, icon, openSheet, goAfterSheets } from '../dom.js';
import { api } from '../api.js';
import { openNoteForm } from './meetings.js';
import { field, selectField, textareaField, sheetForm, confirmButton, formatDay } from '../ui.js';

export const EVENT_TYPE_LABEL = { client_meeting: 'Client meeting', internal_meeting: 'Internal meeting', team_meeting: 'Team meeting', deadline: 'Deadline', follow_up: 'Follow-up', review: 'Review', sop_review: 'SOP review', training: 'Training', blocked_time: 'Blocked time' };
const VIEWS = [['month', 'Month'], ['week', 'Week'], ['day', 'Day'], ['agenda', 'Agenda']];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// What is showing now. Kept while moving between screens in this visit.
const state = { view: 'month', anchor: null, scope: 'team', clientId: '' };

// ---- local date helpers (all dates are local YYYY-MM-DD keys) ----
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const mondayOf = (k) => { const d = parseKey(k); return addDays(k, -((d.getDay() + 6) % 7)); };
const timeLabel = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const todayKey = () => keyOf(new Date());

// The first and last day the current view shows.
function rangeOf() {
  const a = state.anchor;
  if (state.view === 'day') return [a, a];
  if (state.view === 'week') { const m = mondayOf(a); return [m, addDays(m, 6)]; }
  if (state.view === 'agenda') return [a, addDays(a, 29)];
  const first = `${a.slice(0, 8)}01`;
  const m = mondayOf(first);
  return [m, addDays(m, 41)];
}

function titleOf() {
  const [from, to] = rangeOf();
  const fmt = (k, o) => parseKey(k).toLocaleDateString('en-US', o);
  if (state.view === 'month') return fmt(state.anchor, { month: 'long', year: 'numeric' });
  if (state.view === 'day') return fmt(from, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `${fmt(from, { month: 'short', day: 'numeric' })} to ${fmt(to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function step(dir) {
  const a = parseKey(state.anchor);
  if (state.view === 'month') a.setMonth(a.getMonth() + dir, 1);
  else if (state.view === 'week') a.setDate(a.getDate() + 7 * dir);
  else if (state.view === 'agenda') a.setDate(a.getDate() + 30 * dir);
  else a.setDate(a.getDate() + dir);
  state.anchor = keyOf(a);
}

// ---- turning the server's events into items per local day ----
function localSpan(e) {
  if (e.allDay) return { startKey: e.startsAt, endKey: e.endsAt, start: null, end: null };
  const start = new Date(e.startsAt); const end = new Date(e.endsAt);
  return { startKey: keyOf(start), endKey: keyOf(end), start, end };
}

function itemsByDay(data, [from, to]) {
  const days = new Map();
  const put = (k, item) => { if (k < from || k > to) return; if (!days.has(k)) days.set(k, []); days.get(k).push(item); };
  for (const e of data.events) {
    const span = localSpan(e);
    for (let k = span.startKey; k <= span.endKey && k <= to; k = addDays(k, 1)) {
      put(k, { kind: 'event', event: e, span, first: k === span.startKey, sort: e.allDay ? '' : (k === span.startKey ? e.startsAt : `${k}T00`) });
    }
  }
  for (const d of data.deadlines) put(d.date, { kind: 'deadline', deadline: d, sort: '~' });
  for (const list of days.values()) list.sort((a, b) => a.sort.localeCompare(b.sort));
  return days;
}

const itemLabel = (it) => {
  if (it.kind === 'deadline') return `${it.deadline.kind === 'task' ? 'Task due' : 'Project due'}: ${it.deadline.title}`;
  const { event, span, first } = it;
  const when = event.allDay || !first ? '' : `${timeLabel(span.start)} `;
  return `${when}${event.title}`;
};

// ---- the event form ----
export async function openEventForm(session, { event, date } = {}, onChanged) {
  const manage = session.can['events.manage'];
  const [members, clients] = await Promise.all([manage ? api('GET', '/members') : [], manage && session.can['clients.view'] ? api('GET', '/clients') : []]);
  openSheet(event ? 'Edit event' : 'New event', (close) => {
    const startD = event && !event.allDay ? new Date(event.startsAt) : null;
    const endD = event && !event.allDay ? new Date(event.endsAt) : null;
    const startDate = event ? (event.allDay ? event.startsAt : keyOf(startD)) : (date || todayKey());
    const endDate = event ? (event.allDay ? event.endsAt : keyOf(endD)) : startDate;
    const title = field('Title', { name: 'title', maxlength: 200, required: true, value: event ? event.title : '' });
    const type = selectField('Type', manage ? Object.entries(EVENT_TYPE_LABEL) : [['blocked_time', 'Blocked time']], event ? event.type : manage ? 'client_meeting' : 'blocked_time', { name: 'type' });
    const allDay = h('input', { type: 'checkbox', name: 'allDay', checked: event ? event.allDay : false });
    const sD = field('Start date', { name: 'startDate', type: 'date', required: true, value: startDate });
    const sT = field('Start time', { name: 'startTime', type: 'time', value: startD ? `${pad(startD.getHours())}:${pad(startD.getMinutes())}` : '09:00' });
    const eD = field('End date', { name: 'endDate', type: 'date', required: true, value: endDate });
    const eT = field('End time', { name: 'endTime', type: 'time', value: endD ? `${pad(endD.getHours())}:${pad(endD.getMinutes())}` : '10:00' });
    const where = field('Location or link', { name: 'location', maxlength: 300, value: event ? event.location : '' });
    const notes = textareaField('Notes', { name: 'notes', maxlength: 10000 }, event ? event.notes : '');
    const status = event ? selectField('Status', [['scheduled', 'Scheduled'], ['completed', 'Completed'], ['cancelled', 'Cancelled']], event.status, { name: 'status' }) : null;
    const syncTimes = () => { sT.el.hidden = eT.el.hidden = allDay.checked; };
    allDay.addEventListener('change', syncTimes);
    syncTimes();

    let client = null; let project = null; let task = null; const picked = new Set(event ? event.attendees.map((a) => a.id) : []);
    let linkBlock = null; let people = null;
    if (manage) {
      client = selectField('Client', [['', 'No client'], ...clients.map((c) => [c.id, c.name])], event && event.clientId ? event.clientId : '', { name: 'clientId' });
      project = selectField('Project', [['', 'No project']], '', { name: 'projectId' });
      task = selectField('Task', [['', 'No task']], '', { name: 'taskId' });
      const loadProjects = async () => {
        const list = client.input.value ? await api('GET', `/projects?clientId=${client.input.value}`).catch(() => []) : [];
        const keep = event && Number(client.input.value) === event.clientId ? event.projectId : null;
        project.input.replaceChildren(...[['', 'No project'], ...list.map((p) => [p.id, p.name])].map(([v, l]) => h('option', { value: v, selected: String(v) === String(keep || '') }, l)));
        await loadTasks();
      };
      const loadTasks = async () => {
        const list = project.input.value ? await api('GET', `/tasks?projectId=${project.input.value}`).catch(() => []) : [];
        const keep = event && Number(project.input.value) === event.projectId ? event.taskId : null;
        task.input.replaceChildren(...[['', 'No task'], ...list.filter((t) => t.status !== 'done' || t.id === keep).map((t) => [t.id, t.title])].map(([v, l]) => h('option', { value: v, selected: String(v) === String(keep || '') }, l)));
      };
      client.input.addEventListener('change', loadProjects);
      project.input.addEventListener('change', loadTasks);
      loadProjects();
      linkBlock = h('div', { class: 'two' }, client.el, project.el);
      people = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Who is in it'),
        h('div', { class: 'checks' }, members.filter((m) => m.isActive || picked.has(m.id)).map((m) => {
          const box = h('input', { type: 'checkbox', checked: picked.has(m.id), 'aria-label': m.displayName });
          box.addEventListener('change', () => { if (box.checked) picked.add(m.id); else picked.delete(m.id); });
          return h('label', { class: 'check' }, box, m.displayName);
        })));
    }
    const fields = [title, type, h('label', { class: 'check' }, allDay, 'All day'), h('div', { class: 'two' }, sD.el, sT.el), h('div', { class: 'two' }, eD.el, eT.el), where, linkBlock, task && task.el, people, status, notes];
    const form = sheetForm(fields, event ? 'Save' : 'Add event', async () => {
      const ad = allDay.checked;
      const stamp = (d, t) => new Date(`${d}T${t || '00:00'}`).toISOString().slice(0, 19) + 'Z';
      const body = {
        title: title.input.value, type: type.input.value, allDay: ad, location: where.input.value, notes: notes.input.value,
        startsAt: ad ? sD.input.value : stamp(sD.input.value, sT.input.value), endsAt: ad ? eD.input.value : stamp(eD.input.value, eT.input.value),
      };
      if (status) body.status = status.input.value;
      if (manage) {
        body.clientId = client.input.value === '' ? null : Number(client.input.value);
        body.projectId = project.input.value === '' ? null : Number(project.input.value);
        body.taskId = task.input.value === '' ? null : Number(task.input.value);
        body.attendees = [...picked];
      }
      if (event) await api('PATCH', `/events/${event.id}`, body); else await api('POST', '/events', body);
      await onChanged();
    }, close);
    return form;
  });
}

// ---- details of one event ----
export function openEventDetails(session, event, onChanged) {
  openSheet(event.title, (close) => {
    const span = localSpan(event);
    const when = event.allDay
      ? (event.startsAt === event.endsAt ? formatDay(event.startsAt) : `${formatDay(event.startsAt)} to ${formatDay(event.endsAt)}, all day`)
      : `${span.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeLabel(span.start)} to ${timeLabel(span.end)}${span.startKey === span.endKey ? '' : ` (${span.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`}`;
    const link = (href, text) => (session.can['projects.view'] ? h('a', { class: 'link', href }, text) : text);
    const facts = h('dl', { class: 'facts' },
      h('dt', {}, 'Type'), h('dd', {}, EVENT_TYPE_LABEL[event.type] || event.type),
      h('dt', {}, 'When'), h('dd', {}, when),
      event.status !== 'scheduled' && h('dt', {}, 'Status'), event.status !== 'scheduled' && h('dd', {}, event.status === 'completed' ? 'Completed' : 'Cancelled'),
      event.location && h('dt', {}, 'Where'), event.location && h('dd', {}, event.location),
      event.clientName && h('dt', {}, 'Client'), event.clientName && h('dd', {}, session.can['clients.view'] ? h('a', { class: 'link', href: `#/clients/${event.clientId}` }, event.clientName) : event.clientName),
      event.projectName && h('dt', {}, 'Project'), event.projectName && h('dd', {}, link(`#/projects/${event.projectId}`, event.projectName)),
      event.taskTitle && h('dt', {}, 'Task'), event.taskTitle && h('dd', {}, link(`#/projects/${event.projectId}`, event.taskTitle)),
      event.attendees.length > 0 && h('dt', {}, 'People'), event.attendees.length > 0 && h('dd', {}, event.attendees.map((a) => a.displayName).join(', ')));
    const noteButton = session.can['notes.view'] && (event.meetingNoteId
      ? h('a', { class: 'btn', href: `#/meetings/${event.meetingNoteId}`, onclick: () => close() }, 'Open meeting notes')
      : (session.can['notes.manage'] || event.attendees.some((a) => a.id === session.user.id) || event.createdBy === session.user.id) && h('button', { class: 'btn', type: 'button', onclick: () => { close(); openNoteForm(session, { event }, (n) => goAfterSheets(`#/meetings/${n.id}`)).catch((e) => alert(e.message)); } }, 'Add meeting notes'));
    const actions = event.canEdit ? h('div', { class: 'sheet-actions' },
      confirmButton('Delete', 'Confirm delete', async () => { try { await api('DELETE', `/events/${event.id}`); close(); await onChanged(); } catch (e) { alert(e.message); } }),
      event.status === 'scheduled' && session.can['events.manage'] && h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api('PATCH', `/events/${event.id}`, { status: 'completed' }); close(); await onChanged(); } catch (e) { alert(e.message); } } }, 'Mark done'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { close(); openEventForm(session, { event }, onChanged).catch((e) => alert(e.message)); } }, 'Edit')) : null;
    return h('div', { class: 'sheet-body' }, facts, event.notes && h('p', { class: 'prose' }, event.notes), noteButton && h('div', { class: 'sheet-actions' }, noteButton), actions);
  });
}

// ---- the views ----
function chip(session, it, onChanged, { full = false } = {}) {
  if (it.kind === 'deadline') {
    const d = it.deadline;
    const canOpen = d.kind === 'project' ? session.can['projects.view'] : true;
    const href = d.kind === 'project' ? `#/projects/${d.id}` : (session.can['projects.view'] ? `#/projects/${d.projectId}` : '#/tasks');
    const b = h(canOpen ? 'a' : 'span', { class: 'cal-chip deadline-item', href: canOpen ? href : null, title: itemLabel(it) }, itemLabel(it));
    return b;
  }
  const e = it.event;
  return h('button', { class: `cal-chip t-${e.type}${e.status === 'cancelled' ? ' cancelled' : ''}${e.status === 'completed' ? ' done' : ''}`, type: 'button', title: itemLabel(it), 'aria-label': `${EVENT_TYPE_LABEL[e.type]}: ${itemLabel(it)}`, onclick: () => openEventDetails(session, e, onChanged) }, itemLabel(it));
}

function monthView(session, days, onChanged, goDay) {
  const [from] = rangeOf();
  const cells = [...DOW.map((d) => h('div', { class: 'cal-dow' }, d))];
  const month = state.anchor.slice(0, 7);
  for (let i = 0; i < 42; i++) {
    const k = addDays(from, i);
    const list = days.get(k) || [];
    const shown = list.slice(0, 3);
    cells.push(h('div', { class: `cal-cell${k.slice(0, 7) !== month ? ' out' : ''}${k === todayKey() ? ' today' : ''}` },
      h('button', { class: 'cal-daynum', type: 'button', 'aria-label': `Open ${formatDay(k)}`, onclick: () => goDay(k) }, parseKey(k).getDate()),
      shown.map((it) => chip(session, it, onChanged)),
      list.length > shown.length && h('button', { class: 'cal-more', type: 'button', onclick: () => goDay(k) }, `+${list.length - shown.length} more`)));
  }
  return h('div', { class: 'cal-month', role: 'grid', 'aria-label': titleOf() }, cells);
}

function weekView(session, days, onChanged, goDay) {
  const [from] = rangeOf();
  return h('div', { class: 'cal-week' }, DOW.map((name, i) => {
    const k = addDays(from, i);
    return h('section', { class: `cal-col${k === todayKey() ? ' today' : ''}` },
      h('h3', {}, h('button', { class: 'cal-daynum', type: 'button', onclick: () => goDay(k) }, `${name} ${parseKey(k).getDate()}`)),
      (days.get(k) || []).map((it) => chip(session, it, onChanged)));
  }));
}

function rowOf(session, it, onChanged) {
  if (it.kind === 'deadline') {
    const d = it.deadline;
    return h('div', { class: 'cal-row' }, h('div', { class: 'when' }, 'Due'), h('div', { class: 'what' }, h('strong', {}, d.title), h('span', { class: 'sub' }, `${d.kind === 'task' ? 'Task' : 'Project'}${d.clientName ? `, ${d.clientName}` : ''}`)));
  }
  const e = it.event;
  const when = e.allDay ? 'All day' : `${timeLabel(it.span.start)}${it.first ? '' : ' (cont.)'}`;
  const sub = [EVENT_TYPE_LABEL[e.type], e.clientName, e.status !== 'scheduled' ? e.status : ''].filter(Boolean).join(', ');
  return h('button', { class: 'cal-row', type: 'button', onclick: () => openEventDetails(session, e, onChanged) }, h('div', { class: 'when' }, when), h('div', { class: 'what' }, h('strong', {}, e.title), h('span', { class: 'sub' }, sub)));
}

function listView(session, days, onChanged, [from, to], emptyText) {
  const keys = [...days.keys()].sort();
  if (!keys.length) return h('p', { class: 'muted pad' }, emptyText);
  return h('div', { class: 'cal-agenda' }, keys.map((k) => h('section', { class: 'cal-agenda-day' }, h('h3', {}, parseKey(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })), days.get(k).map((it) => rowOf(session, it, onChanged)))));
}

export async function calendarView(session, { param, rerender }) {
  if (!state.anchor) state.anchor = todayKey();
  const range = rangeOf();
  const manage = session.can['events.manage'];
  const clients = session.can['clients.view'] ? await api('GET', '/clients') : [];
  const params = new URLSearchParams({ from: addDays(range[0], -1), to: addDays(range[1], 1) });
  if (state.scope === 'my') params.set('userId', session.user.id);
  if (state.scope === 'client' && state.clientId) params.set('clientId', state.clientId);
  const data = await api('GET', `/calendar?${params}`);
  const days = itemsByDay(data, range);
  const go = (fn) => () => { fn(); rerender(); };
  const goDay = (k) => { state.anchor = k; state.view = 'day'; rerender(); };

  const scopes = [['team', 'Team'], ['my', 'My calendar'], ...(clients.length ? [['client', 'Client']] : [])];
  const scopeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Whose calendar' }, scopes.map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.scope === v), onclick: go(() => { state.scope = v; }) }, l)));
  const viewChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'View' }, VIEWS.map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.view === v), onclick: go(() => { state.view = v; }) }, l)));
  let clientPick = null;
  if (state.scope === 'client') {
    clientPick = h('select', { class: 'input', 'aria-label': 'Client', onchange: (e) => { state.clientId = e.target.value; rerender(); } }, [h('option', { value: '' }, 'All clients'), ...clients.map((c) => h('option', { value: c.id, selected: String(c.id) === String(state.clientId) }, c.name))]);
  }
  const onChanged = async () => { await rerender(); };
  // An address like #/calendar/12 (from search) opens that event once, then goes back to the plain calendar address.
  if (param) {
    history.replaceState(null, '', '#/calendar');
    api('GET', `/events/${encodeURIComponent(param)}`).then((event) => openEventDetails(session, event, onChanged)).catch((e) => alert(e.message));
  }
  const body = state.view === 'month' ? monthView(session, days, onChanged, goDay)
    : state.view === 'week' ? weekView(session, days, onChanged, goDay)
      : state.view === 'day' ? listView(session, days, onChanged, range, 'No meetings scheduled.')
        : listView(session, days, onChanged, range, 'No meetings scheduled.');

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Calendar')),
      h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEventForm(session, { date: state.view === 'day' ? state.anchor : todayKey() }, onChanged).catch((e) => alert(e.message)) }, icon('plus'), manage ? 'New event' : 'Block time'))),
    h('div', { class: 'cal-bar' },
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous', onclick: go(() => step(-1)) }, icon('back')),
        h('div', { class: 'cal-title', 'aria-live': 'polite' }, titleOf()),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next', onclick: go(() => step(1)) }, icon('chevron')),
        h('button', { class: 'btn', type: 'button', onclick: go(() => { state.anchor = todayKey(); }) }, 'Today')),
      viewChips),
    h('div', { class: 'cal-filters' }, scopeChips, clientPick),
    body);
}
