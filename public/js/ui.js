// Joshua Nunez
// Small shared pieces: avatars, role names, labels, and form helpers.
import { h } from './dom.js';

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
