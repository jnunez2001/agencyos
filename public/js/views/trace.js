// Joshua Nunez
// Traceability on screen: "Where this came from" for a task or a request, and "Recent activity" for a client.
import { h, goAfterSheets } from '../dom.js';
import { formatWhen, formatDay } from '../ui.js';

const WHEN = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days' };

// A link that opens another page. Inside a sheet it closes the sheet first.
function linkTo(hash, text, close) {
  return h('a', { class: 'link', href: hash, onclick: close ? (e) => { e.preventDefault(); close(); goAfterSheets(hash); } : null }, text);
}

// The chain a task came from, from the answer of GET /tasks/:id/trace. Leaves out what the viewer may not see.
export function traceSection(session, trace, { close } = {}) {
  const t = trace || {};
  const rows = [];
  const add = (label, ...value) => rows.push(h('dt', {}, label), h('dd', {}, ...value));
  const joined = (list, text) => list.flatMap((x, i) => [i ? ', ' : null, linkTo(x.hash, text(x), close)]).filter((x) => x !== null);
  if (t.request) add('Client request', linkTo(t.request.hash, t.request.title, close));
  if (t.meetingNote) add('Meeting notes', linkTo(t.meetingNote.hash, t.meetingNote.date ? `${t.meetingNote.title}, ${formatDay(t.meetingNote.date)}` : t.meetingNote.title, close));
  if (t.event) add('Meeting', linkTo(t.event.hash, t.event.title, close));
  if (t.decisions && t.decisions.length) add('Decisions', ...joined(t.decisions, (d) => d.title));
  if (t.followUps && t.followUps.length) add('Follow-ups', ...joined(t.followUps, (f) => f.title));
  if (t.sop) add('SOP', t.sop.hash ? linkTo(t.sop.hash, `${t.sop.title} v${t.sop.version}`, close) : `${t.sop.title} v${t.sop.version}`);
  if (t.timeEntries && t.timeEntries.count > 0) add(t.timeEntries.scope === 'team' ? 'Time logged' : 'Your time', `${t.timeEntries.hours} hours in ${t.timeEntries.count} ${t.timeEntries.count === 1 ? 'entry' : 'entries'}${t.timeEntries.scope === 'team' ? `, ${t.timeEntries.approvedHours} approved` : ''}`);
  if (!rows.length) {
    if (!session.can['requests.view']) return null;
    return h('section', { class: 'trace-block' }, h('h3', { class: 'section-title' }, 'Where this came from'), h('p', { class: 'muted' }, 'Made directly. It does not link back to a request or a meeting.'));
  }
  return h('section', { class: 'trace-block' }, h('h3', { class: 'section-title' }, 'Where this came from'), h('dl', { class: 'facts' }, rows));
}

// "Recent activity" on a client page, from the answer of GET /clients/:id/timeline.
export function activityPanel(timeline, days, onDays) {
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Period' }, Object.keys(WHEN).map((d) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(Number(d) === days), onclick: () => onDays(Number(d)) }, `${d} days`)));
  const groups = timeline && Array.isArray(timeline.groups) ? timeline.groups : [];
  const body = groups.length
    ? h('div', { class: 'stack' }, groups.map((g) => h('div', {},
      h('h4', { class: 'mini-title' }, g.label),
      h('div', { class: 'list-inner' }, g.items.map((i) => h('a', { class: 'row', href: i.hash }, h('div', { class: 'grow' }, h('div', { class: 'row-title' }, i.title)), h('span', { class: 'muted nowrap' }, formatWhen(i.at))))))))
    : h('p', { class: 'muted' }, `Nothing has happened for this client in the ${WHEN[days] || `last ${days} days`}.`);
  return h('section', { class: 'panel activity-panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Recent activity')), chips, body);
}
