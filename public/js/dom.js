// Joshua Nunez
// Tiny DOM helpers. Text always goes in as text nodes, never as HTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  // Falsy children (from `cond && h(...)`) are skipped, so they never print as the word "false".
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.6-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c3 0 5 2 5 5.2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  projects: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clients: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  qa: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  sops: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10M9 8h5"/>',
  reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7M9 9h2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  inbox: '<path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
};

// The logo that reads well on the current theme: slate and blue on light screens, paler on dark ones.
export const logoSrc = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? '/logo-dark.png' : '/logo.png');

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

// Sheets and the phone's Back button. While any sheet is open there is one extra history entry, so Back closes the
// sheet instead of leaving the page.
const openSheets = [];
let hasEntry = false;
let ignorePop = 0;
let backTimer = null;
let afterQueue = [];

function flushAfter() {
  const queue = afterQueue;
  afterQueue = [];
  queue.forEach((fn) => fn());
}

// Go to another page once the open sheets have finished closing. Changing the address while a sheet is still
// closing would be undone by the step back that removes the sheet's history entry.
export function goAfterSheets(hash) {
  const go = () => { location.hash = hash; };
  if (openSheets.length === 0 && !hasEntry && ignorePop === 0) go(); else afterQueue.push(go);
}

function addEntry() {
  if (hasEntry) return;
  try { history.pushState({ sheet: true }, ''); hasEntry = true; } catch { /* history unavailable */ }
}

function dropEntrySoon() {
  clearTimeout(backTimer);
  backTimer = setTimeout(() => {
    if (openSheets.length === 0 && hasEntry) { hasEntry = false; ignorePop += 1; history.back(); } else if (openSheets.length === 0) flushAfter();
  }, 0);
}

window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop -= 1; if (ignorePop === 0) flushAfter(); return; }
  if (openSheets.length === 0) return;
  hasEntry = false;
  openSheets[openSheets.length - 1].close({ fromBack: true });
  if (openSheets.length === 0) flushAfter();
  if (openSheets.length > 0) addEntry();
});

export function openSheet(title, build) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const entry = { close: null };
  let closed = false;
  const close = (opts) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    const i = openSheets.indexOf(entry);
    if (i >= 0) openSheets.splice(i, 1);
    if (!(opts && opts.fromBack) && openSheets.length === 0) dropEntrySoon();
  };
  entry.close = close;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    build(close));
  backdrop.append(sheet);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  openSheets.push(entry);
  clearTimeout(backTimer);
  addEntry();
  const first = sheet.querySelector('input:not([type=checkbox]), select');
  if (first) first.focus();
  return close;
}
