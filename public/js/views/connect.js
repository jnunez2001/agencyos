// Joshua Nunez
// The page an AI app (such as claude.ai) sends a signed-in person to, to approve its connection.
import { h } from '../dom.js';
import { api } from '../api.js';
import { selectField, ROLE_LABEL } from '../ui.js';

const ACCESS_LABEL = { propose: 'Ask me first', read: 'Read only', direct: 'Apply directly' };
const ACCESS_HELP = { read: 'It can look at your work but cannot change it.', propose: 'It can suggest changes. Nothing happens until you approve it in the AI Inbox.', direct: 'It can make changes at once. Every change is logged.' };

export async function connectView(session, { param }) {
  let request;
  try {
    request = await api('GET', `/oauth/requests/${encodeURIComponent(param)}`);
  } catch (err) {
    return h('div', { class: 'page narrow' }, h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Connect an AI')), h('section', { class: 'panel' }, h('p', {}, err.message)));
  }
  const access = selectField('Access', Object.entries(ACCESS_LABEL), request.defaultAccess, { name: 'access' });
  const help = h('p', { class: 'muted' }, ACCESS_HELP[request.defaultAccess]);
  access.input.addEventListener('change', () => { help.textContent = ACCESS_HELP[access.input.value]; });
  const error = h('div', { class: 'error', role: 'alert' });
  const buttons = [];
  const decide = (kind) => async () => {
    error.textContent = '';
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const out = await api('POST', `/oauth/requests/${encodeURIComponent(param)}/${kind}`, kind === 'approve' ? { access: access.input.value } : {});
      location.assign(out.redirectUrl);
    } catch (err) {
      error.textContent = err.message;
      buttons.forEach((b) => { b.disabled = false; });
    }
  };
  const cancel = h('button', { class: 'btn', type: 'button', onclick: decide('deny') }, 'Cancel');
  const approve = h('button', { class: 'btn btn-primary', type: 'button', onclick: decide('approve') }, 'Approve');
  buttons.push(cancel, approve);
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, `Connect ${request.clientName}`)),
    h('section', { class: 'panel' },
      h('p', {}, `${request.clientName} is asking to work in NexusOS as you.`),
      h('dl', { class: 'facts' },
        h('dt', {}, 'App'), h('dd', {}, request.clientName),
        h('dt', {}, 'Returns to'), h('dd', {}, request.redirectHost),
        h('dt', {}, 'Acts as'), h('dd', {}, `${session.user.displayName} (${ROLE_LABEL[session.role] || session.role})`)),
      access.el, help, error,
      h('div', { class: 'sheet-actions' }, cancel, approve)));
}
