// Joshua Nunez
// The AI page: the inbox of changes an AI proposed, and the keys that let an AI connect.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, sheetForm, confirmButton, formatWhen, pill } from '../ui.js';

const ACCESS_LABEL = { read: 'Read only', propose: 'Ask me first', direct: 'Apply directly' };
const ACCESS_HELP = { read: 'The AI can look at your work but cannot change it.', propose: 'The AI can suggest changes. Nothing happens until you approve it in the Inbox.', direct: 'The AI can make changes at once. Every change is logged.' };
let tab = 'inbox';

// ---- keys ----

function showToken(key) {
  openSheet('Your new key', (close) => {
    const token = h('input', { class: 'input mono', readonly: true, value: key.token, 'aria-label': 'API key' });
    const command = `claude mcp add --transport http agencyos ${location.origin}/mcp --header "Authorization: Bearer ${key.token}"`;
    const copy = (text, button) => async () => {
      try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch { button.textContent = 'Select and copy it by hand'; }
    };
    const copyKey = h('button', { class: 'btn', type: 'button' }, 'Copy key');
    const copyCmd = h('button', { class: 'btn', type: 'button' }, 'Copy Claude Code command');
    copyKey.addEventListener('click', copy(key.token, copyKey));
    copyCmd.addEventListener('click', copy(command, copyCmd));
    token.addEventListener('focus', () => token.select());
    return h('div', { class: 'sheet-body' },
      h('p', { class: 'notice-strong' }, 'Copy it now. It is shown only once.'),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Key'), token),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Connect Claude Code'), h('pre', { class: 'code' }, command)),
      h('div', { class: 'sheet-actions' }, copyKey, copyCmd, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, 'Done')));
  });
}

function openNewKey(onChanged) {
  openSheet('New AI key', (close) => {
    const name = field('Name', { name: 'name', maxlength: 60, required: true, placeholder: 'Claude on my Mac' });
    const access = selectField('Access', ['propose', 'read', 'direct'].map((a) => [a, ACCESS_LABEL[a]]), 'propose', { name: 'access' });
    const help = h('p', { class: 'muted' }, ACCESS_HELP.propose);
    access.input.addEventListener('change', () => { help.textContent = ACCESS_HELP[access.input.value]; });
    return sheetForm([name, access, help], 'Create key', async () => {
      const created = await api('POST', '/api-keys', { name: name.input.value, access: access.input.value });
      await onChanged();
      setTimeout(() => showToken(created), 60);
    }, close);
  });
}

function openKey(key, onChanged) {
  openSheet(key.name, (close) => {
    const access = selectField('Access', ['propose', 'read', 'direct'].map((a) => [a, ACCESS_LABEL[a]]), key.access, { name: 'access', disabled: key.revoked });
    const help = h('p', { class: 'muted' }, ACCESS_HELP[key.access]);
    access.input.addEventListener('change', () => { help.textContent = ACCESS_HELP[access.input.value]; });
    const facts = h('dl', { class: 'facts' },
      h('dt', {}, 'Key'), h('dd', { class: 'mono' }, `${key.prefix}...`),
      h('dt', {}, 'Acts as'), h('dd', {}, key.ownerName),
      h('dt', {}, 'Last used'), h('dd', {}, key.lastUsedAt ? formatWhen(key.lastUsedAt) : 'Never'));
    if (key.revoked) return h('div', { class: 'sheet-body' }, facts, h('p', { class: 'muted' }, 'This key is revoked.'), h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close')));
    const revoke = confirmButton('Revoke key', 'Click again to revoke', async () => { await api('DELETE', `/api-keys/${key.id}`); close(); await onChanged(); });
    return sheetForm([facts, access, help], 'Save', async () => { await api('PATCH', `/api-keys/${key.id}`, { access: access.input.value }); await onChanged(); }, close, revoke);
  });
}

function keysTab(keys, rerender) {
  return h('div', { class: 'stack' },
    h('div', { class: 'row-between' }, h('span', {}), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openNewKey(rerender) }, icon('plus'), 'New key')),
    keys.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No keys yet.'))
      : h('section', { class: 'panel list' }, keys.map((k) => h('button', { class: 'row', type: 'button', onclick: () => openKey(k, rerender) },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, k.name, k.revoked && h('span', { class: 'pill off' }, 'Revoked')),
          h('div', { class: 'row-sub' }, `${k.prefix}... · acts as ${k.ownerName} · ${k.lastUsedAt ? `used ${formatWhen(k.lastUsedAt)}` : 'never used'}`)),
        h('span', { class: `pill acc-${k.access}` }, ACCESS_LABEL[k.access]), icon('chevron')))));
}

// ---- inbox ----

function proposalCard(p, rerender) {
  const error = h('div', { class: 'error', role: 'alert' }, p.status === 'failed' ? p.error : '');
  const decide = (kind) => async (e) => {
    e.currentTarget.disabled = true;
    try { await api('POST', `/ai/proposals/${p.id}/${kind}`, {}); await rerender(); } catch (err) { error.textContent = err.message; e.currentTarget.disabled = false; }
  };
  return h('section', { class: 'panel proposal' },
    h('div', { class: 'row-between' }, h('h2', {}, p.summary), pill('pp', p.status, { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected', failed: 'Failed' }[p.status])),
    h('p', { class: 'muted' }, `From ${p.keyName || 'a removed key'} (acts as ${p.ownerName}), ${formatWhen(p.createdAt)}${p.decidedByName ? `. ${p.status === 'rejected' ? 'Rejected' : 'Decided'} by ${p.decidedByName}` : ''}`),
    h('ol', { class: 'steps' }, p.lines.map((l) => h('li', {}, l))),
    error,
    p.status === 'pending' && h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: decide('reject') }, 'Reject'), h('button', { class: 'btn btn-primary', type: 'button', onclick: decide('approve') }, 'Approve')));
}

function inboxTab(proposals, rerender) {
  const pending = proposals.filter((p) => p.status === 'pending');
  const done = proposals.filter((p) => p.status !== 'pending');
  return h('div', { class: 'stack' },
    pending.length ? pending.map((p) => proposalCard(p, rerender)) : h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'Nothing is waiting for you.')),
    done.length > 0 && h('h2', { class: 'section-title' }, 'Decided'),
    done.map((p) => proposalCard(p, rerender)));
}

export async function aiView(session, { rerender }) {
  const [proposals, keys] = await Promise.all([api('GET', '/ai/proposals'), api('GET', '/api-keys')]);
  const pendingCount = proposals.filter((p) => p.status === 'pending').length;
  const tabButton = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(tab === key), onclick: () => { tab = key; rerender(); } }, label);
  return h('div', { class: 'page narrow-wide' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'AI')),
    h('div', { class: 'chips' }, tabButton('inbox', pendingCount ? `Inbox (${pendingCount})` : 'Inbox'), tabButton('keys', 'Keys')),
    tab === 'inbox' ? inboxTab(proposals, rerender) : keysTab(keys, rerender));
}
