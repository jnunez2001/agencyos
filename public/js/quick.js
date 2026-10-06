// Joshua Nunez
// The two shortcuts in the shell: Search (also the / key) and Create. Search shows what this person may see, grouped by
// kind; Create lists only what their role may add and opens the same forms the screens use.
import { h, icon, openSheet, goAfterSheets } from './dom.js';
import { api } from './api.js';
import { openEventForm } from './views/calendar.js';
import { openNoteForm } from './views/meetings.js';
import { openTaskForm } from './views/tasks.js';
import { openProjectForm } from './views/projects.js';
import { openClientForm } from './views/clients.js';
import { openRequestForm, openFollowUpForm, openDecisionForm } from './views/createforms.js';

const MIN = 2;

// ---- search ----

export function openSearch() {
  openSheet('Search', (close) => {
    const input = h('input', { class: 'input', type: 'search', name: 'q', autocomplete: 'off', placeholder: 'Search clients, projects, tasks, notes and more', 'aria-label': 'Search' });
    const hint = () => h('p', { class: 'muted pad' }, `Type at least ${MIN} characters.`);
    const out = h('div', { class: 'search-results', role: 'listbox', 'aria-label': 'Results' }, hint());
    let seq = 0;
    let timer = null;
    const open = (hash) => { goAfterSheets(hash); close(); };
    const show = (children) => out.replaceChildren(...children);
    // Looks the text up and shows the answer. Resolves to the first result, or null.
    const run = async () => {
      clearTimeout(timer);
      const q = input.value.trim();
      const mine = ++seq;
      if (q.length < MIN) { show([hint()]); return null; }
      let data;
      try { data = await api('GET', `/search?q=${encodeURIComponent(q)}`); } catch (err) {
        if (mine === seq) show([h('p', { class: 'error pad', role: 'alert' }, err.message)]);
        return null;
      }
      if (mine !== seq) return null;
      if (!data.groups.length) { show([h('p', { class: 'muted pad' }, 'Nothing found.')]); return null; }
      show(data.groups.map((g) => h('section', { class: 'search-group' }, h('h3', { class: 'label pad' }, g.label),
        g.results.map((r) => h('button', { class: 'row', type: 'button', role: 'option', 'data-hash': r.hash, onclick: () => open(r.hash) },
          h('div', { class: 'grow' }, h('div', { class: 'row-title' }, r.title), r.subtitle && h('div', { class: 'row-sub' }, r.subtitle)), icon('chevron'))))));
      return data.groups[0].results[0];
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const first = await run(); if (first) open(first.hash); }
      if (e.key === 'ArrowDown') { const next = out.querySelector('.row'); if (next) { e.preventDefault(); next.focus(); } }
    });
    out.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = [...out.querySelectorAll('.row')];
      const at = rows.indexOf(document.activeElement);
      const target = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
      e.preventDefault();
      if (target) target.focus(); else if (e.key === 'ArrowUp') input.focus();
    });
    return h('div', { class: 'sheet-body' }, input, out);
  });
}

// The / key opens search from anywhere that is not a text field or an open sheet.
export function installSearchKey(getSession) {
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !getSession()) return;
    const el = document.activeElement;
    if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
    if (document.querySelector('.sheet-backdrop')) return;
    e.preventDefault();
    openSearch();
  });
}

// ---- create ----

// What each role may start, decided by the same permission map the server uses. The server still checks.
const CREATABLE = [
  { key: 'event', label: (s) => (s.can['events.manage'] ? 'Event' : 'Block my time'), hint: (s) => (s.can['events.manage'] ? 'A meeting, review or deadline on the calendar' : 'Mark time on the calendar as busy'), show: (s) => s.can['events.view'], open: (s, done) => openEventForm(s, {}, done) },
  { key: 'note', label: () => 'Meeting notes', hint: () => 'Write up a meeting', show: (s) => s.can['notes.manage'], open: (s, done) => openNoteForm(s, {}, done) },
  { key: 'request', label: () => 'Client request', hint: () => 'Something a client asked for', show: (s) => s.can['requests.create'], open: (s, done) => openRequestForm(s, {}, done) },
  { key: 'followup', label: () => 'Follow-up', hint: () => 'A small promise to keep', show: (s) => s.can['followups.create'], open: (s, done) => openFollowUpForm(s, {}, done) },
  { key: 'task', label: () => 'Task', hint: () => 'Work for a project', show: (s) => s.can['tasks.manage'], open: (s, done) => openTaskForm(s, {}, done) },
  { key: 'project', label: () => 'Project', hint: () => 'A body of work for a client', show: (s) => s.can['projects.manage'], open: (s, done) => openProjectForm(s, {}, done) },
  { key: 'client', label: () => 'Client', hint: () => 'A new client', show: (s) => s.can['clients.manage'], open: (s, done) => openClientForm(s, null, done) },
  { key: 'decision', label: () => 'Decision', hint: () => 'Record what was decided', show: (s) => s.can['decisions.manage'], open: (s, done) => openDecisionForm(s, {}, done) },
];

export const creatableFor = (session) => CREATABLE.filter((c) => c.show(session));

export function openCreate(session, onChanged) {
  const items = creatableFor(session);
  if (!items.length) return;
  openSheet('Create', (close) => h('div', { class: 'sheet-body create-menu' }, items.map((c) =>
    h('button', { class: 'row', type: 'button', 'data-create': c.key, onclick: () => { close(); Promise.resolve(c.open(session, async () => { await onChanged(); })).catch((e) => alert(e.message)); } },
      h('div', { class: 'grow' }, h('div', { class: 'row-title' }, c.label(session)), h('div', { class: 'row-sub' }, c.hint(session))), icon('chevron')))));
}

// The two buttons. `compact` is the icon-only pair for the phone's top bar.
export function quickButtons(session, onChanged, { compact = false } = {}) {
  const create = creatableFor(session).length > 0;
  if (compact) {
    return h('div', { class: 'foot-actions' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Search', onclick: () => openSearch() }, icon('search')),
      create && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Create', onclick: () => openCreate(session, onChanged) }, icon('plus')));
  }
  return h('div', { class: 'quick' },
    h('button', { class: 'quick-search', type: 'button', 'aria-label': 'Search', onclick: () => openSearch() }, icon('search'), h('span', { class: 'grow' }, 'Search'), h('kbd', {}, '/')),
    create && h('button', { class: 'btn btn-primary quick-create', type: 'button', 'aria-label': 'Create', onclick: () => openCreate(session, onChanged) }, icon('plus'), 'Create'));
}
