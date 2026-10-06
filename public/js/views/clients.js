// Joshua Nunez
// Clients: the list, a client page with goals, contacts and projects, and the forms.
import { h, icon, openSheet, goAfterSheets } from '../dom.js';
import { api } from '../api.js';
import { emptyNote, field, selectField, textareaField, sheetForm, confirmButton, pill, formatDay, formatWhen, formatNumber, sparkline, CLIENT_STATUS_LABEL, GOAL_STATUS_LABEL } from '../ui.js';
import { projectPill, openProjectForm } from './projects.js';
import { reportPill, openReportForm, openGenerate } from './reports.js';
import { activityPanel } from './trace.js';

export const clientPill = (s) => pill('cs', s, CLIENT_STATUS_LABEL[s] || s);
const goalPill = (s) => pill('gs', s, GOAL_STATUS_LABEL[s] || s);
const CURRENT = ['lead', 'onboarding', 'active', 'at_risk'];
const FILTERS = { current: ['Current', (c) => CURRENT.includes(c.status)], paused: ['Paused', (c) => c.status === 'paused'], past: ['Past', (c) => ['completed', 'archived'].includes(c.status)], all: ['All', () => true] };
let statusFilter = 'current';
let activityDays = 7;

export async function openClientForm(session, client, onChanged) {
  const [services, members] = await Promise.all([session.can['services.view'] ? api('GET', '/services') : [], api('GET', '/members')]);
  openSheet(client ? 'Edit client' : 'New client', (close) => {
    const name = field('Name', { name: 'name', maxlength: 100, required: true, value: client ? client.name : '' });
    const status = selectField('Status', Object.entries(CLIENT_STATUS_LABEL), client ? client.status : 'active', { name: 'status' });
    const website = field('Website', { name: 'website', maxlength: 200, value: client ? client.website : '', autocapitalize: 'none' });
    const industry = field('Industry', { name: 'industry', maxlength: 80, value: client ? client.industry : '' });
    const owner = selectField('Account owner', [['', 'Nobody'], ...members.filter((m) => m.isActive || (client && client.accountOwnerId === m.id)).map((m) => [m.id, m.displayName])], client && client.accountOwnerId ? client.accountOwnerId : '', { name: 'accountOwnerId' });
    const start = field('Start date', { name: 'startDate', type: 'date', value: client && client.startDate ? client.startDate : '' });
    const notes = textareaField('Notes', { name: 'notes', maxlength: 5000 }, client ? client.notes : '');
    // Services are toggled on and off. One the client already has stays visible even if it was switched off.
    const chosen = new Set(client ? client.services.map((s) => s.id) : []);
    const shown = [...services, ...(client ? client.services.filter((s) => !services.some((x) => x.id === s.id)) : [])];
    const serviceChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Services' }, shown.map((s) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(chosen.has(s.id)), onclick: () => { if (chosen.has(s.id)) chosen.delete(s.id); else chosen.add(s.id); b.setAttribute('aria-pressed', String(chosen.has(s.id))); } }, s.name);
      return b;
    }));
    return sheetForm([name, h('div', { class: 'two' }, status.el, industry.el), website, h('div', { class: 'two' }, owner.el, start.el),
      shown.length ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Services'), serviceChips) : null, notes], client ? 'Save' : 'Add client', async () => {
      const body = { name: name.input.value, status: status.input.value, website: website.input.value, industry: industry.input.value, notes: notes.input.value, accountOwnerId: owner.input.value === '' ? null : Number(owner.input.value), startDate: start.input.value || null, serviceIds: [...chosen] };
      if (client) await api('PATCH', `/clients/${client.id}`, body); else await api('POST', '/clients', body);
      await onChanged();
    }, close);
  });
}

