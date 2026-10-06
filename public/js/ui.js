// Joshua Nunez
// Small shared pieces: avatars, role names, labels, and form helpers.
import { h, openSheet } from './dom.js';

export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Manager', employee: 'Employee', contractor: 'Contractor' };
export const DAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// A colored circle with initials. The color is stable per person.
export function avatar(user, size = 'md') {
  return h('span', { class: `avatar av-${(Number(user.id) || 0) % 6} ${size}`, 'aria-hidden': 'true' }, initials(user.displayName || user.name));
}

export const rolePill = (role) => h('span', { class: `pill role-${role}` }, ROLE_LABEL[role] || role);

export function greeting(timeZone, name) {
  let hour = 12;
  try { hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date())); } catch { /* keep noon */ }
  return `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${name}`;
}

// A labeled field. Returns { el, input }.
export function field(label, attrs = {}) {
  const input = h('input', { class: 'input', autocomplete: 'off', ...attrs });
  return { input, el: h('label', { class: 'field' }, h('span', { class: 'label' }, label), input) };
}

export function selectField(label, options, value, attrs = {}) {
  const input = h('select', { class: 'input', ...attrs }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  return { input, el: h('label', { class: 'field' }, h('span', { class: 'label' }, label), input) };
}

// A switch with a sliding knob.
export function toggleSwitch(checked, onChange, label) {
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label || null }, h('span', { class: 'switch-knob' }));
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return sw;
}

// A random temporary password the Owner can read out or paste. Letters and digits that are easy to tell apart.
export function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(14);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', review: 'In QA', changes: 'Changes requested', done: 'Done' };
export const SOP_STATUS_LABEL = { draft: 'Draft', testing: 'Testing', approved: 'Approved', deprecated: 'Deprecated' };
export const QA_RESULT_LABEL = { pending: 'Waiting', approved: 'Approved', changes_requested: 'Changes requested', withdrawn: 'Withdrawn' };
export const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const PROJECT_STATUS_LABEL = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' };
export const CLIENT_STATUS_LABEL = { lead: 'Lead', onboarding: 'Onboarding', active: 'Active', paused: 'Paused', at_risk: 'At risk', completed: 'Completed', archived: 'Archived' };
export const GOAL_STATUS_LABEL = { active: 'Active', achieved: 'Achieved', dropped: 'Dropped' };

export const pill = (kind, value, label) => h('span', { class: `pill ${kind}-${value}` }, label);
export const statusPill = (s) => pill('st', s, STATUS_LABEL[s] || s);
export const priorityPill = (p) => pill('pr', p, PRIORITY_LABEL[p] || p);

// "Oct 5", or "Oct 5, 2027" when it is not this year. Takes a YYYY-MM-DD date.
export function formatDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// The due date of a task, red when it is overdue. Nothing when there is no date.
export function dueLabel(task) {
  if (!task.dueDate) return null;
  return h('span', { class: `due${task.isOverdue ? ' overdue' : ''}` }, `${task.isOverdue ? 'Overdue, ' : 'Due '}${formatDay(task.dueDate)}`);
}

export function textareaField(label, attrs = {}, value = '') {
  const input = h('textarea', { class: 'input area', rows: 4, ...attrs }, value);
  return { input, el: h('label', { class: 'field' }, h('span', { class: 'label' }, label), input) };
}

// A sheet form that shows a failure from the server in place, and keeps the button usable.
export function sheetForm(fields, label, submit, close, extra) {
  const error = h('div', { class: 'error', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, label);
  return h('form', { class: 'sheet-body', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    save.disabled = true;
    try { await submit(); close(); } catch (err) { error.textContent = err.message; save.disabled = false; }
  } }, fields.filter(Boolean).map((f) => f.el || f), error, extra, h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), save));
}

// A first click arms the button, the second confirms. No browser dialog needed.
export function confirmButton(label, confirmLabel, action) {
  const b = h('button', { class: 'btn btn-danger', type: 'button' }, label);
  let armed = false;
  b.addEventListener('click', async () => {
    if (!armed) { armed = true; b.textContent = confirmLabel; return; }
    b.disabled = true;
    await action();
  });
  return b;
}

export { openSheet };

// What an empty list says. A list that has records but shows none because of the filters says so; a list that
// has nothing at all says what to do next.
export const NO_MATCH = 'Nothing matches these filters.';
export const emptyNote = (filtered, message, { pad = false } = {}) => h('p', { class: `muted${pad ? ' pad' : ''}` }, filtered ? NO_MATCH : message);

// A small trend line for a series of numbers (oldest first). Drawn as SVG from script, so no inline styles are needed.
export function sparkline(values, { width = 120, height = 32 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  if (values.length < 2) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const points = values.map((v, i) => `${(pad + (i / (values.length - 1)) * (width - pad * 2)).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`).join(' ');
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(line);
  return svg;
}

export const formatNumber = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
