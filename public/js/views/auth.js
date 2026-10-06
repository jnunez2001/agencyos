// Joshua Nunez
// Setup, sign in, and the forced change of a temporary password.
import { h, logoSrc } from '../dom.js';
import { api } from '../api.js';
import { field } from '../ui.js';

function card(title, ...children) {
  return h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand-mark' }, h('img', { class: 'brand-logo', src: logoSrc(), alt: '', width: 24, height: 24 }), h('span', {}, 'NexusOS'), h('span', { class: 'muted' }, ' by Josh Nunez')),
    h('h1', {}, title), ...children,
    h('p', { class: 'muted' }, h('a', { class: 'link', href: '/about' }, 'About'), ' and ', h('a', { class: 'link', href: '/privacy' }, 'privacy policy'), ' and ', h('a', { class: 'link', href: '/terms' }, 'terms'))));
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

// What the server says when a Google sign-in did not work. The address carries only a short code.
export const SIGN_IN_PROBLEMS = {
  'no-account': 'This Google account has no NexusOS account. Ask an Owner or Admin to invite you with this email address.',
  disabled: 'This account is turned off. Ask an Owner or Admin.',
  locked: 'Too many attempts. Try again later.',
  denied: 'Google sign-in was cancelled.',
  expired: 'That sign-in link expired. Try again.',
  google: 'Google did not accept the sign-in. Try again.',
  setup: 'Signing in with Google is not set up on this server.',
};

export function loginView(onDone, { googleSignIn = false, notice = '' } = {}) {
  const user = field('Username', { name: 'username', required: true, autocapitalize: 'none', autocomplete: 'username' });
  const pass = field('Password', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const passwordForm = form([user, pass], 'Sign in', async () => {
    await api('POST', '/login', { username: user.input.value, password: pass.input.value });
    await onDone();
  });
  // Google is the standard way in. The password form is still there, one click away.
  if (!googleSignIn) return card('Sign in', notice ? h('div', { class: 'error', role: 'alert' }, notice) : null, passwordForm);
  return card('Sign in',
    notice ? h('div', { class: 'error', role: 'alert' }, notice) : null,
    h('a', { class: 'btn btn-primary btn-block', href: '/api/auth/google/start' }, 'Sign in with Google'),
    h('details', { class: 'advanced' }, h('summary', {}, 'Use a username and password'), h('div', {}, passwordForm)));
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