async function openGoalForm(session, clientId, goal, onChanged) {
  const services = session.can['services.view'] ? await api('GET', '/services') : [];
  openSheet(goal ? 'Edit goal' : 'New goal', (close) => {
    const title = field('Goal', { name: 'title', maxlength: 200, required: true, value: goal ? goal.title : '', placeholder: 'Increase qualified organic leads' });
    const why = textareaField('Why it matters', { name: 'why', rows: 2, maxlength: 2000 }, goal ? goal.why : '');
    const target = field('Target', { name: 'target', maxlength: 200, value: goal ? goal.target : '', placeholder: '50 qualified leads a month' });
    const due = field('Target date', { name: 'dueDate', type: 'date', value: goal && goal.dueDate ? goal.dueDate : '' });
    const options = [['', 'No service'], ...services.map((s) => [s.id, s.name])];
    if (goal && goal.serviceId && !services.some((s) => s.id === goal.serviceId)) options.push([goal.serviceId, goal.serviceName]);
    const service = selectField('Service', options, goal && goal.serviceId ? goal.serviceId : '', { name: 'serviceId' });
    const status = selectField('Status', Object.entries(GOAL_STATUS_LABEL), goal ? goal.status : 'active', { name: 'status' });
    return sheetForm([title, why, h('div', { class: 'two' }, target.el, due.el), h('div', { class: 'two' }, service.el, status.el)], goal ? 'Save' : 'Add goal', async () => {
      const body = { title: title.input.value, why: why.input.value, target: target.input.value, dueDate: due.input.value || null, serviceId: service.input.value === '' ? null : Number(service.input.value), status: status.input.value };
      if (goal) await api('PATCH', `/goals/${goal.id}`, body); else await api('POST', `/clients/${clientId}/goals`, body);
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

// ---- results ----

function openResultForm(session, clientId, goals, { result, metric, unit } = {}, metrics, onChanged) {
  openSheet(result ? 'Edit result' : 'Record a result', (close) => {
    const m = field('Metric', { name: 'metric', maxlength: 80, required: true, value: result ? result.metric : metric || '', placeholder: 'Organic leads', list: 'metric-names' });
    const names = h('datalist', { id: 'metric-names' }, metrics.map((x) => h('option', { value: x.metric })));
    const value = field('Value', { name: 'value', type: 'number', step: 'any', required: true, value: result ? result.value : '' });
    const u = field('Unit', { name: 'unit', maxlength: 20, value: result ? result.unit : unit || '', placeholder: 'leads' });
    const date = field('Date (today if empty)', { name: 'recordedOn', type: 'date', value: result ? result.recordedOn : '' });
    const goal = selectField('Goal', [['', 'No goal'], ...goals.map((g) => [g.id, g.title])], result && result.goalId ? result.goalId : '', { name: 'goalId' });
    const note = field('Note', { name: 'note', maxlength: 500, value: result ? result.note : '' });
    const del = result ? confirmButton('Delete result', 'Click again to delete', async () => { await api('DELETE', `/results/${result.id}`); close(); await onChanged(); }) : null;
    return sheetForm([m, names, h('div', { class: 'two' }, value.el, u.el), date, goals.length ? goal : null, note], result ? 'Save' : 'Record', async () => {
      const body = { metric: m.input.value, value: value.input.value === '' ? null : Number(value.input.value), unit: u.input.value, goalId: goal.input.value === '' ? null : Number(goal.input.value), note: note.input.value };
      if (date.input.value) body.recordedOn = date.input.value;
      if (result) await api('PATCH', `/results/${result.id}`, body); else await api('POST', `/clients/${clientId}/results`, body);
      await onChanged();
    }, close, del);
  });
}

async function openMetric(session, clientId, summary, goals, metrics, onChanged) {
  const entries = await api('GET', `/clients/${clientId}/results?metric=${encodeURIComponent(summary.metric)}`);
  openSheet(summary.metric, (close) => h('div', { class: 'sheet-body' },
    h('div', { class: 'list-inner' }, entries.map((r) => {
      const mayEdit = r.source === 'manual' && (session.can['reports.manage'] || r.recordedById === session.user.id);
      return h(mayEdit ? 'button' : 'div', { class: `row${mayEdit ? '' : ' static'}`, type: mayEdit ? 'button' : null, onclick: mayEdit ? () => { close(); openResultForm(session, clientId, goals, { result: r }, metrics, onChanged); } : null },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, `${formatNumber(r.value)}${r.unit ? ` ${r.unit}` : ''}`), h('div', { class: 'row-sub' }, [formatDay(r.recordedOn), r.source === 'manual' ? r.recordedByName : null, r.goalTitle ? `Goal: ${r.goalTitle}` : null, r.note].filter(Boolean).join(' · '))),
        mayEdit && icon('chevron'));
    })),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { close(); openResultForm(session, clientId, goals, { metric: summary.metric, unit: summary.unit }, metrics, onChanged); } }, 'Record new value'))));
}

