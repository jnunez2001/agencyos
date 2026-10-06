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

export async function settingsView(session, { refresh, rerender }) {
  const org = await api('GET', '/org');
  const editable = session.can['org.update'];
  const name = field('Agency name', { name: 'name', maxlength: 80, value: org.name, disabled: !editable });
  const tz = field('Timezone', { name: 'timezone', value: org.timezone, disabled: !editable });
  const error = h('div', { class: 'error', role: 'alert' });
  const notice = h('div', { class: 'notice', role: 'status' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  const services = session.can['services.manage'] ? await servicesPanel(rerender) : null;
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Settings')),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = notice.textContent = '';
      save.disabled = true;
      try { await api('PATCH', '/org', { name: name.input.value, timezone: tz.input.value }); await refresh(); notice.textContent = 'Saved'; } catch (err) { error.textContent = err.message; }
      save.disabled = false;
    } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Agency')), name.el, tz.el, error, notice, editable && save), services);
}
