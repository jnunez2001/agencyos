// Joshua Nunez
// A simulated browser for the front-end smoke tests: the real index.html and real modules run in jsdom, and the
// server is replaced by canned answers for one role. Nothing here talks to the network.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PUBLIC = path.resolve(__dirname, '..', '..', 'public');

const ROLES = ['owner', 'admin', 'manager', 'employee', 'contractor'];
const WORK = { 'clients.view': 1, 'clients.manage': 1, 'projects.view': 1, 'projects.manage': 1, 'tasks.view': 1, 'tasks.manage': 1, 'tasks.work': 1, 'dashboard.agency': 1 };
const CAN = {
  owner: { 'org.view': 1, 'org.update': 1, 'members.list': 1, 'members.create': 1, 'members.manage': 1, 'profile.edit_others': 1, 'profile.edit_self': 1, 'activity.view': 1, 'dashboard.team': 1, 'ai.manage': 1, 'ai.approve': 1, ...WORK },
  manager: { 'org.view': 1, 'members.list': 1, 'profile.edit_self': 1, 'dashboard.team': 1, ...WORK },
  employee: { 'org.view': 1, 'members.list': 1, 'profile.edit_self': 1, 'clients.view': 1, 'projects.view': 1, 'tasks.view': 1, 'tasks.work': 1, 'dashboard.agency': 1 },
  contractor: { 'org.view': 1, 'profile.edit_self': 1, 'tasks.view': 1, 'tasks.work': 1 },
};
CAN.admin = CAN.owner;

