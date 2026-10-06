// Joshua Nunez
import { h, icon } from '../dom.js';
import { api } from '../api.js';
import { avatar, rolePill, field, confirmButton, DAY_LABEL } from '../ui.js';
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

// Signing in with Google: link it, unlink it, or sign in only with Google.
function googleCard(g, enabled, rerender) {
  const error = h('p', { class: 'error', role: 'alert' });
  const link = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    error.textContent = '';
    try { const out = await api('POST', '/profile/google/start', {}); location.assign(out.url); } catch (err) { error.textContent = err.message; }
  } }, 'Link my Google account');
  const act = (label, confirm, fn) => confirmButton(label, confirm, async () => { try { await fn(); await rerender(); } catch (err) { error.textContent = err.message; } });
  let body;
  if (g.linked) {
    body = h('div', { class: 'stack' },
      h('p', {}, `Linked: ${g.email}. You can sign in with Google on the login page.`),
      g.passwordLogin ? null : h('p', { class: 'muted' }, 'Password sign-in is off. An Owner or Admin turns it back on by resetting your password.'),
      h('div', { class: 'sheet-actions left' },
        g.canTurnOffPassword ? act('Sign in only with Google', 'Click again to turn off the password', () => api('POST', '/profile/password-login', { enabled: false })) : null,
        g.canUnlink ? act('Unlink Google', 'Click again to unlink', () => api('DELETE', '/profile/google')) : null));
  } else {
    body = h('div', { class: 'stack' },
      g.pendingEmail ? h('p', {}, `An Owner or Admin invited ${g.pendingEmail}. Sign in with that Google account on the login page, or link it here.`) : null,
      enabled ? h('div', { class: 'sheet-actions left' }, link) : h('p', { class: 'muted' }, 'Signing in with Google is not set up on this server.'));
  }
  return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Sign in with Google')), body, error);
}

export async function profileView(session, { rerender }) {
  const [p, google, status] = await Promise.all([api('GET', '/profile'), api('GET', '/profile/google'), api('GET', '/status')]);
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
    form, googleCard(google, !!status.googleSignIn, rerender), google.passwordLogin ? passwordCard(session, rerender) : null);
}
