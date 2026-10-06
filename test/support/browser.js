// Joshua Nunez
// A simulated browser for the front-end smoke tests: the real index.html and real modules run in jsdom, and the
// server is replaced by canned answers for one role. Nothing here talks to the network.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PUBLIC = path.resolve(__dirname, '..', '..', 'public');

const ROLES = ['owner', 'admin', 'manager', 'employee', 'contractor'];
const CAN = {
  owner: { 'org.view': 1, 'org.update': 1, 'members.list': 1, 'members.create': 1, 'members.manage': 1, 'profile.edit_others': 1, 'profile.edit_self': 1, 'activity.view': 1, 'dashboard.team': 1 },
  manager: { 'org.view': 1, 'members.list': 1, 'profile.edit_self': 1, 'dashboard.team': 1 },
  employee: { 'org.view': 1, 'members.list': 1, 'profile.edit_self': 1 },
  contractor: { 'org.view': 1, 'profile.edit_self': 1 },
};
CAN.admin = CAN.owner;

const PEOPLE = [
  { id: 1, username: 'josh', displayName: 'Josh Nunez', role: 'owner', isActive: true, jobTitle: 'Founder', department: '', mustChangePassword: false },
  { id: 2, username: 'rayne', displayName: 'Rayne', role: 'admin', isActive: true, jobTitle: '', department: 'Operations', mustChangePassword: false },
  { id: 3, username: 'mark', displayName: 'Mark Cruz', role: 'manager', isActive: true, jobTitle: 'Delivery Manager', department: '', mustChangePassword: true },
  { id: 4, username: 'sarah', displayName: 'Sarah', role: 'employee', isActive: false, jobTitle: '', department: 'SEO', mustChangePassword: false },
];
const RANK = { owner: 5, admin: 4, manager: 3, employee: 2, contractor: 1 };

function answers(role, { mustChange = false, empty = false } = {}) {
  const can = Object.fromEntries(Object.keys(CAN.owner).map((k) => [k, !!CAN[role][k]]));
  const me = { id: role === 'owner' ? 1 : 3, username: role === 'owner' ? 'josh' : 'mark', displayName: role === 'owner' ? 'Josh Nunez' : 'Mark Cruz', mustChangePassword: mustChange };
  const assignable = role === 'owner' ? ROLES : role === 'admin' ? ['manager', 'employee', 'contractor'] : [];
  const profile = { userId: me.id, username: me.username, displayName: me.displayName, role, jobTitle: 'Delivery Manager', department: 'Operations', timezone: 'Asia/Manila', workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '17:00', weeklyCapacityHours: 40 };
  return (method, url) => {
    const [pathname] = url.split('?');
    if (pathname === '/status') return { needsSetup: false, setupCodeRequired: false };
    if (pathname === '/session') return { user: me, organization: { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' }, role, csrf: 'csrf-token', can, assignableRoles: assignable };
    if (pathname === '/org') return { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' };
    if (pathname === '/dashboard') return { organization: { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' }, me: { id: me.id, displayName: me.displayName, role }, team: can['dashboard.team'] ? { total: 4, active: 3, byRole: { owner: 1, admin: 1, manager: 1, employee: 0, contractor: 0 }, mustChangePassword: 1 } : null };
    if (pathname === '/members') return empty ? [] : PEOPLE.map((p) => ({ ...p, canManage: can['members.manage'] && (role === 'owner' || RANK[role] > RANK[p.role]), ...(can['members.manage'] ? {} : { mustChangePassword: undefined }) }));
    if (/^\/members\/\d+\/profile$/.test(pathname) || pathname === '/profile') return pathname === '/profile' ? profile : { ...profile, userId: 3, username: 'mark', displayName: 'Mark Cruz' };
    if (pathname === '/activity') return empty ? [] : [
      { id: 3, action: 'member.update', objectType: 'member', objectId: 4, actorId: 1, actorName: 'Josh Nunez', before: { role: 'employee', isActive: true }, after: { role: 'manager', isActive: false }, source: 'web', createdAt: new Date().toISOString() },
      { id: 2, action: 'profile.update', objectType: 'member', objectId: 3, actorId: 3, actorName: 'Mark Cruz', before: { workDays: [1, 2] }, after: { workDays: [1, 2, 3] }, source: 'web', createdAt: '2026-10-01T08:00:00.000Z' },
      { id: 1, action: 'something.new', objectType: null, objectId: null, actorId: null, actorName: 'System', before: null, after: null, source: 'system', createdAt: '2026-09-01T08:00:00.000Z' },
    ];
    return { ok: true };
  };
}

// Builds the page, runs the app, and returns helpers. `calls` records every request the screens made.
async function openApp(role, options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, ''), { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {}; // jsdom does not implement scrolling
  const calls = [];
  const errors = [];
  const answer = answers(role, options);
  const fetchStub = async (url, init = {}) => {
    const method = init.method || 'GET';
    const apiPath = String(url).replace(/^\/api/, '');
    calls.push({ method, path: apiPath, csrf: init.headers && init.headers['x-csrf-token'], body: init.body ? JSON.parse(init.body) : undefined });
    const body = (options.respond && options.respond(method, apiPath)) || answer(method, apiPath);
    if (body && body.__status) return { ok: false, status: body.__status, json: async () => ({ error: body.error, code: body.code }) };
    return { ok: true, status: 200, json: async () => body };
  };
  Object.assign(globalThis, { window, document: window.document, history: window.history, location: window.location, fetch: fetchStub, alert: (m) => errors.push(`alert: ${m}`) });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  window.addEventListener('error', (e) => errors.push(e.message));
  process.on('unhandledRejection', (err) => errors.push(`unhandled: ${err && err.message}`));
  const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  const go = async (hash) => { window.location.hash = hash; await wait(120); };
  return { window, document: window.document, calls, errors, wait, go, main: () => window.document.querySelector('.main') };
}

// Words that mean a value leaked into the screen instead of being shown.
const STRAY = /\b(undefined|NaN|null)\b|\[object|(^|\s)false(\s|$)/;
const strayText = (el) => (STRAY.test(el.textContent || '') ? el.textContent.match(STRAY)[0].trim() : null);

module.exports = { openApp, strayText, ROLES };
