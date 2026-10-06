// Joshua Nunez
// A simulated browser for the front-end smoke tests: the real index.html and real modules run in jsdom, and the
// server is replaced by canned answers for one role. Nothing here talks to the network.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PUBLIC = path.resolve(__dirname, '..', '..', 'public');

const ROLES = ['owner', 'admin', 'manager', 'employee', 'contractor'];
const WORK = { 'integrations.manage': 1, 'results.view': 1, 'results.record': 1, 'reports.view': 1, 'reports.manage': 1, 'reports.approve': 1, 'services.view': 1, 'sops.view': 1, 'sops.manage': 1, 'qa.review': 1, 'clients.view': 1, 'clients.manage': 1, 'projects.view': 1, 'projects.manage': 1, 'tasks.view': 1, 'tasks.manage': 1, 'tasks.work': 1, 'dashboard.agency': 1 };
const CAN = {
  owner: { 'services.manage': 1, 'org.view': 1, 'org.update': 1, 'members.list': 1, 'members.create': 1, 'members.manage': 1, 'profile.edit_others': 1, 'profile.edit_self': 1, 'activity.view': 1, 'dashboard.team': 1, 'ai.use': 1, 'ai.manage': 1, 'ai.approve': 1, ...WORK },
  manager: { 'ai.use': 1, 'org.view': 1, 'members.list': 1, 'profile.edit_self': 1, 'dashboard.team': 1, ...WORK },
  employee: { 'results.view': 1, 'results.record': 1, 'reports.view': 1, 'sops.view': 1, 'ai.use': 1, 'org.view': 1, 'members.list': 1, 'profile.edit_self': 1, 'clients.view': 1, 'projects.view': 1, 'tasks.view': 1, 'tasks.work': 1, 'dashboard.agency': 1 },
  contractor: { 'ai.use': 1, 'org.view': 1, 'profile.edit_self': 1, 'tasks.view': 1, 'tasks.work': 1 },
};
CAN.admin = CAN.owner;

