// Joshua Nunez
import { h, icon } from '../dom.js';
import { api } from '../api.js';
import { avatar, rolePill, field, DAY_LABEL } from '../ui.js';
import { overflowNav } from '../nav.js';

function timezones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Manila', 'UTC']; }
}

function passwordCard(session, onChanged) {
  const current = field('Current password', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' });
  const next = field('New password', { name: 'next', type: 'password', required: true, autocomplete: 'new-password', placeholder: '10 or more characters' });
  const error = h('div', { class: 'error', role: 'alert' });
  const notice = h('div', { class: 'notice', role: 'status' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Change password');
  return h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = notice.textContent = '';
    save.disabled = true;
    try {
      await api('POST', '/password', { current: current.input.value, next: next.input.value });
      current.input.value = next.input.value = '';
      notice.textContent = 'Password changed';
      await onChanged();
    } catch (err) { error.textContent = err.message; }
    save.disabled = false;
  } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Password')), current.el, next.el, error, notice, save);
}

export async function profileView(session, { rerender }) {
  const p = await api('GET', '/profile');
  const title = field('Job title', { name: 'jobTitle', maxlength: 60, value: p.jobTitle });
  const dept = field('Department', { name: 'department', maxlength: 60, value: p.department });
  const tzList = h('datalist', { id: 'tz-list' }, timezones().map((z) => h('option', { value: z })));
  const tz = field('Timezone', { name: 'timezone', value: p.timezone, list: 'tz-list' });
  const days = new Set(p.workDays);
  const dayButtons = h('div', { class: 'chips', role: 'group', 'aria-label': 'Working days' }, DAY_LABEL.map((label, i) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(days.has(i + 1)), onclick: () => {
      if (days.has(i + 1)) days.delete(i + 1); else days.add(i + 1);
      b.setAttribute('aria-pressed', String(days.has(i + 1)));
    } }, label);
    return b;
  }));
  const start = field('Start', { name: 'workStart', type: 'time', value: p.workStart });
  const end = field('End', { name: 'workEnd', type: 'time', value: p.workEnd });
  const cap = field('Weekly capacity (hours)', { name: 'weeklyCapacityHours', type: 'number', min: 0, max: 168, value: p.weeklyCapacityHours });
  const error = h('div', { class: 'error', role: 'alert' });
  const notice = h('div', { class: 'notice', role: 'status' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  const form = h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = notice.textContent = '';
    save.disabled = true;
    try {
      await api('PATCH', '/profile', { jobTitle: title.input.value, department: dept.input.value, timezone: tz.input.value, workDays: [...days].sort(), workStart: start.input.value, workEnd: end.input.value, weeklyCapacityHours: Number(cap.input.value) });
      notice.textContent = 'Saved';
    } catch (err) { error.textContent = err.message; }
    save.disabled = false;
  } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Work')), title.el, dept.el, tz.el, tzList,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Working days'), dayButtons),
    h('div', { class: 'two' }, start.el, end.el), cap.el, error, notice, save);
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'My profile')),
    h('section', { class: 'panel member-head' }, avatar({ id: p.userId, displayName: p.displayName }, 'lg'), h('div', {}, h('strong', {}, p.displayName), h('div', { class: 'muted' }, `@${p.username}`), rolePill(p.role))),
    overflowNav(session).length > 0 && h('section', { class: 'panel list only-mobile' }, overflowNav(session).map((n) => h('a', { class: 'row', href: `#/${n.key}` }, icon(n.icon), h('div', { class: 'grow' }, h('div', { class: 'row-title' }, n.label)), icon('chevron')))),
    form, passwordCard(session, rerender));
}
