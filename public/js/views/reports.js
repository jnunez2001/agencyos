// Joshua Nunez
// Reports: the list, a report page (copy and print), the edit form and the generate sheet.
import { h, icon, openSheet, goAfterSheets } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, confirmButton, pill, formatDay, formatWhen } from '../ui.js';

const SECTIONS = [
  ['executiveSummary', 'Executive summary'], ['workCompleted', 'Work completed'], ['keyResults', 'Key results'], ['importantChanges', 'Important changes'],
  ['problemsRisks', 'Problems and risks'], ['nextPriorities', 'Next priorities'], ['recommendations', 'Recommendations'],
];
const STATUS_LABEL = { draft: 'Draft', approved: 'Approved' };
export const reportPill = (s) => pill('rs', s, STATUS_LABEL[s] || s);
let statusFilter = 'all';
let clientFilter = '';

const period = (r) => `${formatDay(r.periodStart)} to ${formatDay(r.periodEnd)}`;

// The whole report as plain text, for pasting into an email or a document.
export function reportText(r) {
  return [r.title, `${r.clientName}, ${period(r)}`, '', ...SECTIONS.flatMap(([key, label]) => [label.toUpperCase(), r.sections[key] || '(not written)', ''])].join('\n').trim();
}

export function openReportForm(report, { clientId, clients }, onSaved) {
  openSheet(report ? 'Edit report' : 'New report', (close) => {
    const title = field('Title', { name: 'title', maxlength: 160, required: true, value: report ? report.title : '' });
    const start = field('Period start', { name: 'periodStart', type: 'date', required: true, value: report ? report.periodStart : '' });
    const end = field('Period end', { name: 'periodEnd', type: 'date', required: true, value: report ? report.periodEnd : '' });
    const client = report ? null : selectField('Client', clients.map((c) => [c.id, c.name]), clientId || (clients[0] && clients[0].id), { name: 'clientId' });
    const areas = Object.fromEntries(SECTIONS.map(([key, label]) => [key, textareaField(label, { name: key, rows: key === 'executiveSummary' ? 4 : 6, maxlength: 10000 }, report ? report.sections[key] : '')]));
    return sheetForm([title, client, h('div', { class: 'two' }, start.el, end.el), ...SECTIONS.map(([key]) => areas[key])], report ? 'Save' : 'Create report', async () => {
      const body = { title: title.input.value, periodStart: start.input.value, periodEnd: end.input.value, ...Object.fromEntries(SECTIONS.map(([key]) => [key, areas[key].input.value])) };
      if (report) await onSaved(await api('PATCH', `/reports/${report.id}`, body));
      else await onSaved(await api('POST', '/reports', { ...body, clientId: Number(client.input.value) }));
    }, close);
  });
}

// The previous calendar month, as the period most reports cover.
function lastMonth() {
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

export function openGenerate(clientId, clientName, onDone) {
  const [from, to] = lastMonth();
  openSheet(`Generate a report for ${clientName}`, (close) => {
    const start = field('Period start', { name: 'periodStart', type: 'date', required: true, value: from });
    const end = field('Period end', { name: 'periodEnd', type: 'date', required: true, value: to });
    const title = field('Title (optional)', { name: 'title', maxlength: 160 });
    return sheetForm([h('div', { class: 'two' }, start.el, end.el), title], 'Generate draft', async () => {
      const body = { periodStart: start.input.value, periodEnd: end.input.value };
      if (title.input.value.trim()) body.title = title.input.value;
      await onDone(await api('POST', `/clients/${clientId}/reports/generate`, body));
    }, close, h('p', { class: 'muted' }, 'Fills in the work, results, risks and priorities from Nexus. You or your AI write the summary and recommendations.'));
  });
}

async function reportPage(session, id, rerender) {
  const r = await api('GET', `/reports/${id}`);
  const manage = session.can['reports.manage'];
  const copy = h('button', { class: 'btn', type: 'button' }, 'Copy as text');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(reportText(r)); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select the text and copy it by hand'; }
  });
  const error = h('div', { class: 'error', role: 'alert' });
  const approve = session.can['reports.approve'] && r.status === 'draft'
    ? h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { error.textContent = ''; try { await api('POST', `/reports/${r.id}/approve`, {}); await rerender(); } catch (err) { error.textContent = err.message; } } }, 'Approve')
    : null;
  const del = manage && r.status === 'draft' ? confirmButton('Delete draft', 'Click again to delete', async () => { await api('DELETE', `/reports/${r.id}`); location.hash = '#/reports'; }) : null;
  return h('div', { class: 'page report' },
    h('a', { class: 'back no-print', href: '#/reports' }, icon('back'), 'Reports'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, r.title),
      h('div', { class: 'head-meta' }, reportPill(r.status), h('span', { class: 'muted' }, `${r.clientName}, ${period(r)}`), r.approvedByName ? h('span', { class: 'muted' }, `Approved by ${r.approvedByName}, ${formatWhen(r.approvedAt)}`) : null)),
      h('div', { class: 'head-actions no-print' }, copy, h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print'),
        manage && h('button', { class: 'btn', type: 'button', onclick: () => openReportForm(r, {}, async () => { await rerender(); }) }, 'Edit'), approve)),
    error,
    h('section', { class: 'panel report-body' }, SECTIONS.map(([key, label]) => h('div', { class: 'report-section' },
      h('h2', {}, label), r.sections[key] ? h('p', { class: 'prose' }, r.sections[key]) : h('p', { class: 'muted' }, 'Not written yet.')))),
    del && h('div', { class: 'no-print' }, del));
}

export async function reportsView(session, { param, rerender }) {
  if (param) return reportPage(session, param, rerender);
  const query = new URLSearchParams();
  if (statusFilter !== 'all') query.set('status', statusFilter);
  if (clientFilter) query.set('clientId', clientFilter);
  const [list, clients] = await Promise.all([api('GET', `/reports?${query}`), api('GET', '/clients')]);
  const chip = (key, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(statusFilter === key), onclick: () => { statusFilter = key; rerender(); } }, label);
  const clientSel = selectField('Client', [['', 'All clients'], ...clients.map((c) => [c.id, c.name])], clientFilter, { 'aria-label': 'Client' });
  clientSel.input.addEventListener('change', () => { clientFilter = clientSel.input.value; rerender(); });
  const manage = session.can['reports.manage'];
  const open = (r) => goAfterSheets(`#/reports/${r.id}`);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Reports'),
      manage && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openReportForm(null, { clients }, open) }, icon('plus'), 'New report')),
    h('div', { class: 'toolbar' }, h('div', { class: 'chips' }, chip('all', 'All'), chip('draft', 'Drafts'), chip('approved', 'Approved')), clientSel.el),
    list.length === 0
      ? h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'No reports here.'))
      : h('section', { class: 'panel list' }, list.map((r) => h('a', { class: 'row', href: `#/reports/${r.id}` },
        h('div', { class: 'grow' }, h('div', { class: 'row-title' }, r.title), h('div', { class: 'row-sub' }, `${r.clientName}, ${period(r)}`)), reportPill(r.status), icon('chevron')))));
}