const PEOPLE = [
  { id: 1, username: 'josh', displayName: 'Josh Nunez', role: 'owner', isActive: true, jobTitle: 'Founder', department: '', mustChangePassword: false },
  { id: 2, username: 'rayne', displayName: 'Rayne', role: 'admin', isActive: true, jobTitle: '', department: 'Operations', mustChangePassword: false },
  { id: 3, username: 'mark', displayName: 'Mark Cruz', role: 'manager', isActive: true, jobTitle: 'Delivery Manager', department: '', mustChangePassword: true },
  { id: 4, username: 'sarah', displayName: 'Sarah', role: 'employee', isActive: false, jobTitle: '', department: 'SEO', mustChangePassword: false },
];
const NOW = new Date().toISOString();
const clientRow = (id, name, status, openProjects) => ({ id, name, status, website: id === 1 ? 'https://acme.example' : '', industry: id === 1 ? 'Dental' : '', notes: id === 1 ? 'Prefers email' : '', openProjects, createdAt: NOW, updatedAt: NOW });
const CLIENTS = [clientRow(1, 'Acme Dental', 'active', 1), clientRow(2, 'Beta Bakery', 'paused', 0)];
const PROJECTS = [{ id: 1, clientId: 1, clientName: 'Acme Dental', name: 'New website', description: 'Rebuild the site', status: 'active', startDate: '2026-10-01', dueDate: '2030-01-31', managerId: 3, managerName: 'Mark Cruz', openTasks: 2, doneTasks: 1 }];
const taskRow = (id, title, status, extra = {}) => ({ id, projectId: 1, projectName: 'New website', clientId: 1, clientName: 'Acme Dental', title, description: '', status, priority: 'normal', assigneeId: null, assigneeName: null, dueDate: null, estimateHours: null, completedAt: null, isOverdue: false, createdAt: NOW, updatedAt: NOW, ...extra });
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
    const mineOnly = role === 'contractor';
    const taskList = [
      taskRow(1, 'Homepage copy', 'in_progress', { description: 'Draft the copy', priority: 'high', assigneeId: me.id, assigneeName: me.displayName, dueDate: '2020-01-01', isOverdue: true, estimateHours: 4 }),
      ...(mineOnly ? [] : [taskRow(2, 'Logo options', 'todo'), taskRow(3, 'Sitemap', 'done', { assigneeId: 2, assigneeName: 'Rayne', completedAt: NOW })]),
    ].map((t) => ({ ...t, canEdit: !!can['tasks.manage'], canChangeStatus: !!can['tasks.manage'] || t.assigneeId === me.id }));
    if (pathname === '/tasks' && method === 'GET') return taskList;
    if (/^\/tasks\/\d+$/.test(pathname) && method === 'GET') return taskList.find((t) => t.id === Number(pathname.split('/')[2])) || taskList[0];
    if (/^\/tasks\/\d+\/comments$/.test(pathname) && method === 'GET') return [{ id: 1, taskId: 1, authorId: 2, authorName: 'Rayne', body: 'Please start with the services page', createdAt: NOW }];
    if (pathname === '/api-keys' && method === 'GET') return [{ id: 1, name: 'Claude on my Mac', access: 'propose', prefix: 'aos_Ab12', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: NOW, revoked: false }, { id: 2, name: 'Old key', access: 'direct', prefix: 'aos_Zz99', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: null, revoked: true }];
    if (pathname === '/api-keys' && method === 'POST') return { id: 3, name: 'New', access: 'propose', prefix: 'aos_Qq77', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: null, revoked: false, token: 'aos_Qq77SecretSecretSecretSecretSecret' };
    if (pathname === '/ai/proposals' && method === 'GET') return [
      { id: 2, summary: 'Set up Acme Dental', status: 'pending', error: null, keyName: 'Claude on my Mac', ownerName: 'Josh Nunez', createdAt: NOW, decidedAt: null, decidedByName: null, steps: 2, lines: ['Create client "Acme Dental"', 'Create project "New website" for "Acme Dental"'] },
      { id: 1, summary: 'Old plan', status: 'failed', error: 'Step 1 (create_client): A client with that name already exists', keyName: null, ownerName: 'Josh Nunez', createdAt: '2026-10-01T08:00:00.000Z', decidedAt: NOW, decidedByName: 'Josh Nunez', steps: 1, lines: ['Create client "Acme Dental"'] },
    ];
    if (pathname === '/clients' && method === 'GET') return CLIENTS;
    if (/^\/clients\/\d+$/.test(pathname) && method === 'GET') return { ...CLIENTS[0], contacts: [{ id: 1, clientId: 1, name: 'Dr. Lee', email: 'lee@acme.example', phone: '', roleTitle: 'Owner', isPrimary: true }, { id: 2, clientId: 1, name: 'Front desk', email: '', phone: '555 0100', roleTitle: '', isPrimary: false }], projects: [{ id: 1, name: 'New website', status: 'active', dueDate: '2030-01-31', openTasks: 2 }] };
    if (pathname === '/projects' && method === 'GET') return PROJECTS;
    if (/^\/projects\/\d+$/.test(pathname) && method === 'GET') return PROJECTS[0];
    if (pathname === '/dashboard') return { organization: { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' }, me: { id: me.id, displayName: me.displayName, role }, today: '2026-10-10',
      work: { open: taskList.filter((t) => t.assigneeId === me.id).length, overdue: 1, dueSoon: 0, items: taskList.filter((t) => t.assigneeId === me.id) },
      agency: can['dashboard.agency'] ? { activeClients: 1, activeProjects: 1, openTasks: 2, overdueTasks: 1 } : null,
      workload: can['dashboard.team'] ? [{ id: 1, displayName: 'Josh Nunez', role: 'owner', capacityHours: 40, openTasks: 2, overdue: 1, openHours: 12 }, { id: 2, displayName: 'Rayne', role: 'admin', capacityHours: 0, openTasks: 0, overdue: 0, openHours: 0 }, { id: 3, displayName: 'Mark Cruz', role: 'manager', capacityHours: 20, openTasks: 3, overdue: 0, openHours: 30 }] : null,
      aiPending: can['ai.approve'] ? 1 : 0,
      team: can['dashboard.team'] ? { total: 4, active: 3, byRole: { owner: 1, admin: 1, manager: 1, employee: 0, contractor: 0 }, mustChangePassword: 1 } : null };
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