function metricCard(session, clientId, m, goals, metrics, rerender) {
  const change = m.change === null ? 'First reading' : `${m.change > 0 ? 'Up' : m.change < 0 ? 'Down' : 'No change'}${m.change !== 0 ? ` ${formatNumber(Math.abs(m.change))}${m.changePct === null ? '' : ` (${formatNumber(Math.abs(m.changePct))}%)`}` : ''} since ${formatDay(m.previous.recordedOn)}`;
  return h('button', { class: 'metric', type: 'button', onclick: () => openMetric(session, clientId, m, goals, metrics, rerender).catch((e) => alert(e.message)) },
    h('span', { class: 'label' }, m.metric, m.source !== 'manual' ? h('span', { class: 'pill svc' }, 'Google') : null),
    h('span', { class: 'metric-value' }, `${formatNumber(m.latest.value)}${m.unit ? ` ${m.unit}` : ''}`),
    h('span', { class: `muted metric-change${m.change > 0 ? ' up' : m.change < 0 ? ' down' : ''}` }, change),
    sparkline(m.history.map((x) => x.value)));
}

// ---- Google data ----

async function openGoogleConnect(session, client, onChanged) {
  const choices = await api('GET', '/integrations/google/choices');
  openSheet('Connect Google', (close) => {
    if (choices.length === 0) {
      return h('div', { class: 'sheet-body' }, h('p', {}, 'No Google account is connected yet. An Owner or Admin adds one under Settings, then Google.'), h('div', { class: 'sheet-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close')));
    }
    const account = selectField('Google account', choices.map((c) => [c.source, c.label]), choices[0].source, { name: 'source' });
    const search = field('Search', { name: 'search', type: 'search', placeholder: 'Search sites and properties' });
    const site = selectField('Search Console site', [['', 'None']], '', { name: 'gscSiteUrl' });
    const property = selectField('Analytics property', [['', 'None']], '', { name: 'ga4PropertyId' });
    const problems = h('div', {});
    // The lists follow the chosen account, and the search box narrows both.
    const fill = () => {
      const c = choices.find((x) => x.source === account.input.value);
      const q = search.input.value.trim().toLowerCase();
      const keep = (text) => !q || text.toLowerCase().includes(q);
      const options = (select, items, value, label) => select.input.replaceChildren(...[['', 'None'], ...items.filter((it) => keep(label(it))).map((it) => [value(it), label(it)])].map(([v, l]) => h('option', { value: v }, l)));
      options(site, c.sites, (x) => x.siteUrl, (x) => x.siteUrl);
      options(property, c.properties, (x) => x.id, (x) => `${x.name} (${x.id}), ${x.account}`);
      problems.replaceChildren(...c.problems.map((t) => h('p', { class: 'error' }, t)), ...(c.status === 'needs_reconnect' ? [h('p', { class: 'error' }, 'This account needs reconnecting. An Owner or Admin can do that under Settings.')] : []));
    };
    account.input.addEventListener('change', fill);
    search.input.addEventListener('input', fill);
    fill();
    return sheetForm([account, search, site, property], 'Connect and fetch the numbers', async () => {
      await api('PUT', `/clients/${client.id}/google`, { source: account.input.value, gscSiteUrl: site.input.value || null, ga4PropertyId: property.input.value || null });
      await onChanged();
    }, close, problems);
  });
}

