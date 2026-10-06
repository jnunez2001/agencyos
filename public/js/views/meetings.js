// Joshua Nunez
// Meeting notes: the list, a note page, and the write form. A note may belong to a calendar event.
import { h, icon, openSheet, goAfterSheets } from '../dom.js';
import { api } from '../api.js';
import { field, selectField, textareaField, sheetForm, confirmButton, pill, formatDay } from '../ui.js';
import { tabBar, decisionsPage, followUpsPage } from './records.js';

const STATUS_LABEL = { draft: 'Draft', final: 'Final' };
const SECTION_LABEL = [['summary', 'Summary'], ['agenda', 'Agenda'], ['discussion', 'Discussion'], ['decisions', 'Decisions'], ['requests', 'Requests'], ['followUps', 'Follow-ups']];
const statusPill = (s) => pill('ns', s, STATUS_LABEL[s] || s);
const filters = { status: '', clientId: '', q: '' };
const decisionState = { status: '' };
const followUpState = { show: 'open' };

// Write a new note (for an event, or on its own) or change one. `onSaved` gets the saved note.
export async function openNoteForm(session, { note, event } = {}, onSaved) {
  const manage = session.can['notes.manage'];
  const clients = session.can['clients.view'] && !event ? await api('GET', '/clients') : [];
  openSheet(note ? 'Edit meeting notes' : 'New meeting notes', (close) => {
    const base = note || {};
    const title = field('Title', { name: 'title', maxlength: 200, required: true, value: base.title || (event ? event.title : '') });
    const dayOfEvent = event ? (event.allDay ? event.startsAt : (() => { const d = new Date(event.startsAt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()) : '';
    const date = field('Date', { name: 'meetingDate', type: 'date', required: true, value: base.meetingDate || dayOfEvent || new Date().toISOString().slice(0, 10) });
    const client = !event && !note?.eventId && clients.length ? selectField('Client', [['', 'No client'], ...clients.map((c) => [c.id, c.name])], base.clientId || '', { name: 'clientId' }) : null;
    const sections = SECTION_LABEL.map(([key, label]) => textareaField(label, { name: key, maxlength: 20000, rows: key === 'discussion' ? 6 : 3 }, base[key] || ''));
    const transcript = textareaField('Transcript or rough notes (for your AI to read)', { name: 'transcript', maxlength: 100000, rows: 5 }, base.transcript || '');
    const status = note && manage ? selectField('Status', Object.entries(STATUS_LABEL), note.status, { name: 'status' }) : null;
    return sheetForm([title, date, client, ...sections, transcript, status], note ? 'Save' : 'Add notes', async () => {
      const body = { title: title.input.value, meetingDate: date.input.value };
      for (const [i, [key]] of SECTION_LABEL.entries()) body[key] = sections[i].input.value;
      body.transcript = transcript.input.value;
      if (client) body.clientId = client.input.value === '' ? null : Number(client.input.value);
      if (status) body.status = status.input.value;
      if (event) body.eventId = event.id;
      const saved = note ? await api('PATCH', `/meeting-notes/${note.id}`, body) : await api('POST', '/meeting-notes', body);
      await onSaved(saved);
    }, close);
  });
}

// A ready prompt for the person's connected AI. The AI reads the brief and drafts; a person approves and finalizes.
async function copyPrompt(n) {
  const text = `Process meeting note #${n.id} ("${n.title}") in Nexus. Call get_meeting_brief with noteId ${n.id}, read the transcript, then use update_meeting_note to fill the summary, discussion, decisions, requests and follow-ups (one per line), and create_records_from_note to turn them into records. Do not repeat anything already open. I will review and finalize.`;
  try { await navigator.clipboard.writeText(text); alert('Copied. Paste it into your connected AI.'); } catch { alert(text); }
}

async function notePage(session, id, rerender) {
  const n = await api('GET', `/meeting-notes/${id}`);
  const link = (href, text) => (session.can['projects.view'] ? h('a', { class: 'link', href }, text) : text);
  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Date'), h('dd', {}, formatDay(n.meetingDate)),
    n.clientName && h('dt', {}, 'Client'), n.clientName && h('dd', {}, session.can['clients.view'] ? h('a', { class: 'link', href: `#/clients/${n.clientId}` }, n.clientName) : n.clientName),
    n.projectName && h('dt', {}, 'Project'), n.projectName && h('dd', {}, link(`#/projects/${n.projectId}`, n.projectName)),
    n.eventId && h('dt', {}, 'Event'), n.eventId && h('dd', {}, h('a', { class: 'link', href: '#/calendar' }, 'On the calendar')),
    h('dt', {}, 'Written by'), h('dd', {}, n.createdByName || 'Unknown'),
    n.status === 'final' && h('dt', {}, 'Finalized'), n.status === 'final' && h('dd', {}, n.finalizedByName || ''));
  const sections = SECTION_LABEL.filter(([key]) => n[key]).map(([key, label]) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, label)), h('p', { class: 'prose' }, n[key])));
  const act = (fn) => async () => { try { await fn(); await rerender(); } catch (e) { alert(e.message); } };
  const made = n.canFinalize ? await api('GET', `/meeting-notes/${n.id}/records`).catch(() => null) : null;
  const hasLines = ['decisions', 'requests', 'followUps'].some((k) => n[k] && n[k].trim());
  const recordsPanel = made && hasLines && h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Records from these notes')),
    h('p', { class: 'muted' }, `Each line of Decisions, Requests and Follow-ups becomes a record linked to this meeting. Made so far: ${made.decisions} decisions, ${made.requests} requests, ${made.followUps} follow-ups. Lines already turned into a record are skipped.`),
    h('div', { class: 'note-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: act(async () => {
      const out = await api('POST', `/meeting-notes/${n.id}/records`, {});
      const c = out.created;
      alert(`Created ${c.decisions.length} decisions, ${c.requests.length} requests and ${c.followUps.length} follow-ups.`);
    }) }, 'Create records')));
  return h('div', { class: 'page' },
    h('a', { class: 'back', href: '#/meetings' }, icon('back'), 'Meetings'),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, n.title), h('div', { class: 'head-meta' }, statusPill(n.status), n.aiDrafted && pill('ns', 'ai', 'AI draft, please review'))),
      h('div', { class: 'head-actions' },
        n.canEdit && n.transcript && h('button', { class: 'btn', type: 'button', onclick: () => copyPrompt(n) }, 'Copy AI prompt'),
        n.canEdit && h('button', { class: 'btn', type: 'button', onclick: () => openNoteForm(session, { note: n }, rerender).catch((e) => alert(e.message)) }, 'Edit'),
        n.canFinalize && n.status === 'draft' && h('button', { class: 'btn btn-primary', type: 'button', onclick: act(() => api('PATCH', `/meeting-notes/${n.id}`, { status: 'final' })) }, 'Mark final'),
        n.canFinalize && n.status === 'final' && h('button', { class: 'btn', type: 'button', onclick: act(() => api('PATCH', `/meeting-notes/${n.id}`, { status: 'draft' })) }, 'Reopen'),
        n.canDelete && confirmButton('Delete', 'Confirm delete', async () => { try { await api('DELETE', `/meeting-notes/${n.id}`); goAfterSheets('#/meetings'); } catch (e) { alert(e.message); } }))),
    h('section', { class: 'panel' }, facts),
    sections.length ? sections : h('p', { class: 'muted pad' }, 'Nothing written yet.'),
    n.transcript && h('details', { class: 'panel' }, h('summary', {}, 'Transcript'), h('p', { class: 'prose' }, n.transcript)),
    recordsPanel);
}

