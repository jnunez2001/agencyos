// Joshua Nunez
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, sheetForm, toggleSwitch, pill } from '../ui.js';

function openService(service, onChanged) {
  openSheet(service ? 'Edit service' : 'New service', (close) => {
    const name = field('Name', { name: 'name', maxlength: 60, required: true, value: service ? service.name : '', placeholder: 'SEO' });
    const state = { active: service ? service.isActive : true };
    const active = service ? h('div', { class: 'row-between' }, h('span', {}, 'In use'), toggleSwitch(state.active, (on) => { state.active = on; }, 'In use')) : null;
    return sheetForm([name], service ? 'Save' : 'Add service', async () => {
      if (service) await api('PATCH', `/services/${service.id}`, { name: name.input.value, isActive: state.active }); else await api('POST', '/services', { name: name.input.value });
      await onChanged();
    }, close, active);
  });
}

async function servicesPanel(rerender) {
  const list = await api('GET', '/services?all=1');
  const common = h('button', { class: 'btn-text', type: 'button', onclick: async () => { await api('POST', '/services/defaults', {}); await rerender(); } }, 'Add common services');
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Services'), h('div', { class: 'foot-actions' }, common, h('button', { class: 'btn-text', type: 'button', onclick: () => openService(null, rerender) }, 'Add service'))),
    list.length === 0 ? h('p', { class: 'muted' }, 'No services yet.')
      : h('div', { class: 'list-inner' }, list.map((x) => h('button', { class: 'row', type: 'button', onclick: () => openService(x, rerender) },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, x.name, x.isActive ? null : h('span', { class: 'pill off' }, 'Not in use'))), icon('chevron')))));
}

async function googleSettings() {
  const status = await api('GET', '/integrations/google');
  const copy = status.email ? h('button', { class: 'btn', type: 'button' }, 'Copy address') : null;
  if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(status.email); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it by hand'; } });
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Google'), status.configured ? pill('gs', 'active', 'Set up') : pill('gs', 'dropped', 'Not set up')),
    status.configured
      ? h('div', { class: 'stack' }, h('p', {}, 'Share each client\'s Search Console and Analytics with this address as a read-only user, then connect the client on its page.'), h('div', { class: 'url-row' }, h('code', { class: 'code url' }, status.email || ''), copy))
      : h('div', { class: 'stack' },
        h('p', {}, 'Install a Google service account key on the server to fill results from Search Console and Analytics automatically.'),
        h('ol', { class: 'steps' },
          h('li', {}, 'In Google Cloud, make a project and turn on the Search Console API, Analytics Data API and Analytics Admin API.'),
          h('li', {}, 'Create a service account and download its JSON key.'),
          h('li', {}, 'Copy the key to the server and run: bash /root/agencyos/deploy/set-google-key.sh /root/key.json')),
        h('p', { class: 'muted' }, 'The key is stored only on the server and is never shown here.')));
}

export async function settingsView(session, { refresh, rerender }) {
  const org = await api('GET', '/org');
  const editable = session.can['org.update'];
  const name = field('Agency name', { name: 'name', maxlength: 80, value: org.name, disabled: !editable });
  const tz = field('Timezone', { name: 'timezone', value: org.timezone, disabled: !editable });
  const error = h('div', { class: 'error', role: 'alert' });
  const notice = h('div', { class: 'notice', role: 'status' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  const services = session.can['services.manage'] ? await servicesPanel(rerender) : null;
  const google = session.can['services.manage'] ? await googleSettings() : null;
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Settings')),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = notice.textContent = '';
      save.disabled = true;
      try { await api('PATCH', '/org', { name: name.input.value, timezone: tz.input.value }); await refresh(); notice.textContent = 'Saved'; } catch (err) { error.textContent = err.message; }
      save.disabled = false;
    } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Agency')), name.el, tz.el, error, notice, editable && save), services, google);
}
