// Joshua Nunez
// Time: the timer, my week (entries, add, submit the week), and for Managers the review queue and team workload.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, confirmButton, pill, formatDay, formatNumber } from '../ui.js';

export const TIME_TYPE_LABEL = { billable: 'Billable', non_billable: 'Non-billable', internal: 'Internal', meeting: 'Meeting', training: 'Training', admin: 'Admin' };
const STATUS_LABEL = { draft: 'Draft', submitted: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', locked: 'Locked' };
const statusPill = (s) => pill('ts', s, STATUS_LABEL[s] || s);

// Which week is showing and which review list. Kept while moving between screens in this visit.
const state = { anchor: null, queue: 'submitted' };

// ---- local date helpers (all dates are local YYYY-MM-DD keys) ----
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const mondayOf = (k) => addDays(k, -((parseKey(k).getDay() + 6) % 7));
const todayKey = () => keyOf(new Date());
const dayName = (k) => parseKey(k).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

export const duration = (minutes) => { const hh = Math.floor(minutes / 60); const mm = minutes % 60; return hh ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${mm} min`; };
const clock = (seconds) => { const s = Math.max(0, Math.floor(seconds)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };

// The tasks and clients someone may log time against. A Contractor sees only their own tasks, and no clients.
async function choices(session, { includeTask } = {}) {
  const [tasks, clients] = await Promise.all([api('GET', '/tasks'), session.can['clients.view'] ? api('GET', '/clients') : []]);
  const open = tasks.filter((t) => t.status !== 'done' || (includeTask && t.id === includeTask));
  return { tasks: open, clients };
}
const taskOptions = (tasks, none) => [...(none ? [['', none]] : []), ...tasks.map((t) => [t.id, `${t.title}${t.projectName ? `, ${t.projectName}` : ''}`])];

// ---- the entry form (add and edit) ----
export async function openEntryForm(session, { entry, taskId, date } = {}, onSaved) {
  const { tasks, clients } = await choices(session, { includeTask: entry && entry.taskId });
  const staff = session.can['clients.view'];
  openSheet(entry ? 'Edit time' : 'Add time', (close) => {
    const base = entry || {};
    const day = field('Date', { name: 'date', type: 'date', required: true, value: base.date || date || todayKey() });
    const hours = field('Time (hours)', { name: 'hours', type: 'number', min: 0.25, max: 24, step: '0.25', required: true, value: base.minutes ? base.minutes / 60 : '' });
    const task = selectField('Task', taskOptions(tasks, staff ? 'No task' : null), base.taskId || taskId || (staff ? '' : tasks[0] && tasks[0].id), { name: 'taskId' });
    const client = staff ? selectField('Client', [['', 'No client'], ...clients.map((c) => [c.id, c.name])], base.clientId || '', { name: 'clientId' }) : null;
    const type = selectField('Type', Object.entries(TIME_TYPE_LABEL), base.timeType || 'billable', { name: 'timeType' });
    const description = textareaField('What was done', { name: 'description', maxlength: 1000, rows: 3 }, base.description || '');
    const note = entry && entry.status === 'rejected' && entry.reviewNote ? h('p', { class: 'error' }, `Rejected: ${entry.reviewNote}`) : null;
    const del = entry && entry.canDelete ? confirmButton('Delete', 'Click again to delete', async () => { await api('DELETE', `/time-entries/${entry.id}`); close(); await onSaved(); }) : null;
    return sheetForm([day, hours, task, client && h('p', { class: 'muted' }, 'A task sets its client. Choose a client only when there is no task.'), client, type, description], entry ? 'Save' : 'Add time', async () => {
      const body = { date: day.input.value, minutes: Math.round(Number(hours.input.value) * 60), timeType: type.input.value, description: description.input.value, taskId: task.input.value === '' ? null : Number(task.input.value) };
      if (client && !body.taskId) body.clientId = client.input.value === '' ? null : Number(client.input.value);
      if (entry) await api('PATCH', `/time-entries/${entry.id}`, body); else await api('POST', '/time-entries', body);
      await onSaved();
    }, close, [note, del]);
  });
}

// ---- the timer ----
function timerPanel(session, timer, tasks, clients, rerender) {
  const error = h('div', { class: 'error', role: 'alert' });
  const act = (fn) => async () => { error.textContent = ''; try { await fn(); await rerender(); } catch (e) { error.textContent = e.message; } };
  if (timer) {
    const label = h('span', { class: 'timer-clock', 'aria-live': 'off' }, clock(timer.elapsedSeconds));
    if (timer.timerState === 'running') {
      const started = Date.now();
      const base = timer.elapsedSeconds;
      let seen = false;
      const tick = setInterval(() => {
        if (!label.isConnected) { if (seen) clearInterval(tick); return; }
        seen = true;
        label.textContent = clock(base + (Date.now() - started) / 1000);
      }, 1000);
      if (tick && tick.unref) tick.unref(); // never keeps a test run or a closing page waiting
    }
    return h('section', { class: 'panel timer running' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Timer'), pill('ts', timer.timerState === 'running' ? 'running' : 'paused', timer.timerState === 'running' ? 'Running' : 'Paused')),
      label,
      h('p', { class: 'muted' }, [timer.taskTitle, timer.clientName, TIME_TYPE_LABEL[timer.timeType], timer.description].filter(Boolean).join(' · ')),
      h('div', { class: 'sheet-actions left' },
        timer.timerState === 'running'
          ? h('button', { class: 'btn', type: 'button', onclick: act(() => api('POST', '/time/timer/pause', {})) }, 'Pause')
          : h('button', { class: 'btn', type: 'button', onclick: act(() => api('POST', '/time/timer/resume', {})) }, 'Resume'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: act(() => api('POST', '/time/timer/stop', {})) }, 'Stop and save')),
      error);
  }
  const staff = session.can['clients.view'];
  const task = selectField('Task', taskOptions(tasks, staff ? 'No task' : null), staff ? '' : tasks[0] && tasks[0].id, { name: 'taskId' });
  const client = staff ? selectField('Client', [['', 'No client'], ...clients.map((c) => [c.id, c.name])], '', { name: 'clientId' }) : null;
  const type = selectField('Type', Object.entries(TIME_TYPE_LABEL), staff ? 'internal' : 'billable', { name: 'timeType' });
  // A task or a client usually means billable work; with neither it is usually internal.
  const guess = () => { if (staff && task.input.value === '' && (!client || client.input.value === '')) type.input.value = 'internal'; else if (type.input.value === 'internal') type.input.value = 'billable'; };
  task.input.addEventListener('change', guess);
  if (client) client.input.addEventListener('change', guess);
  const description = field('What are you working on?', { name: 'description', maxlength: 1000 });
  return h('section', { class: 'panel timer' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Timer')),
    h('div', { class: 'timer-form' }, task.el, client && client.el, type.el, description.el),
    h('div', { class: 'sheet-actions left' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: act(async () => {
      const body = { timeType: type.input.value, description: description.input.value };
      if (task.input.value !== '') body.taskId = Number(task.input.value); else if (client && client.input.value !== '') body.clientId = Number(client.input.value);
      await api('POST', '/time/timer/start', body);
    }) }, icon('plus'), 'Start timer')),
    error);
}

// ---- my week ----
function entryRow(session, e, rerender) {
  const sub = [e.taskTitle, e.clientName, TIME_TYPE_LABEL[e.timeType], e.description].filter(Boolean).join(' · ');
  const body = [h('div', { class: 'grow' }, h('div', { class: 'row-title' }, e.timerState !== 'none' ? 'Timer in progress' : duration(e.minutes)), h('div', { class: 'row-sub' }, sub), e.status === 'rejected' && e.reviewNote ? h('div', { class: 'error' }, `Rejected: ${e.reviewNote}`) : null), statusPill(e.status)];
  if (!e.canEdit) return h('div', { class: 'row static' }, body);
  return h('button', { class: 'row', type: 'button', onclick: () => openEntryForm(session, { entry: e }, rerender).catch((err) => alert(err.message)) }, body, icon('chevron'));
}

function weekPanel(session, entries, capacityHours, rerender) {
  const from = mondayOf(state.anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const submittable = entries.filter((e) => e.canSubmit);
  const error = h('div', { class: 'error', role: 'alert' });
  const go = (fn) => () => { fn(); rerender(); };
  const title = `${parseKey(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${parseKey(addDays(from, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'My week'),
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous week', onclick: go(() => { state.anchor = addDays(from, -7); }) }, icon('back')),
        h('div', { class: 'week-title', 'aria-live': 'polite' }, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next week', onclick: go(() => { state.anchor = addDays(from, 7); }) }, icon('chevron')),
        h('button', { class: 'btn', type: 'button', onclick: go(() => { state.anchor = todayKey(); }) }, 'This week'))),
    h('p', { class: 'muted' }, `${duration(total)} logged${capacityHours ? ` of ${formatNumber(capacityHours)} h capacity` : ''}`),
    h('div', { class: 'week' }, days.map((k) => {
      const list = entries.filter((e) => e.date === k);
      const sum = list.reduce((s, e) => s + e.minutes, 0);
      return h('section', { class: `week-day${k === todayKey() ? ' today' : ''}` },
        h('div', { class: 'row-between' }, h('h3', { class: 'day-head' }, dayName(k)), h('div', { class: 'foot-actions' }, h('span', { class: 'muted' }, sum ? duration(sum) : ''), h('button', { class: 'btn-text', type: 'button', 'aria-label': `Add time on ${dayName(k)}`, onclick: () => openEntryForm(session, { date: k }, rerender).catch((e) => alert(e.message)) }, 'Add'))),
        list.length ? h('div', { class: 'list-inner' }, list.map((e) => entryRow(session, e, rerender))) : null);
    })),
    h('div', { class: 'sheet-actions left' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: submittable.length === 0, onclick: async () => {
      error.textContent = '';
      try { await api('POST', '/time-entries/submit', { from, to: addDays(from, 6) }); await rerender(); } catch (e) { error.textContent = e.message; }
    } }, `Submit week for approval${submittable.length ? ` (${submittable.length})` : ''}`)),
    error);
}

// ---- review queue (Managers) ----
function openReject(entry, onDone) {
  openSheet('Reject time', (close) => {
    const note = textareaField('Why is it rejected?', { name: 'note', maxlength: 1000, required: true });
    return sheetForm([h('p', { class: 'muted' }, `${entry.userName}, ${formatDay(entry.date)}, ${duration(entry.minutes)}`), note], 'Reject', async () => {
      await api('POST', `/time-entries/${entry.id}/reject`, { note: note.input.value });
      await onDone();
    }, close);
  });
}

function queueRow(e, rerender) {
  const error = h('span', { class: 'error' });
  const act = (fn) => async () => { error.textContent = ''; try { await fn(); await rerender(); } catch (err) { error.textContent = err.message; } };
  return h('div', { class: 'row static review-row' },
    h('div', { class: 'grow' }, h('div', { class: 'row-title' }, `${e.userName}, ${duration(e.minutes)}`), h('div', { class: 'row-sub' }, [formatDay(e.date), e.taskTitle, e.clientName, TIME_TYPE_LABEL[e.timeType], e.description].filter(Boolean).join(' · ')), error),
    h('div', { class: 'foot-actions' },
      e.canReview && h('button', { class: 'btn', type: 'button', onclick: () => openReject(e, rerender) }, 'Reject'),
      e.canReview && h('button', { class: 'btn btn-primary', type: 'button', onclick: act(() => api('POST', `/time-entries/${e.id}/approve`, {})) }, 'Approve'),
      e.canLock && h('button', { class: 'btn', type: 'button', onclick: act(() => api('POST', `/time-entries/${e.id}/lock`, {})) }, 'Lock')));
}

function reviewPanel(list, rerender) {
  const chip = (v, l) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.queue === v), onclick: () => { state.queue = v; rerender(); } }, l);
  const approvable = list.filter((e) => e.canReview);
  const error = h('div', { class: 'error', role: 'alert' });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Review'),
      state.queue === 'submitted' && approvable.length > 1 && h('button', { class: 'btn-text', type: 'button', onclick: async () => {
        error.textContent = '';
        try { for (const e of approvable) await api('POST', `/time-entries/${e.id}/approve`, {}); await rerender(); } catch (err) { error.textContent = err.message; }
      } }, `Approve all (${approvable.length})`)),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Review list' }, chip('submitted', 'Waiting for review'), chip('approved', 'Approved, ready to lock')),
    list.length ? h('div', { class: 'list-inner' }, list.map((e) => queueRow(e, rerender))) : h('p', { class: 'muted' }, state.queue === 'submitted' ? 'Nothing is waiting for review.' : 'Nothing is waiting to be locked.'),
    error);
}