export async function meetingsView(session, { param, rerender }) {
  if (param === 'decisions' && session.can['decisions.view']) return decisionsPage(session, rerender, decisionState);
  if (param === 'follow-ups') return followUpsPage(session, rerender, followUpState);
  if (param) return notePage(session, param, rerender);
  const clients = session.can['clients.view'] ? await api('GET', '/clients') : [];
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  const list = await api('GET', `/meeting-notes${query.size ? `?${query}` : ''}`);
  const statusChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Status' }, [['', 'All'], ['draft', 'Draft'], ['final', 'Final']].map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filters.status === v), onclick: () => { filters.status = v; rerender(); } }, l)));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search notes', 'aria-label': 'Search notes', value: filters.q });
  search.addEventListener('change', () => { filters.q = search.value.trim(); rerender(); });
  const clientPick = clients.length ? h('select', { class: 'input', 'aria-label': 'Client', onchange: (e) => { filters.clientId = e.target.value; rerender(); } }, [h('option', { value: '' }, 'All clients'), ...clients.map((c) => h('option', { value: c.id, selected: String(c.id) === String(filters.clientId) }, c.name))]) : null;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, 'Meetings')),
      session.can['notes.manage'] && h('div', { class: 'head-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openNoteForm(session, {}, (n) => goAfterSheets(`#/meetings/${n.id}`)).catch((e) => alert(e.message)) }, icon('plus'), 'New notes'))),
    tabBar(session, 'notes'), statusChips,
    h('div', { class: 'filters' }, search, clientPick),
    h('section', { class: 'panel list' }, list.length ? list.map((n) => h('a', { class: 'row', href: `#/meetings/${n.id}` },
      h('div', { class: 'grow' }, h('div', { class: 'row-title' }, n.title), h('div', { class: 'row-sub' }, [formatDay(n.meetingDate), n.clientName].filter(Boolean).join(', '))),
      statusPill(n.status), icon('chevron'))) : h('p', { class: 'muted pad' }, 'No meeting notes yet. Open an event on the calendar and choose Add meeting notes.')));
}