const PEOPLE = [
  { id: 1, username: 'josh', displayName: 'Josh Nunez', role: 'owner', isActive: true, jobTitle: 'Founder', department: '', mustChangePassword: false },
  { id: 2, username: 'rayne', displayName: 'Rayne', role: 'admin', isActive: true, jobTitle: '', department: 'Operations', mustChangePassword: false },
  { id: 3, username: 'mark', displayName: 'Mark Cruz', role: 'manager', isActive: true, jobTitle: 'Delivery Manager', department: '', mustChangePassword: true },
  { id: 4, username: 'sarah', displayName: 'Sarah', role: 'employee', isActive: false, jobTitle: '', department: 'SEO', mustChangePassword: false },
];
const NOW = new Date().toISOString();
const GOAL = { id: 1, clientId: 1, title: 'Increase qualified organic leads', why: 'Quiet off season', target: '50 leads a month', dueDate: '2027-03-31', serviceId: 1, serviceName: 'SEO', status: 'active', createdAt: NOW, updatedAt: NOW, progress: { tasksTotal: 4, tasksDone: 1, projects: 1 } };
const METRICS = [
  { source: 'manual', metric: 'Organic leads', unit: 'leads', count: 3, latest: { id: 3, value: 55, recordedOn: '2026-09-30' }, previous: { value: 40, recordedOn: '2026-08-31' }, change: 15, changePct: 37.5, history: [{ id: 1, recordedOn: '2026-07-31', value: 30 }, { id: 2, recordedOn: '2026-08-31', value: 40 }, { id: 3, recordedOn: '2026-09-30', value: 55 }] },
  { source: 'manual', metric: 'Top keywords', unit: '', count: 1, latest: { id: 4, value: 12, recordedOn: '2026-09-15' }, previous: null, change: null, changePct: null, history: [{ id: 4, recordedOn: '2026-09-15', value: 12 }] },
  { source: 'gsc', metric: 'Search clicks', unit: '', count: 12, latest: { id: 20, value: 90, recordedOn: '2026-09-30' }, previous: { value: 80, recordedOn: '2026-08-31' }, change: 10, changePct: 12.5, history: [{ id: 19, recordedOn: '2026-08-31', value: 80 }, { id: 20, recordedOn: '2026-09-30', value: 90 }] },
];
const RESULT_ROWS = [
  { source: 'manual', id: 3, clientId: 1, metric: 'Organic leads', value: 55, unit: 'leads', recordedOn: '2026-09-30', goalId: 1, goalTitle: 'Increase qualified organic leads', note: 'From Search Console', recordedById: 3, recordedByName: 'Mark Cruz' },
  { source: 'manual', id: 2, clientId: 1, metric: 'Organic leads', value: 40, unit: 'leads', recordedOn: '2026-08-31', goalId: null, goalTitle: null, note: '', recordedById: 2, recordedByName: 'Rayne' },
];
const SECTION_TEXT = { executiveSummary: 'A strong month for organic leads.', workCompleted: 'Local SEO\n- Claim profile (Sarah, Sep 10)', keyResults: '- Organic leads: 55 leads (up 15 from 40)', importantChanges: '', problemsRisks: 'Nothing is overdue.', nextPriorities: 'Due soon\n- Write service pages (due Oct 8, Mark)', recommendations: 'Keep publishing service pages.' };
const REPORT_LIST = [
  { id: 1, clientId: 1, clientName: 'Acme Dental', title: 'Acme Dental report, Sep 1, 2026 to Sep 30, 2026', periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'draft', createdByName: 'Josh Nunez', approvedByName: null, approvedAt: null, createdAt: NOW, updatedAt: NOW },
  { id: 2, clientId: 1, clientName: 'Acme Dental', title: 'August report', periodStart: '2026-08-01', periodEnd: '2026-08-31', status: 'approved', createdByName: 'Josh Nunez', approvedByName: 'Mark Cruz', approvedAt: NOW, createdAt: NOW, updatedAt: NOW },
];
const SERVICES = [{ id: 1, name: 'SEO', isActive: true }, { id: 2, name: 'Web Development', isActive: true }];
const clientRow = (id, name, status, openProjects) => ({ id, services: id === 1 ? [{ id: 1, name: 'SEO' }] : [], accountOwnerId: id === 1 ? 3 : null, accountOwnerName: id === 1 ? 'Mark Cruz' : null, startDate: id === 1 ? '2026-09-01' : null, name, status, website: id === 1 ? 'https://acme.example' : '', industry: id === 1 ? 'Dental' : '', notes: id === 1 ? 'Prefers email' : '', openProjects, createdAt: NOW, updatedAt: NOW });
const CLIENTS = [clientRow(1, 'Acme Dental', 'active', 1), clientRow(2, 'Beta Bakery', 'paused', 0)];
const PROJECTS = [{ id: 1, clientId: 1, clientName: 'Acme Dental', name: 'New website', description: 'Rebuild the site', status: 'active', startDate: '2026-10-01', dueDate: '2030-01-31', managerId: 3, managerName: 'Mark Cruz', openTasks: 2, doneTasks: 1, serviceId: 1, serviceName: 'SEO', goalId: 1, goalTitle: 'Increase qualified organic leads' }];
const SOP_CONTENT = { purpose: 'Rank the page', whenToUse: '', inputs: 'URL and keyword', steps: ['Research', 'Write'], checklist: ['Title ok', 'Links ok'], expectedOutput: 'An updated page', commonMistakes: '', examples: '' };
const PENDING = { id: 5, status: 'pending', submittedByName: 'Rayne', submittedAt: NOW, reviewerName: null, reviewedAt: null, comments: '', checklist: [{ text: 'Title ok', checked: false }, { text: 'Links ok', checked: false }] };
const PAST = { id: 4, status: 'changes_requested', submittedByName: 'Rayne', submittedAt: '2026-10-01T08:00:00.000Z', reviewerName: 'Mark Cruz', reviewedAt: '2026-10-02T08:00:00.000Z', comments: 'Title was too long', checklist: [{ text: 'Title ok', checked: false }, { text: 'Links ok', checked: true }] };
const SOP_LIST = [
  { id: 1, title: 'Page Optimization', service: 'SEO', ownerId: 1, ownerName: 'Josh Nunez', status: 'approved', requiresQa: true, version: '1.1', versionId: 2, createdAt: NOW, updatedAt: NOW },
  { id: 2, title: 'Draft idea', service: '', ownerId: 3, ownerName: 'Mark Cruz', status: 'draft', requiresQa: false, version: '1.0', versionId: 3, createdAt: NOW, updatedAt: NOW },
];
const taskRow = (id, title, status, extra = {}) => ({ id, goalId: null, goalTitle: null, goalInherited: false, sopId: null, sopTitle: null, sopVersion: null, qaRequired: false, projectId: 1, projectName: 'New website', clientId: 1, clientName: 'Acme Dental', title, description: '', status, priority: 'normal', assigneeId: null, assigneeName: null, dueDate: null, estimateHours: null, completedAt: null, isOverdue: false, createdAt: NOW, updatedAt: NOW, ...extra });
const RANK = { owner: 5, admin: 4, manager: 3, employee: 2, contractor: 1 };