function googlePanel(session, client, status, link, rerender) {
  const manage = session.can['integrations.manage'];
  if (!link && !manage) return null;
  const message = h('p', { class: 'muted' });
  const run = (fn) => async () => { message.textContent = 'Working...'; try { await fn(); } catch (err) { message.textContent = err.message; message.className = 'error'; } };
  const actions = [];
  if (manage && link) {
    actions.push(h('button', { class: 'btn-text', type: 'button', onclick: run(async () => { const r = await api('POST', `/clients/${client.id}/google/sync`, {}); message.textContent = `Fetched ${r.recorded} numbers over ${r.months} months`; await rerender(); }) }, 'Sync now'));
    actions.push(h('button', { class: 'btn-text', type: 'button', onclick: () => openGoogleConnect(session, client, rerender).catch((e) => alert(e.message)) }, 'Change'));
    actions.push(confirmButton('Disconnect', 'Click again to disconnect', async () => { await api('DELETE', `/clients/${client.id}/google`); await rerender(); }));
  } else if (manage && status.configured) {
    actions.push(h('button', { class: 'btn-text', type: 'button', onclick: () => openGoogleConnect(session, client, rerender).catch((e) => alert(e.message)) }, 'Connect Google'));
  }
  let body;
  if (link) {
    body = h('div', { class: 'stack' },
      h('dl', { class: 'facts' },
        h('dt', {}, 'Google account'), h('dd', {}, link.accountEmail || 'Service account'),
        link.gscSiteUrl ? [h('dt', {}, 'Search Console'), h('dd', {}, link.gscSiteUrl)] : null,
        link.ga4PropertyId ? [h('dt', {}, 'Analytics'), h('dd', {}, `Property ${link.ga4PropertyId}`)] : null,
        h('dt', {}, 'Last synced'), h('dd', {}, link.lastSyncAt ? `${formatWhen(link.lastSyncAt)}${link.lastSyncStatus && link.lastSyncStatus !== 'ok' ? `, ${link.lastSyncStatus === 'partial' ? 'with a problem' : 'failed'}` : ''}` : 'Not yet')),
      link.lastSyncError ? h('p', { class: 'error' }, link.lastSyncError) : null, message);
  } else if (!status.configured) {
    body = h('p', { class: 'muted' }, status.signIn && status.signIn.configured ? 'No Google account is connected yet. An Owner or Admin adds one under Settings, then Google.' : 'Google is not set up on this server. An Owner or Admin can set it up under Settings.');
  } else {
    body = h('p', { class: 'muted' }, 'Not connected. Connect Search Console and Analytics to fill results automatically.');
  }
  return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Google data'), h('div', { class: 'foot-actions' }, actions)), body, link ? null : message);
}

// A goal with its progress: how much of the work that supports it is done.
function goalCard(session, clientId, g, rerender) {
  const manage = session.can['clients.manage'];
  const { tasksTotal, tasksDone, projects } = g.progress;
  const bar = h('span', { class: 'bar-fill' });
  bar.style.width = `${tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0}%`; // from script, so the page's style rules stay strict
  return h(manage ? 'button' : 'div', { class: `goal${manage ? ' clickable' : ''}`, type: manage ? 'button' : null, onclick: manage ? () => openGoalForm(session, clientId, g, rerender).catch((e) => alert(e.message)) : null },
    h('div', { class: 'row-between' }, h('strong', {}, g.title), goalPill(g.status)),
    g.target ? h('p', { class: 'goal-line' }, `Target: ${g.target}`) : null,
    h('p', { class: 'muted' }, [g.serviceName, g.dueDate ? `by ${formatDay(g.dueDate)}` : null].filter(Boolean).join(' · ') || null),
    h('div', { class: 'bar' }, bar),
    h('p', { class: 'muted' }, tasksTotal ? `${tasksDone} of ${tasksTotal} tasks done, ${projects} ${projects === 1 ? 'project' : 'projects'}` : `No work linked yet, ${projects} ${projects === 1 ? 'project' : 'projects'}`));
}

// ---- retainer ----

function openRetainerForm(clientId, data, onChanged) {
  const r = data.retainer;
  openSheet(r ? 'Edit retainer' : 'Set up retainer', (close) => {
    const hours = field('Hours each month', { name: 'hoursAllocated', type: 'number', min: 0.25, max: 10000, step: '0.25', required: true, value: r ? r.hoursAllocated : '' });
    const start = field('Starts on', { name: 'startDate', type: 'date', required: true, value: r ? r.startDate : new Date().toISOString().slice(0, 10) });
    const off = r ? confirmButton('Switch off', 'Click again to switch off', async () => { await api('PUT', `/clients/${clientId}/retainer`, { isActive: false }); close(); await onChanged(); }) : null;
    return sheetForm([h('p', { class: 'muted' }, 'Each month runs from the start date\'s day. Only billable time that a manager has approved counts as used.'), hours, start], r ? 'Save' : 'Set up', async () => {
      await api('PUT', `/clients/${clientId}/retainer`, { hoursAllocated: Number(hours.input.value), startDate: start.input.value });
      await onChanged();
    }, close, off);
  });
}

