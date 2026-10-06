// Joshua Nunez
// The shell: routing, the sidebar and bottom bar, and which screen is showing.
import { h, icon } from './dom.js';
import { api, setCsrf } from './api.js';
import { avatar } from './ui.js';
import { setupView, loginView, changePasswordView, SIGN_IN_PROBLEMS } from './views/auth.js';
import { dashboardView } from './views/dashboard.js';
import { teamView } from './views/team.js';
import { profileView } from './views/profile.js';
import { settingsView } from './views/settings.js';
import { activityView } from './views/activity.js';
import { aiView } from './views/ai.js';
import { connectView } from './views/connect.js';
import { sopsView } from './views/sops.js';
import { qaView } from './views/qa.js';
import { reportsView } from './views/reports.js';
import { googleResultView } from './views/googleresult.js';
import { calendarView } from './views/calendar.js';
import { meetingsView } from './views/meetings.js';
import { requestsView } from './views/requests.js';
import { timeView } from './views/time.js';
import { tasksView } from './views/tasks.js';
import { projectsView } from './views/projects.js';
import { clientsView } from './views/clients.js';
import { visibleNav, bottomNav } from './nav.js';
import { quickButtons, installSearchKey } from './quick.js';

const root = document.getElementById('app');
let session = null;

const VIEWS = { dashboard: dashboardView, calendar: calendarView, meetings: meetingsView, time: timeView, requests: requestsView, tasks: tasksView, projects: projectsView, clients: clientsView, ai: aiView, connect: connectView, sops: sopsView, qa: qaView, reports: reportsView, google: googleResultView, team: teamView, activity: activityView, settings: settingsView, profile: profileView };

function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('agencyos-theme', next); } catch { /* storage unavailable */ }
  render();
}

async function refreshSession() {
  session = await api('GET', '/session');
  setCsrf(session.csrf);
}

async function signOut() {
  await api('POST', '/logout', {}).catch(() => {});
  session = null;
  setCsrf('');
  location.hash = '';
  boot();
}

// '#/projects/12' is the projects screen with the parameter '12'.
function route() {
  const [key, param, extra] = location.hash.replace(/^#\/?/, '').split('/');
  const allowed = [...visibleNav(session).map((n) => n.key), 'profile', 'connect', 'google'];
  if (allowed.includes(key || 'dashboard')) return { key: key || 'dashboard', param: param || '', extra: extra || '' };
  // A screen this person may not use: show the dashboard and fix the address so Back does not loop.
  history.replaceState(null, '', '#/dashboard');
  return { key: 'dashboard', param: '', extra: '' };
}

function shell(key, main) {
  const items = visibleNav(session);
  const link = (n, active) => h('a', { class: `nav-link${active ? ' active' : ''}`, href: `#/${n.key}`, 'aria-current': active ? 'page' : null }, icon(n.icon), h('span', {}, n.label));
  const me = { id: session.user.id, displayName: session.user.displayName };
  return h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand-mark' }, h('img', { class: 'brand-logo', src: '/logo.png', alt: '', width: 24, height: 24 }), h('span', {}, 'NexusOS')),
      quickButtons(session, render),
      h('p', { class: 'org-name' }, session.organization.name),
      h('nav', { 'aria-label': 'Main' }, items.map((n) => link(n, n.key === key))),
      h('div', { class: 'sidebar-foot' },
        h('a', { class: `me${key === 'profile' ? ' active' : ''}`, href: '#/profile' }, avatar(me, 'sm'), h('span', {}, session.user.displayName)),
        h('div', { class: 'foot-actions' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': currentTheme() === 'dark' ? 'Use light mode' : 'Use dark mode', onclick: toggleTheme }, icon(currentTheme() === 'dark' ? 'sun' : 'moon')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sign out', onclick: signOut }, icon('logout'))))),
    h('div', { class: 'content' },
      h('header', { class: 'topbar' }, h('div', { class: 'brand-mark' }, h('img', { class: 'brand-logo', src: '/logo.png', alt: '', width: 24, height: 24 }), h('span', {}, 'NexusOS')),
        h('div', { class: 'foot-actions' },
          quickButtons(session, render, { compact: true }),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Toggle dark mode', onclick: toggleTheme }, icon(currentTheme() === 'dark' ? 'sun' : 'moon')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sign out', onclick: signOut }, icon('logout')))),
      main),
    h('nav', { class: 'bottom-nav', 'aria-label': 'Main' }, [...bottomNav(session).map((n) => link(n, n.key === key)),
      h('a', { class: `nav-link${key === 'profile' ? ' active' : ''}`, href: '#/profile', 'aria-current': key === 'profile' ? 'page' : null }, icon('user'), h('span', {}, 'Me'))]));
}

let renderSeq = 0;
async function render() {
  if (!session) return;
  const seq = ++renderSeq;
  const { key, param, extra } = route();
  const main = h('main', { class: 'main' });
  try {
    main.append(await VIEWS[key](session, { param, extra, rerender: render, refresh: async () => { await refreshSession(); await render(); } }));
  } catch (err) {
    if (err.status === 401) return boot();
    if (err.code === 'must_change_password') return boot();
    const again = err.network || err.status >= 500 ? h('button', { class: 'btn', type: 'button', onclick: render }, 'Try again') : null;
    main.append(h('section', { class: 'panel' }, h('p', { class: 'muted' }, err.message), again));
  }
  if (seq !== renderSeq) return; // a newer render replaced this one
  root.replaceChildren(shell(key, main));
  window.scrollTo(0, 0);
}

// A Google sign-in that failed sends the person back with a short code in the address. Show it once, then tidy the address.
function signInNotice() {
  const m = /^#\/signin-failed\/([a-z-]+)$/.exec(location.hash);
  if (!m) return '';
  history.replaceState(null, '', location.pathname);
  return SIGN_IN_PROBLEMS[m[1]] || 'The Google sign-in did not work. Try again.';
}

async function boot() {
  try {
    const status = await api('GET', '/status');
    if (status.needsSetup) return void root.replaceChildren(setupView(status, boot));
    try {
      await refreshSession();
    } catch (err) {
      if (err.status === 401) return void root.replaceChildren(loginView(boot, { googleSignIn: !!status.googleSignIn, notice: signInNotice() }));
      throw err;
    }
    if (session.user.mustChangePassword) return void root.replaceChildren(changePasswordView(session, boot, signOut));
    render();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Cannot reach the server'), h('p', { class: 'muted' }, err.message), h('button', { class: 'btn btn-primary', type: 'button', onclick: boot }, 'Try again'))));
  }
}

installSearchKey(() => session);
window.addEventListener('hashchange', render);
boot();