function answers(role, { mustChange = false, empty = false } = {}) {
  const can = Object.fromEntries(Object.keys(CAN.owner).map((k) => [k, !!CAN[role][k]]));
  const me = { id: role === 'owner' ? 1 : 3, username: role === 'owner' ? 'josh' : 'mark', displayName: role === 'owner' ? 'Josh Nunez' : 'Mark Cruz', mustChangePassword: mustChange };
  const assignable = role === 'owner' ? ROLES : role === 'admin' ? ['manager', 'employee', 'contractor'] : [];
  const profile = { userId: me.id, username: me.username, displayName: me.displayName, role, jobTitle: 'Delivery Manager', department: 'Operations', timezone: 'Asia/Manila', workDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '17:00', weeklyCapacityHours: 40 };
  const google = { link: null };
  return (method, url, body) => {
    const [pathname] = url.split('?');
    if (pathname === '/status') return { needsSetup: false, setupCodeRequired: false };
    if (pathname === '/session') return { user: me, organization: { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' }, role, csrf: 'csrf-token', can, assignableRoles: assignable };
    if (pathname === '/org') return { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' };
    const mineOnly = role === 'contractor';
    const taskList = [
      taskRow(1, 'Homepage copy', 'in_progress', { description: 'Draft the copy', priority: 'high', assigneeId: me.id, assigneeName: me.displayName, dueDate: '2020-01-01', isOverdue: true, estimateHours: 4, sopId: 1, sopTitle: 'Page Optimization', sopVersion: '1.0', qaRequired: true }),
      ...(mineOnly ? [] : [taskRow(2, 'Logo options', 'review', { assigneeId: 2, assigneeName: 'Rayne', sopId: 1, sopTitle: 'Page Optimization', sopVersion: '1.0', qaRequired: true }), taskRow(3, 'Sitemap', 'done', { assigneeId: 2, assigneeName: 'Rayne', completedAt: NOW })]),
    ].map((t) => ({ ...t, canEdit: !!can['tasks.manage'], canChangeStatus: !!can['tasks.manage'] || t.assigneeId === me.id }));
    if (pathname === '/tasks' && method === 'GET') return taskList;
    if (/^\/tasks\/\d+$/.test(pathname) && method === 'GET') {
      const t = taskList.find((x) => x.id === Number(pathname.split('/')[2])) || taskList[0];
      const pinned = { id: 1, title: 'Page Optimization', status: 'approved', version: '1.0', latestVersion: '1.1', isLatest: false, content: SOP_CONTENT };
      return { ...t, sop: t.sopId ? pinned : null, qa: { required: t.qaRequired, pending: t.id === 2 ? PENDING : null, history: t.id === 2 ? [PENDING, PAST] : [] } };
    }
    if (pathname === '/sops' && method === 'GET') { const want = new URLSearchParams(url.split('?')[1] || '').get('status'); return SOP_LIST.filter((x) => !want || x.status === want).filter((x) => can['sops.manage'] || x.status !== 'draft'); }
    if (pathname === '/sops' && method === 'POST') return { ...SOP_LIST[1], id: 3, title: 'New one' };
    if (pathname === '/sops/1' && method === 'GET') return { ...SOP_LIST[0], content: SOP_CONTENT, versions: [{ id: 2, label: '1.1', changeNote: 'Added a step', createdAt: NOW, createdByName: 'Mark Cruz' }, { id: 1, label: '1.0', changeNote: 'First version', createdAt: '2026-10-01T08:00:00.000Z', createdByName: 'Josh Nunez' }] };
    if (pathname === '/sops/1/versions/1' && method === 'GET') return { id: 1, label: '1.0', changeNote: 'First version', createdAt: NOW, createdByName: 'Josh Nunez', content: { ...SOP_CONTENT, steps: ['Old step one', 'Old step two'] } };
    if (pathname === '/qa' && method === 'GET') return can['qa.review'] ? [{ reviewId: 5, taskId: 2, title: 'Logo options', projectName: 'New website', clientName: 'Acme Dental', assigneeName: 'Rayne', submittedByName: 'Rayne', submittedAt: NOW, sopTitle: 'Page Optimization', sopVersion: '1.0', checklistTotal: 2 }] : { __status: 403, error: 'Not allowed' };
    if (/^\/tasks\/\d+\/comments$/.test(pathname) && method === 'GET') return [{ id: 1, taskId: 1, authorId: 2, authorName: 'Rayne', body: 'Please start with the services page', createdAt: NOW }];
    if (pathname === '/api-keys' && method === 'GET') return [{ id: 4, name: 'Claude', kind: 'oauth', access: 'propose', prefix: 'OAuth', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: NOW, revoked: false }, { id: 1, kind: 'key', name: 'Claude on my Mac', access: 'propose', prefix: 'aos_Ab12', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: NOW, revoked: false }, { id: 2, kind: 'key', name: 'Old key', access: 'direct', prefix: 'aos_Zz99', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: null, revoked: true }];
    if (pathname === '/api-keys' && method === 'POST') return { id: 3, name: 'New', access: 'propose', prefix: 'aos_Qq77', userId: 1, ownerName: 'Josh Nunez', createdAt: NOW, lastUsedAt: null, revoked: false, token: 'aos_Qq77SecretSecretSecretSecretSecret' };
    if (pathname === '/oauth/requests/abc123' && method === 'GET') return { id: 'abc123', clientName: 'Claude', redirectHost: 'claude.ai', defaultAccess: 'propose' };
    if (pathname === '/oauth/requests/gone' && method === 'GET') return { __status: 404, error: 'This connection request has expired. Start again from the AI app' };
    if (/^\/oauth\/requests\/abc123\/(approve|deny)$/.test(pathname) && method === 'POST') return { redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=aoc_test&state=xyz' };
    if (pathname === '/ai/proposals' && method === 'GET') return [
      { id: 2, summary: 'Set up Acme Dental', status: 'pending', error: null, keyName: 'Claude on my Mac', ownerName: 'Josh Nunez', createdAt: NOW, decidedAt: null, decidedByName: null, steps: 2, lines: ['Create client "Acme Dental"', 'Create project "New website" for "Acme Dental"'] },
      { id: 1, summary: 'Old plan', status: 'failed', error: 'Step 1 (create_client): A client with that name already exists', keyName: null, ownerName: 'Josh Nunez', createdAt: '2026-10-01T08:00:00.000Z', decidedAt: NOW, decidedByName: 'Josh Nunez', steps: 1, lines: ['Create client "Acme Dental"'] },
    ];
    if (pathname === '/clients/1/metrics' && method === 'GET') return can['results.view'] ? METRICS : { __status: 403, error: 'Not allowed' };
    if (pathname === '/clients/1/results' && method === 'GET') return url.includes('Search%20clicks') ? [{ source: 'gsc', id: 20, clientId: 1, metric: 'Search clicks', value: 90, unit: '', recordedOn: '2026-09-30', goalId: null, goalTitle: null, note: 'Google Search Console, Sep 2026', recordedById: null, recordedByName: null }] : RESULT_ROWS;
    if (pathname === '/integrations/google' && method === 'GET') return { configured: true, email: can['integrations.manage'] ? 'agencyos@project.iam.gserviceaccount.com' : null };
    if (pathname === '/integrations/google/available' && method === 'GET') return { sites: [{ siteUrl: 'sc-domain:acme.example', permissionLevel: 'siteRestrictedUser' }], properties: [{ id: '111', name: 'Acme site', account: 'Acme' }] };
    if (pathname === '/clients/1/google' && method === 'GET') return google.link;
    if (pathname === '/clients/1/google' && method === 'PUT') { google.link = { gscSiteUrl: body.gscSiteUrl, ga4PropertyId: body.ga4PropertyId, connectedAt: NOW, connectedByName: 'Josh Nunez', lastSyncAt: NOW, lastSyncStatus: 'partial', lastSyncError: 'Google Analytics: Google refused access. Add agencyos@project.iam.gserviceaccount.com as a read-only user (a viewer) for this property' }; return { link: google.link, sync: { status: 'partial', months: 12, recorded: 48, errors: [] } }; }
    if (pathname === '/clients/1/google/sync' && method === 'POST') return { status: 'ok', months: 12, recorded: 96, errors: [] };
    if (pathname === '/clients/1/google' && method === 'DELETE') { google.link = null; return { ok: true }; }
    if (pathname === '/clients/1/reports/generate' && method === 'POST') return { ...REPORT_LIST[0], id: 3, sections: SECTION_TEXT };
    if (pathname === '/reports' && method === 'GET') return can['reports.view'] ? REPORT_LIST : { __status: 403, error: 'Not allowed' };
    if (pathname === '/reports' && method === 'POST') return { ...REPORT_LIST[0], id: 4, sections: SECTION_TEXT };
    if (/^\/reports\/[12]$/.test(pathname) && method === 'GET') return { ...REPORT_LIST[Number(pathname.split('/')[2]) - 1], sections: SECTION_TEXT };
    if (pathname === '/services' && method === 'GET') return url.includes('all=1') ? [...SERVICES, { id: 3, name: 'Old service', isActive: false }] : SERVICES;
    if (pathname === '/services/defaults' && method === 'POST') return [...SERVICES];
    if (pathname === '/clients/1/goals' && method === 'GET') return [GOAL];
    if (pathname === '/clients' && method === 'GET') return CLIENTS;
    if (/^\/clients\/\d+$/.test(pathname) && method === 'GET') return { ...CLIENTS[0], contacts: [{ id: 1, clientId: 1, name: 'Dr. Lee', email: 'lee@acme.example', phone: '', roleTitle: 'Owner', isPrimary: true }, { id: 2, clientId: 1, name: 'Front desk', email: '', phone: '555 0100', roleTitle: '', isPrimary: false }], projects: [{ id: 1, name: 'New website', status: 'active', dueDate: '2030-01-31', openTasks: 2, goalTitle: 'Increase qualified organic leads' }], goals: [GOAL] };
    if (pathname === '/projects' && method === 'GET') return PROJECTS;
    if (/^\/projects\/\d+$/.test(pathname) && method === 'GET') return PROJECTS[0];
    if (pathname === '/dashboard') return { organization: { id: 1, name: 'Whalls Agency', timezone: 'Asia/Manila' }, me: { id: me.id, displayName: me.displayName, role }, today: '2026-10-10',
      work: { open: taskList.filter((t) => t.assigneeId === me.id).length, overdue: 1, dueSoon: 0, items: taskList.filter((t) => t.assigneeId === me.id) },
      agency: can['dashboard.agency'] ? { activeClients: 1, activeProjects: 1, openTasks: 2, overdueTasks: 1 } : null,
      workload: can['dashboard.team'] ? [{ id: 1, displayName: 'Josh Nunez', role: 'owner', capacityHours: 40, openTasks: 2, overdue: 1, openHours: 12 }, { id: 2, displayName: 'Rayne', role: 'admin', capacityHours: 0, openTasks: 0, overdue: 0, openHours: 0 }, { id: 3, displayName: 'Mark Cruz', role: 'manager', capacityHours: 20, openTasks: 3, overdue: 0, openHours: 30 }] : null,
      aiPending: can['ai.approve'] ? 1 : 0,
      qaWaiting: can['qa.review'] ? 1 : 0,
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
    const body = (options.respond && options.respond(method, apiPath)) || answer(method, apiPath, init.body ? JSON.parse(init.body) : undefined);
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