// The hours this client has paid for, used so far this month, with a warning from 80 percent and over 100.
function retainerPanel(session, clientId, data, rerender) {
  const manage = data.canManage;
  const u = data.usage;
  const edit = manage && h('button', { class: 'btn-text', type: 'button', onclick: () => openRetainerForm(clientId, data, rerender) }, u ? 'Edit' : 'Set up retainer');
  if (!u) return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Retainer'), edit), h('p', { class: 'muted' }, 'No retainer. Set one up to track the hours this client has paid for.'));
  const bar = h('span', { class: `bar-fill${u.level === 'over' ? ' over' : u.level === 'warning' ? ' warn' : ''}` });
  bar.style.width = `${Math.min(100, u.percent)}%`; // from script, so the page's style rules stay strict
  const figure = (value, label) => h('div', { class: 'figure' }, h('span', { class: 'figure-value' }, value), h('span', { class: 'figure-label' }, label));
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Retainer'), edit),
    h('div', { class: 'row-between' }, h('span', { class: 'muted' }, `${formatDay(u.period.from)} to ${formatDay(u.period.to)}`), u.level !== 'ok' && pill('ret', u.level, u.level === 'over' ? 'Over the retainer' : 'Nearly used')),
    h('div', { class: 'bar' }, bar),
    h('div', { class: 'retainer-figures' }, figure(`${formatNumber(u.usedHours)} h`, `Used (${u.percent}%)`), figure(`${formatNumber(u.remainingHours)} h`, 'Remaining'), figure(`${formatNumber(u.allocatedHours)} h`, 'Allocated')),
    u.message && h('p', { class: u.level === 'over' ? 'error' : 'muted' }, u.message),
    u.pendingHours > 0 && h('p', { class: 'muted' }, `${formatNumber(u.pendingHours)} h more is waiting for approval and not counted yet.`));
}

