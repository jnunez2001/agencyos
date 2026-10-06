// Joshua Nunez
// Where Google sends the person back to after they approve (or refuse) access: it says how it went.
import { h } from '../dom.js';

const FAILED = {
  denied: 'Access was not approved, so no Google account was added.',
  expired: 'That sign-in link expired or does not belong to you. Go back and try adding the account again.',
  google: 'Google did not accept the sign-in. Go back and try adding the account again.',
  forbidden: 'Only an Owner or Admin can add a Google account.',
  setup: 'Signing in with Google is not set up on this server.',
};

// `settings` or `clients-12` becomes an address in the app. Nothing else is ever followed.
const target = (key) => (/^clients-\d+$/.test(key || '') ? `#/clients/${key.split('-')[1]}` : '#/settings');

export async function googleResultView(session, { param, extra }) {
  const ok = param === 'ok';
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, ok ? 'Google account connected' : 'Google account not added')),
    h('section', { class: 'panel' },
      h('p', {}, ok ? 'You can now choose its sites and properties when you connect a client.' : (FAILED[extra] || 'Something went wrong. Go back and try again.')),
      h('div', { class: 'sheet-actions' }, h('a', { class: 'btn btn-primary', href: target(extra) }, ok ? 'Continue' : 'Back'))));
}
