// Joshua Nunez
// Clients: the list, a client page with contacts and projects, and the forms.
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, confirmButton, pill, CLIENT_STATUS_LABEL } from '../ui.js';
import { projectPill, openProjectForm } from './projects.js';

export const clientPill = (s) => pill('cs', s, CLIENT_STATUS_LABEL[s] || s);
let statusFilter = 'active';

function openClientForm(client, onChanged) {
  openSheet(client ? 'Edit client' : 'New client', (close) => {
    const name = field('Name', { name: 'name', maxlength: 100, required: true, value: client ? client.name : '' });
    const status = selectField('Status', Object.entries(CLIENT_STATUS_LABEL), client ? client.status : 'active', { name: 'status' });
    const website = field('Website', { name: 'website', maxlength: 200, value: client ? client.website : '', autocapitalize: 'none' });
    const industry = field('Industry', { name: 'industry', maxlength: 80, value: client ? client.industry : '' });
    const notes = textareaField('Notes', { name: 'notes', maxlength: 5000 }, client ? client.notes : '');
    return sheetForm([name, h('div', { class: 'two' }, status.el, industry.el), website, notes], client ? 'Save' : 'Add client', async () => {
      const body = { name: name.input.value, status: status.input.value, website: website.input.value, industry: industry.input.value, notes: notes.input.value };
      if (client) await api('PATCH', `/clients/${client.id}`, body); else await api('POST', '/clients', body);
      await onChanged();
    }, close);
  });
}

function openContactForm(clientId, contact, onChanged) {
  openSheet(contact ? 'Edit contact' : 'New contact', (close) => {
    const name = field('Name', { name: 'name', maxlength: 80, required: true, value: contact ? contact.name : '' });
    const role = field('Role', { name: 'roleTitle', maxlength: 80, value: contact ? contact.roleTitle : '' });
    const email = field('Email', { name: 'email', type: 'email', maxlength: 120, value: contact ? contact.email : '', autocapitalize: 'none' });
    const phone = field('Phone', { name: 'phone', type: 'tel', maxlength: 40, value: contact ? contact.phone : '' });
    const primary = h('input', { type: 'checkbox', name: 'isPrimary', checked: contact ? contact.isPrimary : false });
    const del = contact ? confirmButton('Delete contact', 'Click again to delete', async () => { await api('DELETE', `/contacts/${contact.id}`); close(); await onChanged(); }) : null;
    return sheetForm([name, role, h('div', { class: 'two' }, email.el, phone.el), h('label', { class: 'check' }, primary, h('span', {}, 'Primary contact'))], contact ? 'Save' : 'Add contact', async () => {
      const body = { name: name.input.value, roleTitle: role.input.value, email: email.input.value, phone: phone.input.value, isPrimary: primary.checked };
      if (contact) await api('PATCH', `/contacts/${contact.id}`, body); else await api('POST', `/clients/${clientId}/contacts`, body);
      await onChanged();
    }, close, del);
  });
}

async function clientPage(session, id, rerender) {
  const c = await api('GET', `/clients/${id}`);
  const manage = session.can['clients.manage'];
  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Industry'), h('dd', {}, c.industry || 'Not set'),
    h('dt', {}, 'Website'), h('dd', {}, c.website || 'Not set'),
    h('dt', {}, 'Open projects'), h('dd', {}, String(c.openProjects)));
  const contactRow = (k) => h(manage ? 'button' : 'div', { class: `row${manage ? '' : ' static'}`, type: manage ? 'button' : null, onclick: manage ? () => openContactForm(c.id, k, rerender) : null },
    h('div', { class: 'grow' }, h('div', { class: 'row-title' }, k.name, k.isPrimary && h('span', { class: 'pill role-owner' }, 'Primary')),
      h('div', { class: 'row-sub' }, [k.roleTitle, k.email, k.phone].filter(Boolean).join(' · '))),
    manage && icon('chevron'));
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/clients' }, icon('back'), 'Clients'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, c.name), h('div', { class: 'head-meta' }, clientPill(c.status))),
      manage && h('button', { class: 'btn', type: 'button', onclick: () => openClientForm(c, rerender) }, 'Edit')),
    h('div', { class: 'split' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Details')), c.notes && h('p', { class: 'prose' }, c.notes), facts),
      h('div', { class: 'stack' },
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Contacts'), manage && h('button', { class: 'btn-text', type: 'button', onclick: () => openContactForm(c.id, null, rerender) }, 'Add contact')),
          c.contacts.length ? h('div', { class: 'list-inner' }, c.contacts.map(contactRow)) : h('p', { class: 'muted' }, 'No contacts yet.')),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Projects'), session.can['projects.manage'] && h('button', { class: 'btn-text', type: 'button', onclick: () => openProjectForm(session, { clientId: c.id }, rerender).catch((e) => alert(e.message)) }, 'New project')),
          c.projects.length
            ? h('div', { class: 'list-inner' }, c.projects.map((p) => h('a', { class: 'row', href: `#/projects/${p.id}` },
              h('div', { class: 'grow' }, h('div', { class: 'row-title' }, p.name), h('div', { class: 'row-sub' }, `${p.openTasks} open tasks`)), projectPill(p.status), icon('chevron'))))
            : h('p', { class: 'muted' }, 'No projects yet.')))));
}

export async function clientsView(session, { param, rerender }) {
  if (param) return clientPage(session, param, rerender);
  const list = await api('GET', '/clients');
  const shown = statusFilter === 'all' ? list : list.filter((c) => c.status === statusFilter);
  const chip = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(statusFilter === key), onclick: () => { statusFilter = key; rerender(); } }, label);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Clients'),
      session.can['clients.manage'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openClientForm(null, rerender) }, icon('plus'), 'New client')),
    h('div', { class: 'chips' }, chip('active', 'Active'), chip('paused', 'Paused'), chip('archived', 'Archived'), chip('all', 'All')),
    shown.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No clients here.'))
      : h('section', { class: 'panel list' }, shown.map((c) => h('a', { class: 'row', href: `#/clients/${c.id}` },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-sub' }, [c.industry, c.website].filter(Boolean).join(' · '))),
        h('span', { class: 'muted nowrap' }, `${c.openProjects} open projects`), clientPill(c.status), icon('chevron')))));
}
