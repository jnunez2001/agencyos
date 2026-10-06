// Joshua Nunez
import { h } from '../dom.js';
import { api } from '../api.js';
import { field } from '../ui.js';

export async function settingsView(session, { refresh }) {
  const org = await api('GET', '/org');
  const editable = session.can['org.update'];
  const name = field('Agency name', { name: 'name', maxlength: 80, value: org.name, disabled: !editable });
  const tz = field('Timezone', { name: 'timezone', value: org.timezone, disabled: !editable });
  const error = h('div', { class: 'error', role: 'alert' });
  const notice = h('div', { class: 'notice', role: 'status' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save');
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Settings')),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = notice.textContent = '';
      save.disabled = true;
      try { await api('PATCH', '/org', { name: name.input.value, timezone: tz.input.value }); await refresh(); notice.textContent = 'Saved'; } catch (err) { error.textContent = err.message; }
      save.disabled = false;
    } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Agency')), name.el, tz.el, error, notice, editable && save));
}
