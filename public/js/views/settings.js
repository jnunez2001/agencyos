// Joshua Nunez
import { h, icon, openSheet } from '../dom.js';
import { api } from '../api.js';
import { field, sheetForm, toggleSwitch, confirmButton } from '../ui.js';

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

// Owners only: require Google sign-in for everyone but Owners.
function securityPanel(org, googleOn, rerender) {
  const error = h('p', { class: 'error', role: 'alert' });
  const sw = toggleSwitch(org.requireGoogle, async (on) => {
    error.textContent = '';
    try { await api('PUT', '/org/security', { requireGoogle: on }); await rerender(); } catch (err) { error.textContent = err.message; sw.setAttribute('aria-checked', String(!on)); }
  }, 'Require Google sign-in');
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Security')),
    h('div', { class: 'row-between' }, h('div', {}, h('div', { class: 'row-title' }, 'Require Google sign-in'), h('div', { class: 'row-sub' }, 'Everyone except Owners must sign in with Google. Owners keep their password as a way back in.')), googleOn || org.requireGoogle ? sw : h('span', { class: 'muted' }, 'Set up Google first')),
    error);
}

async function googleSettings(rerender) {
  const status = await api('GET', '/integrations/google');
  const copy = status.serviceAccount.email ? h('button', { class: 'btn', type: 'button' }, 'Copy address') : null;
  if (copy) copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(status.serviceAccount.email); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it by hand'; } });
  const error = h('p', { class: 'error', role: 'alert' });
  const add = status.signIn.configured && status.canManageAccounts
    ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      error.textContent = '';
      try { const out = await api('POST', '/integrations/google/accounts/start', { returnTo: 'settings' }); location.assign(out.url); } catch (err) { error.textContent = err.message; }
    } }, icon('plus'), 'Add Google account')
    : null;
  const accountRows = status.accounts.map((a) => h('div', { class: 'row static' },
    h('div', { class: 'grow' }, h('div', { class: 'row-title' }, a.email, a.status === 'ok' ? null : h('span', { class: 'pill off' }, 'Needs reconnecting')),
      h('div', { class: 'row-sub' }, `${a.clients} ${a.clients === 1 ? 'client' : 'clients'}${a.connectedByName ? ` · added by ${a.connectedByName}` : ''}`)),
    status.canManageAccounts && a.status !== 'ok' && add ? h('button', { class: 'btn-text', type: 'button', onclick: () => add.click() }, 'Reconnect') : null,
    status.canManageAccounts ? confirmButton('Remove', 'Click again to remove', async () => { await api('DELETE', `/integrations/google/accounts/${a.id}`); await rerender(); }) : null));
  const setupSteps = h('div', { class: 'stack' },
    h('p', {}, 'Connect your own Google account to pick from every Search Console site and Analytics property it can see. It needs a Google sign-in client from your Google Cloud project.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'In Google Cloud, turn on the Search Console API, Analytics Data API and Analytics Admin API.'),
      h('li', {}, 'Set up the OAuth consent screen (External) and publish it, then create an OAuth client ID of type Web application.'),
      h('li', {}, `Add these authorized redirect URIs: ${location.origin}/api/integrations/google/callback and ${location.origin}/api/auth/google/callback (the second one is for signing in to Nexus with Google).`),
      h('li', {}, 'On the server run: bash /root/agencyos/deploy/set-google-oauth.sh, and paste the client ID and secret when asked.')),
    h('p', { class: 'muted' }, 'The secret is stored only on the server and is never shown here.'));
  const service = h('details', { class: 'advanced' },
    h('summary', {}, 'Service account (advanced)'),
    status.serviceAccount.configured
      ? h('div', { class: 'stack' }, h('p', {}, 'Share a client\'s Search Console and Analytics with this address as a read-only user to use it instead of an account.'), h('div', { class: 'url-row' }, h('code', { class: 'code url' }, status.serviceAccount.email || ''), copy))
      : h('div', { class: 'stack' }, h('p', {}, 'Optional. A Google service account key avoids sign-in screens, but each client must share access with it.'), h('p', { class: 'muted' }, 'On the server: bash /root/agencyos/deploy/set-google-key.sh /root/key.json')));
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Google'), add),
    error,
    status.accounts.length ? h('div', { class: 'list-inner' }, accountRows) : null,
    !status.signIn.configured && !status.accounts.length ? setupSteps : null,
    status.signIn.configured && !status.accounts.length ? h('p', { class: 'muted' }, 'No Google account is connected yet.') : null,
    service);
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
  const google = session.can['services.manage'] ? await googleSettings(rerender) : null;
  const security = session.can['org.security'] ? securityPanel(org, (await api('GET', '/status')).googleSignIn, rerender) : null;
  return h('div', { class: 'page narrow' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Settings')),
    h('form', { class: 'panel', onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = notice.textContent = '';
      save.disabled = true;
      try { await api('PATCH', '/org', { name: name.input.value, timezone: tz.input.value }); await refresh(); notice.textContent = 'Saved'; } catch (err) { error.textContent = err.message; }
      save.disabled = false;
    } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Agency')), name.el, tz.el, error, notice, editable && save), security, services, google);
}
