// Joshua Nunez
// Setup, sign in, and the forced change of a temporary password.
import { h } from '../dom.js';
import { api } from '../api.js';
import { field } from '../ui.js';

function card(title, ...children) {
  return h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand-mark' }, h('span', { class: 'brand-dot' }), h('span', {}, 'AgencyOS')),
    h('h1', {}, title), ...children));
}

// A form that disables its button while it works and shows the server's message when something is refused.
function form(fields, label, submit) {
  const error = h('div', { class: 'error', role: 'alert' });
  const button = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, label);
  const el = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    button.disabled = true;
    try { await submit(); } catch (err) { error.textContent = err.message; button.disabled = false; }
  } }, fields.map((f) => f.el), error, button);
  return el;
}

export function setupView({ setupCodeRequired }, onDone) {
  const org = field('Agency name', { name: 'organizationName', maxlength: 80, required: true });
  const name = field('Your name', { name: 'displayName', maxlength: 60, required: true, autocomplete: 'name' });
  const user = field('Username', { name: 'username', required: true, autocapitalize: 'none', autocomplete: 'username' });
  const pass = field('Password', { name: 'password', type: 'password', required: true, autocomplete: 'new-password', placeholder: '10 or more characters' });
  const code = setupCodeRequired ? field('Setup code', { name: 'setupCode', required: true, autocapitalize: 'none' }) : null;
  const fields = [org, name, user, pass, ...(code ? [code] : [])];
  return card('Set up your agency', form(fields, 'Create agency', async () => {
    await api('POST', '/setup', { organizationName: org.input.value, displayName: name.input.value, username: user.input.value, password: pass.input.value, setupCode: code ? code.input.value : undefined });
    await api('POST', '/login', { username: user.input.value, password: pass.input.value });
    await onDone();
  }));
}

export function loginView(onDone) {
  const user = field('Username', { name: 'username', required: true, autocapitalize: 'none', autocomplete: 'username' });
  const pass = field('Password', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  return card('Sign in', form([user, pass], 'Sign in', async () => {
    await api('POST', '/login', { username: user.input.value, password: pass.input.value });
    await onDone();
  }));
}

// Shown right after a first sign-in with a temporary password. Nothing else works until it is changed.
export function changePasswordView(session, onDone, onSignOut) {
  const current = field('Temporary password', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' });
  const next = field('New password', { name: 'next', type: 'password', required: true, autocomplete: 'new-password', placeholder: '10 or more characters' });
  const again = field('New password again', { name: 'again', type: 'password', required: true, autocomplete: 'new-password' });
  return card('Choose your password',
    form([current, next, again], 'Save password', async () => {
      if (next.input.value !== again.input.value) throw new Error('The two new passwords are different');
      await api('POST', '/password', { current: current.input.value, next: next.input.value });
      await onDone();
    }),
    h('button', { class: 'btn-text', type: 'button', onclick: onSignOut }, 'Sign out'));
}