async function clientPage(session, id, rerender) {
  const [c, metrics, reports, googleStatus, googleLink, retainer, timeline] = await Promise.all([
    api('GET', `/clients/${id}`),
    session.can['results.view'] ? api('GET', `/clients/${id}/metrics`) : [],
    session.can['reports.view'] ? api('GET', `/reports?clientId=${id}`) : [],
    session.can['results.view'] ? api('GET', '/integrations/google') : { configured: false },
    session.can['results.view'] ? api('GET', `/clients/${id}/google`) : null,
    session.can['retainers.view'] ? api('GET', `/clients/${id}/retainer`) : null,
    session.can['clients.view'] ? api('GET', `/clients/${id}/timeline?days=${activityDays}`).catch(() => null) : null,
  ]);
  const manage = session.can['clients.manage'];
  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Industry'), h('dd', {}, c.industry || 'Not set'),
    h('dt', {}, 'Website'), h('dd', {}, c.website || 'Not set'),
    h('dt', {}, 'Account owner'), h('dd', {}, c.accountOwnerName || 'Nobody'),
    h('dt', {}, 'Started'), h('dd', {}, c.startDate ? formatDay(c.startDate) : 'Not set'),
    h('dt', {}, 'Open projects'), h('dd', {}, String(c.openProjects)));
  const contactRow = (k) => h(manage ? 'button' : 'div', { class: `row${manage ? '' : ' static'}`, type: manage ? 'button' : null, onclick: manage ? () => openContactForm(c.id, k, rerender) : null },
    h('div', { class: 'grow' }, h('div', { class: 'row-title' }, k.name, k.isPrimary && h('span', { class: 'pill role-owner' }, 'Primary')),
      h('div', { class: 'row-sub' }, [k.roleTitle, k.email, k.phone].filter(Boolean).join(' · '))),
    manage && icon('chevron'));
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/clients' }, icon('back'), 'Clients'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, c.name), h('div', { class: 'head-meta' }, clientPill(c.status), c.services.map((s) => h('span', { class: 'pill svc' }, s.name)))),
      manage && h('button', { class: 'btn', type: 'button', onclick: () => openClientForm(session, c, rerender).catch((e) => alert(e.message)) }, 'Edit')),
    h('div', { class: 'split' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Details')), c.notes && h('p', { class: 'prose' }, c.notes), facts),
      h('div', { class: 'stack' },
        timeline && activityPanel(timeline, activityDays, (d) => { activityDays = d; rerender(); }),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Goals'), manage && h('button', { class: 'btn-text', type: 'button', onclick: () => openGoalForm(session, c.id, null, rerender).catch((e) => alert(e.message)) }, 'Add goal')),
          c.goals.length ? h('div', { class: 'goals' }, c.goals.map((g) => goalCard(session, c.id, g, rerender))) : h('p', { class: 'muted' }, 'No goals yet.')),
        retainer && retainerPanel(session, c.id, retainer, rerender),
        session.can['results.view'] && h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Results'), session.can['results.record'] && h('button', { class: 'btn-text', type: 'button', onclick: () => openResultForm(session, c.id, c.goals, {}, metrics, rerender) }, 'Record result')),
          metrics.length ? h('div', { class: 'metrics' }, metrics.map((m) => metricCard(session, c.id, m, c.goals, metrics, rerender))) : h('p', { class: 'muted' }, 'No results recorded yet.')),
        session.can['results.view'] && googlePanel(session, c, googleStatus, googleLink, rerender),
        session.can['reports.view'] && h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Reports'), session.can['reports.manage'] && h('div', { class: 'foot-actions' },
            h('button', { class: 'btn-text', type: 'button', onclick: () => openGenerate(c.id, c.name, (r) => goAfterSheets(`#/reports/${r.id}`)) }, 'Generate from data'),
            h('button', { class: 'btn-text', type: 'button', onclick: () => openReportForm(null, { clientId: c.id, clients: [{ id: c.id, name: c.name }] }, (r) => goAfterSheets(`#/reports/${r.id}`)) }, 'New report'))),
          reports.length ? h('div', { class: 'list-inner' }, reports.map((r) => h('a', { class: 'row', href: `#/reports/${r.id}` }, h('div', { class: 'grow' }, h('div', { class: 'row-title' }, r.title), h('div', { class: 'row-sub' }, `${formatDay(r.periodStart)} to ${formatDay(r.periodEnd)}`)), reportPill(r.status), icon('chevron')))) : h('p', { class: 'muted' }, 'No reports yet.')),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Contacts'), manage && h('button', { class: 'btn-text', type: 'button', onclick: () => openContactForm(c.id, null, rerender) }, 'Add contact')),
          c.contacts.length ? h('div', { class: 'list-inner' }, c.contacts.map(contactRow)) : h('p', { class: 'muted' }, 'No contacts yet.')),
        h('section', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Projects'), session.can['projects.manage'] && h('button', { class: 'btn-text', type: 'button', onclick: () => openProjectForm(session, { clientId: c.id }, rerender).catch((e) => alert(e.message)) }, 'New project')),
          c.projects.length
            ? h('div', { class: 'list-inner' }, c.projects.map((p) => h('a', { class: 'row', href: `#/projects/${p.id}` },
              h('div', { class: 'grow' }, h('div', { class: 'row-title' }, p.name), h('div', { class: 'row-sub' }, [`${p.openTasks} open tasks`, p.goalTitle ? `Goal: ${p.goalTitle}` : null].filter(Boolean).join(' · '))), projectPill(p.status), icon('chevron'))))
            : h('p', { class: 'muted' }, 'No projects yet.')))));
}

export async function clientsView(session, { param, rerender }) {
  if (param) return clientPage(session, param, rerender);
  const list = await api('GET', '/clients');
  const shown = list.filter(FILTERS[statusFilter][1]);
  const chip = (key) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(statusFilter === key), onclick: () => { statusFilter = key; rerender(); } }, FILTERS[key][0]);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Clients'),
      session.can['clients.manage'] && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openClientForm(session, null, rerender).catch((e) => alert(e.message)) }, icon('plus'), 'New client')),
    h('div', { class: 'chips' }, Object.keys(FILTERS).map(chip)),
    shown.length === 0
      ? h('section', { class: 'panel' }, emptyNote(list.length > 0, session.can['clients.manage'] ? 'No clients yet. Add your first client to start organizing agency work.' : 'No clients yet.'))
      : h('section', { class: 'panel list' }, shown.map((c) => h('a', { class: 'row', href: `#/clients/${c.id}` },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-sub' }, [c.services.map((s) => s.name).join(', '), c.industry, c.website].filter(Boolean).join(' · '))),
        h('span', { class: 'muted nowrap' }, `${c.openProjects} open projects`), clientPill(c.status), icon('chevron')))));
}