// ---- team workload (Managers) ----
function capacityRow(p) {
  const pct = p.utilizationPercent === null ? 0 : Math.min(100, p.utilizationPercent);
  const fill = h('span', { class: `bar-fill${p.status === 'over' ? ' over' : ''}` });
  fill.style.width = `${pct}%`; // set from script, so the page's style rules stay strict
  return h('div', { class: 'load-row' },
    h('div', { class: 'load-name' }, h('span', {}, p.displayName), h('span', { class: p.status === 'over' ? 'error' : 'muted' }, p.note || `${formatNumber(p.plannedHours)} h planned, ${formatNumber(p.loggedHours)} h logged`)),
    h('div', { class: 'bar' }, fill),
    h('span', { class: 'muted nowrap load-hours' }, p.utilizationPercent === null ? `${formatNumber(p.capacityHours)} h` : `${p.utilizationPercent}% of ${formatNumber(p.capacityHours)} h`));
}

function workloadPanel(cap) {
  const week = cap.weeks[0];
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Team workload')),
    h('p', { class: 'muted' }, 'Planned is open task estimates due this week plus calendar events. The bar shows the larger of planned and logged.'),
    h('div', { class: 'loads' }, week.people.map(capacityRow)));
}

export async function timeView(session, { rerender }) {
  if (!state.anchor) state.anchor = todayKey();
  const from = mondayOf(state.anchor);
  const team = session.can['time.view_team'];
  const [timer, entries, ch, cap] = await Promise.all([
    api('GET', '/time/timer'),
    api('GET', `/time-entries?mine=1&from=${from}&to=${addDays(from, 6)}`),
    choices(session),
    api('GET', `/capacity?weekStart=${from}`),
  ]);
  const queue = team ? await api('GET', `/time-entries?status=${state.queue}`) : null;
  const me = cap.weeks[0].people.find((p) => p.userId === session.user.id);
  const myCapacity = me ? me.capacityHours : 0;
  const right = team ? [reviewPanel(queue, rerender), workloadPanel(cap)] : [];
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Time')),
      h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEntryForm(session, {}, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'Add time'))),
    h('div', { class: 'dash' },
      h('div', { class: 'stack' }, timerPanel(session, timer, ch.tasks, ch.clients, rerender), weekPanel(session, entries, myCapacity, rerender)),
      right.length ? h('div', { class: 'stack' }, right) : null));
}
