// Joshua Nunez
// The explicit security sweep. Two agencies, each with data of every kind. A signed-in person of agency B asks for
// every id-based route of the API with agency A's ids and gets "not found" or "not allowed", and nothing in A changes.
// A Contractor of A cannot reach other people's private records by id. A B key cannot read or write A's records through
// any AI tool. The routes and tools are read from the code (the Express router and the tool list), so a route or a tool
// added later without an entry here fails the test until someone decides how to attack it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, PASSWORD } = require('./support/http');
const { createHub } = require('../server/googlehub');
const apiRouter = require('../server/routes/api');
const { TOOLS } = require('../server/mcp');
const { ACTIONS } = require('../server/services/aiplans');
const plans = require('../server/services/aiplans');
const orgs = require('../server/services/organizations');
const members = require('../server/services/members');
const services = require('../server/services/services');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const goals = require('../server/services/goals');
const tasks = require('../server/services/tasks');
const events = require('../server/services/events');
const notes = require('../server/services/meetingnotes');
const requests = require('../server/services/requests');
const decisions = require('../server/services/decisions');
const followups = require('../server/services/followups');
const sops = require('../server/services/sops');
const sopchanges = require('../server/services/sopchanges');
const results = require('../server/services/results');
const reports = require('../server/services/reports');
const time = require('../server/services/timeentries');
const retainers = require('../server/services/retainers');
const apikeys = require('../server/services/apikeys');
const { extractRecords } = require('../server/services/noterecords');

const MARK_A = 'AGENCYASECRET';
const MARK_B = 'AGENCYBSECRET';
const day = (n = 0) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const CONTENT = { service: 'SEO', purpose: 'Make a page rank', steps: ['Check the page'], checklist: ['Title ok'] };

// ---- seeding: one agency with every kind of record ----

async function seedAgency(db, google, tag, mark) {
  const org = await orgs.createOrganization(db, { organizationName: `${tag} Agency ${mark}`, displayName: `Owner ${mark}`, username: `${tag}owner`, password: PASSWORD });
  const ctxOf = (id, role) => ({ organizationId: org.organizationId, actor: { id, role }, ip: '127.0.0.1', source: 'web' });
  const owner = { id: org.userId, ctx: ctxOf(org.userId, 'owner') };
  const add = async (name, role) => { const m = await members.createMember(db, owner.ctx, { username: `${tag}${name}`, displayName: `${name} ${mark}`, role, password: PASSWORD }); return { id: m.id, username: `${tag}${name}`, ctx: ctxOf(m.id, role) }; };
  const mark1 = await add('manager', 'manager');
  const emp = await add('employee', 'employee');
  const con = await add('contractor', 'contractor');
  const m = mark1.ctx;
  const t = (text) => `${text} ${mark}`;

  const service = services.createService(db, owner.ctx, { name: t('Service') });
  const client = clients.createClient(db, m, { name: t('Client'), serviceIds: [service.id], website: `https://${tag}.example` });
  const contact = clients.addContact(db, m, client.id, { name: t('Contact'), email: `${tag}@example.com` });
  const goal = goals.createGoal(db, m, client.id, { title: t('Goal') });
  const project = projects.createProject(db, m, { clientId: client.id, name: t('Project'), goalId: goal.id });
  const sop = sops.createSop(db, m, { ...CONTENT, title: t('SOP'), status: 'approved', requiresQa: true });
  const sopVersionId = sops.getSop(db, m, sop.id).versions[0].id;
  // the contractor's own task, another person's task, and a task waiting in QA
  const taskCon = tasks.createTask(db, m, { projectId: project.id, title: t('Contractor task'), assigneeId: con.id });
  const task = tasks.createTask(db, m, { projectId: project.id, title: t('Employee task'), assigneeId: emp.id, sopId: sop.id, goalId: goal.id });
  const comment = tasks.addComment(db, emp.ctx, task.id, { body: t('A private comment') });
  const taskQa = tasks.createTask(db, m, { projectId: project.id, title: t('QA task'), assigneeId: emp.id, sopId: sop.id });
  tasks.updateTask(db, emp.ctx, taskQa.id, { status: 'review' });
  // calendar: an event the contractor does not attend, and one they do
  const start = (n) => `${day(n)}T10:00:00Z`;
  const event = events.createEvent(db, m, { title: t('Team event'), type: 'client_meeting', startsAt: start(1), endsAt: `${day(1)}T11:00:00Z`, clientId: client.id, attendees: [emp.id] });
  const eventCon = events.createEvent(db, m, { title: t('Contractor event'), type: 'internal_meeting', startsAt: start(2), endsAt: `${day(2)}T11:00:00Z`, attendees: [con.id] });
  const note = notes.createNote(db, m, { title: t('Private notes'), meetingDate: day(), clientId: client.id, projectId: project.id, decisions: '- A decision', requests: '- A request', followUps: '- A follow up', discussion: t('Secret discussion') });
  const noteEvent = notes.createNote(db, m, { title: t('Event notes'), meetingDate: day(1), eventId: event.id, clientId: client.id });
  const noteCon = notes.createNote(db, m, { title: t('Contractor notes'), meetingDate: day(2), eventId: eventCon.id });
  extractRecords(db, m, note.id);
  const request = requests.createRequest(db, m, { clientId: client.id, projectId: project.id, title: t('Request'), ownerId: emp.id });
  const requestTask = requests.createRequest(db, m, { clientId: client.id, projectId: project.id, title: t('Request to convert') });
  const decision = decisions.createDecision(db, m, { title: t('Decision'), decidedOn: day(), clientId: client.id });
  const followUp = followups.createFollowUp(db, m, { title: t('Follow-up'), assigneeId: emp.id, clientId: client.id });
  const followUpCon = followups.createFollowUp(db, m, { title: t('Contractor follow-up'), assigneeId: con.id });
  const change = sopchanges.createChange(db, m, { sopId: sop.id, title: t('SOP change'), details: t('Change the steps'), proposedContent: { steps: ['New step'] } });
  const result = results.recordResult(db, m, client.id, { metric: t('Leads'), value: 12 });
  const report = reports.generateReport(db, m, client.id, { periodStart: day(-30), periodEnd: day() });
  const entry = time.createEntry(db, emp.ctx, { taskId: task.id, minutes: 60, description: t('Secret time') });
  time.submitEntries(db, emp.ctx, { ids: [entry.id] });
  const approved = time.createEntry(db, emp.ctx, { taskId: task.id, minutes: 30, date: day(-1), description: t('Approved time') });
  time.submitEntries(db, emp.ctx, { ids: [approved.id] });
  time.approveEntry(db, m, approved.id);
  const entryCon = time.createEntry(db, con.ctx, { taskId: taskCon.id, minutes: 15 });
  retainers.saveRetainer(db, m, client.id, { hoursAllocated: 20, startDate: day(-10) });
  const notification = db.prepare('SELECT id FROM notifications WHERE organization_id = ? AND user_id = ? ORDER BY id LIMIT 1').get(org.organizationId, emp.id).id;
  const notificationCon = db.prepare('SELECT id FROM notifications WHERE organization_id = ? AND user_id = ? ORDER BY id LIMIT 1').get(org.organizationId, con.id).id;
  const key = apikeys.createKey(db, owner.ctx, { name: t('Key'), access: 'direct' });
  const keyPropose = apikeys.createKey(db, owner.ctx, { name: t('Propose key'), access: 'propose' });
  const proposal = plans.submitPlan(db, { access: 'propose', organizationId: org.organizationId, actor: { id: owner.id, role: 'owner' }, keyId: keyPropose.id }, { summary: t('A plan'), steps: [{ action: 'create_client', args: { name: t('Planned client') } }] });
  const account = db.prepare('INSERT INTO google_accounts (organization_id, email, refresh_token_enc, connected_by) VALUES (?, ?, ?, ?)').run(org.organizationId, `${tag}@gmail.example`, google._encrypt('refresh'), owner.id);
  db.prepare('INSERT INTO client_google (client_id, organization_id, gsc_site_url, connected_by, google_account_id) VALUES (?, ?, ?, ?, ?)').run(client.id, org.organizationId, `sc-domain:${tag}.example`, owner.id, account.lastInsertRowid);
  // the contractor and the employee must not be asked to change their password
  db.prepare('UPDATE users SET must_change_password = 0').run();
  return {
    tag, mark, orgId: org.organizationId, owner, manager: mark1, employee: emp, contractor: con,
    ids: {
      // what a person of another agency (or a Contractor) must not reach
      member: mark1.id, client: client.id, contact: contact.id, project: project.id, goal: goal.id, service: service.id, sop: sop.id, sopVersion: sopVersionId,
      task: task.id, taskCon: taskCon.id, taskQa: taskQa.id, comment: comment.id, event: event.id, eventCon: eventCon.id, note: note.id, noteEvent: noteEvent.id, noteCon: noteCon.id,
      request: request.id, requestTask: requestTask.id, decision: decision.id, followUp: followUp.id, followUpCon: followUpCon.id, sopChange: change.id, result: result.id, report: report.id,
      timeEntry: entry.id, timeApproved: approved.id, timeCon: entryCon.id, notification, notificationCon, apiKey: key.id, proposal: proposal.proposalId, googleAccount: Number(account.lastInsertRowid),
    },
    token: key.token,
  };
}

// Every row of an agency, to prove an attack changed nothing.
function snapshot(db, orgId) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
    // a session's last-seen time moves whenever its owner makes any request, so it is not a change of data
    if (name !== 'sessions' && cols.includes('organization_id')) out[name] = db.prepare(`SELECT * FROM ${name} WHERE organization_id = ? ORDER BY rowid`).all(orgId);
  }
  out.organizations = db.prepare('SELECT * FROM organizations WHERE id = ?').all(orgId);
  const people = 'SELECT user_id FROM organization_members WHERE organization_id = ?';
  out.users = db.prepare(`SELECT * FROM users WHERE id IN (${people}) ORDER BY id`).all(orgId);
  out.user_identities = db.prepare(`SELECT * FROM user_identities WHERE user_id IN (${people}) ORDER BY id`).all(orgId);
  out.event_attendees = db.prepare('SELECT * FROM event_attendees WHERE event_id IN (SELECT id FROM events WHERE organization_id = ?) ORDER BY rowid').all(orgId);
  out.client_services = db.prepare('SELECT * FROM client_services WHERE client_id IN (SELECT id FROM clients WHERE organization_id = ?) ORDER BY rowid').all(orgId);
  return out;
}

const REQUIRED_TABLES = ['clients', 'client_contacts', 'client_goals', 'projects', 'tasks', 'task_comments', 'qa_reviews', 'events', 'meeting_notes', 'decisions', 'client_requests', 'follow_ups', 'sops', 'sop_versions',
  'sop_change_requests', 'client_results', 'reports', 'time_entries', 'client_retainers', 'notifications', 'api_keys', 'ai_proposals', 'google_accounts', 'client_google', 'services', 'activity_logs'];

// ---- the routes, read from the Express router ----

function routesOf(db) {
  const router = apiRouter(db, { google: null });
  const open = router.stack.findIndex((l) => l.name === 'requireAuth' || (l.handle && l.handle.name === 'requireAuth'));
  assert.ok(open > 0, 'the router has a point after which a sign-in is needed');
  const list = [];
  router.stack.forEach((layer, i) => {
    if (!layer.route || i < open) return;
    for (const method of Object.keys(layer.route.methods)) list.push({ method: method.toUpperCase(), pattern: layer.route.path });
  });
  return list;
}

// For every route with an id in its address: which id of agency A fills it, and a body that would do harm if it worked.
// `ids` names the entry of seedAgency(...).ids for each parameter.
const ID_ROUTES = {
  'PUT /members/:id/google': { ids: { id: 'member' }, body: { email: 'attacker@example.com' } },
  'POST /members/:id/password-login': { ids: { id: 'member' }, body: { enabled: false } },
  'PATCH /members/:id': { ids: { id: 'member' }, body: { displayName: 'Hacked' } },
  'POST /members/:id/reset-password': { ids: { id: 'member' }, body: { password: 'attacker-chosen-pass' } },
  'GET /members/:id/profile': { ids: { id: 'member' } },
  'PATCH /members/:id/profile': { ids: { id: 'member' }, body: { jobTitle: 'Hacked' } },
  'GET /clients/:id': { ids: { id: 'client' } },
  'PATCH /clients/:id': { ids: { id: 'client' }, body: { name: 'Hacked' } },
  'POST /clients/:id/contacts': { ids: { id: 'client' }, body: { name: 'Planted' } },
  'PATCH /contacts/:id': { ids: { id: 'contact' }, body: { name: 'Hacked' } },
  'DELETE /contacts/:id': { ids: { id: 'contact' } },
  'GET /projects/:id': { ids: { id: 'project' } },
  'PATCH /projects/:id': { ids: { id: 'project' }, body: { name: 'Hacked' } },
  'GET /events/:id': { ids: { id: 'event' } },
  'PATCH /events/:id': { ids: { id: 'event' }, body: { title: 'Hacked' } },
  'DELETE /events/:id': { ids: { id: 'event' } },
  'GET /meeting-notes/:id': { ids: { id: 'note' } },
  'PATCH /meeting-notes/:id': { ids: { id: 'note' }, body: { title: 'Hacked' } },
  'DELETE /meeting-notes/:id': { ids: { id: 'note' } },
  'POST /meeting-notes/:id/records': { ids: { id: 'note' }, body: {} },
  'GET /meeting-notes/:id/records': { ids: { id: 'note' } },
  'POST /notifications/:id/read': { ids: { id: 'notification' } },
  'GET /requests/:id': { ids: { id: 'request' } },
  'PATCH /requests/:id': { ids: { id: 'request' }, body: { title: 'Hacked' } },
  'POST /requests/:id/convert': { ids: { id: 'requestTask' }, body: { projectId: 'project' } },
  'DELETE /requests/:id': { ids: { id: 'request' } },
  'GET /decisions/:id': { ids: { id: 'decision' } },
  'PATCH /decisions/:id': { ids: { id: 'decision' }, body: { title: 'Hacked' } },
  'DELETE /decisions/:id': { ids: { id: 'decision' } },
  'GET /follow-ups/:id': { ids: { id: 'followUp' } },
  'PATCH /follow-ups/:id': { ids: { id: 'followUp' }, body: { title: 'Hacked' } },
  'DELETE /follow-ups/:id': { ids: { id: 'followUp' } },
  'GET /tasks/:id': { ids: { id: 'task' } },
  'PATCH /tasks/:id': { ids: { id: 'task' }, body: { title: 'Hacked' } },
  'DELETE /tasks/:id': { ids: { id: 'task' } },
  'GET /tasks/:id/trace': { ids: { id: 'task' } },
  'GET /tasks/:id/comments': { ids: { id: 'task' } },
  'POST /tasks/:id/comments': { ids: { id: 'task' }, body: { body: 'Planted comment' } },
  'POST /tasks/:id/qa': { ids: { id: 'taskQa' }, body: { result: 'changes_requested', comments: 'Hacked' } },
  'DELETE /integrations/google/accounts/:id': { ids: { id: 'googleAccount' } },
  'GET /clients/:id/google': { ids: { id: 'client' } },
  'PUT /clients/:id/google': { ids: { id: 'client' }, body: { source: '0', gscSiteUrl: 'sc-domain:hacked.example' } },
  'POST /clients/:id/google/sync': { ids: { id: 'client' }, body: {} },
  'DELETE /clients/:id/google': { ids: { id: 'client' } },
  'GET /clients/:id/timeline': { ids: { id: 'client' } },
  'GET /clients/:id/results': { ids: { id: 'client' } },
  'GET /clients/:id/metrics': { ids: { id: 'client' } },
  'POST /clients/:id/results': { ids: { id: 'client' }, body: { metric: 'Planted', value: 1 } },
  'PATCH /results/:id': { ids: { id: 'result' }, body: { value: 999 } },
  'DELETE /results/:id': { ids: { id: 'result' } },
  'GET /clients/:id/report-data': { ids: { id: 'client' }, query: `?from=${day(-30)}&to=${day()}` },
  'POST /clients/:id/reports/generate': { ids: { id: 'client' }, body: { periodStart: day(-30), periodEnd: day() } },
  'GET /reports/:id': { ids: { id: 'report' } },
  'PATCH /reports/:id': { ids: { id: 'report' }, body: { title: 'Hacked' } },
  'POST /reports/:id/approve': { ids: { id: 'report' }, body: {} },
  'DELETE /reports/:id': { ids: { id: 'report' } },
  'PATCH /services/:id': { ids: { id: 'service' }, body: { name: 'Hacked' } },
  'GET /clients/:id/goals': { ids: { id: 'client' } },
  'POST /clients/:id/goals': { ids: { id: 'client' }, body: { title: 'Planted goal' } },
  'PATCH /goals/:id': { ids: { id: 'goal' }, body: { title: 'Hacked' } },
  'GET /sops/:id': { ids: { id: 'sop' } },
  'PATCH /sops/:id': { ids: { id: 'sop' }, body: { title: 'Hacked' } },
  'POST /sops/:id/versions': { ids: { id: 'sop' }, body: { ...CONTENT, changeNote: 'Planted' } },
  'GET /sops/:id/versions/:versionId': { ids: { id: 'sop', versionId: 'sopVersion' } },
  'POST /sops/:id/tasks': { ids: { id: 'sop' }, body: { projectId: 'project' } },
  'GET /sop-changes/:id': { ids: { id: 'sopChange' } },
  'PATCH /sop-changes/:id': { ids: { id: 'sopChange' }, body: { title: 'Hacked' } },
  'POST /sop-changes/:id/publish': { ids: { id: 'sopChange' }, body: {} },
  'PATCH /api-keys/:id': { ids: { id: 'apiKey' }, body: { name: 'Hacked' } },
  'DELETE /api-keys/:id': { ids: { id: 'apiKey' } },
  'POST /ai/proposals/:id/approve': { ids: { id: 'proposal' }, body: {} },
  'POST /ai/proposals/:id/reject': { ids: { id: 'proposal' }, body: {} },
  'GET /time-entries/:id': { ids: { id: 'timeEntry' } },
  'PATCH /time-entries/:id': { ids: { id: 'timeEntry' }, body: { minutes: 5 } },
  'DELETE /time-entries/:id': { ids: { id: 'timeEntry' } },
  'POST /time-entries/:id/approve': { ids: { id: 'timeEntry' }, body: {} },
  'POST /time-entries/:id/reject': { ids: { id: 'timeEntry' }, body: { note: 'Hacked' } },
  'POST /time-entries/:id/lock': { ids: { id: 'timeApproved' }, body: {} },
  'GET /clients/:id/retainer': { ids: { id: 'client' } },
  'PUT /clients/:id/retainer': { ids: { id: 'client' }, body: { hoursAllocated: 1, startDate: day() } },
};

// Routes with an id that belong to no agency: an unguessable id of a sign-in request, bound to the person who approves it.
const ID_ROUTES_GLOBAL = new Set(['GET /oauth/requests/:id', 'POST /oauth/requests/:id/approve', 'POST /oauth/requests/:id/deny']);

// Routes with no id that act on the signed-in person's own agency or own records only.
const OWN_ONLY = new Set(['GET /session', 'POST /logout', 'POST /password', 'PUT /org/security', 'GET /org', 'PATCH /org', 'GET /profile/google', 'POST /profile/google/start', 'DELETE /profile/google', 'POST /profile/password-login',
  'GET /profile', 'PATCH /profile', 'POST /notifications/read-all', 'POST /time-entries/submit', 'POST /time/timer/start', 'POST /time/timer/pause', 'POST /time/timer/resume', 'POST /time/timer/stop', 'POST /services/defaults',
  'POST /api-keys', 'POST /clients', 'POST /sops', 'POST /services', 'POST /members', 'POST /integrations/google/accounts/start', 'GET /integrations/google/callback']);

// Routes that create something and take ids of other records in the body: a person of another agency sends A's ids.
const BODY_ROUTES = (A) => [
  ['POST', '/projects', { clientId: A.client, name: 'Planted', goalId: A.goal, serviceId: A.service }],
  ['POST', '/events', { title: 'Planted', startsAt: `${day(3)}T10:00:00Z`, endsAt: `${day(3)}T11:00:00Z`, clientId: A.client }],
  ['POST', '/events', { title: 'Planted', startsAt: `${day(3)}T10:00:00Z`, attendees: [A.member] }],
  ['POST', '/meeting-notes', { title: 'Planted', meetingDate: day(), eventId: A.event }],
  ['POST', '/meeting-notes', { title: 'Planted', meetingDate: day(), clientId: A.client, projectId: A.project }],
  ['POST', '/requests', { clientId: A.client, title: 'Planted' }],
  ['POST', '/decisions', { title: 'Planted', decidedOn: day(), clientId: A.client, projectId: A.project }],
  ['POST', '/follow-ups', { title: 'Planted', clientId: A.client, assigneeId: A.member }],
  ['POST', '/tasks', { projectId: A.project, title: 'Planted' }],
  ['POST', '/tasks', { projectId: 'OWN_project', title: 'Planted', assigneeId: A.member, sopId: A.sop, goalId: A.goal }],
  ['POST', '/time-entries', { taskId: A.task, minutes: 10 }],
  ['POST', '/time-entries', { clientId: A.client, minutes: 10, timeType: 'billable' }],
  ['POST', '/time-entries/submit', { ids: [A.timeEntry] }],
  ['POST', '/time/timer/start', { taskId: A.task }],
  ['POST', '/reports', { clientId: A.client, title: 'Planted', periodStart: day(-5), periodEnd: day() }],
  ['POST', '/sop-changes', { sopId: A.sop, title: 'Planted', details: 'Planted' }],
  ['POST', '/sop-changes', { sopId: 'OWN_sop', title: 'Planted', details: 'Planted', sourceType: 'task', sourceId: A.task }],
  ['PATCH', '/projects/OWN_project', { goalId: A.goal, serviceId: A.service, managerId: A.member }],
  ['PATCH', '/tasks/OWN_task', { assigneeId: A.member, sopId: A.sop, goalId: A.goal, projectId: A.project }],
  ['PATCH', '/clients/OWN_client', { accountOwnerId: A.member, serviceIds: [A.service] }],
  ['PATCH', '/requests/OWN_request', { ownerId: A.member, projectId: A.project, clientId: A.client }],
  ['PATCH', '/events/OWN_event', { attendees: [A.member], clientId: A.client, taskId: A.task }],
  ['PATCH', '/meeting-notes/OWN_note', { clientId: A.client, projectId: A.project }],
  ['PATCH', '/follow-ups/OWN_followUp', { assigneeId: A.member, clientId: A.client }],
  ['PATCH', '/decisions/OWN_decision', { projectId: A.project, clientId: A.client }],
  ['PATCH', '/goals/OWN_goal', { serviceId: A.service }],
  ['POST', '/clients/OWN_client/results', { metric: 'Planted', value: 1, goalId: A.goal }],
  ['POST', '/sops/OWN_sop/tasks', { projectId: A.project }],
  ['PATCH', '/time-entries/OWN_timeEntry', { taskId: A.task }],
  ['POST', '/requests/OWN_requestTask/convert', { projectId: A.project }],
];

// Lists that take an id of another agency's record as a filter.
const FILTER_LISTS = (A) => [
  `/tasks?projectId=${A.project}`, `/tasks?assigneeId=${A.member}`, `/projects?clientId=${A.client}`, `/requests?clientId=${A.client}`, `/decisions?clientId=${A.client}`, `/follow-ups?clientId=${A.client}`,
  `/follow-ups?assigneeId=${A.member}`, `/meeting-notes?clientId=${A.client}`, `/reports?clientId=${A.client}`, `/retainers?clientId=${A.client}`, `/time-entries?clientId=${A.client}`, `/time-entries?userId=${A.member}`,
  `/time-entries?taskId=${A.task}`, `/calendar?from=${day(-30)}&to=${day(60)}&clientId=${A.client}`, `/calendar?from=${day(-30)}&to=${day(60)}&userId=${A.member}`, `/capacity?userId=${A.member}`,
  `/activity?actorId=${A.member}`, `/sop-changes?sopId=${A.sop}`, `/search?q=${MARK_A}`, `/search?q=Secret`, `/notifications?unread=1`, `/ai/proposals?status=pending`,
];

// ---- the sweep ----

async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sweep-'));
  const app = await boot({ google: (db) => createHub({ db, oauthApp: { clientId: 'c.apps.googleusercontent.com', clientSecret: 's' }, keyFile: path.join(dir, 'key'), fetchImpl: async () => { throw new Error('the network must not be used'); } }) });
  const hub = createHub({ db: app.db, oauthApp: { clientId: 'c.apps.googleusercontent.com', clientSecret: 's' }, keyFile: path.join(dir, 'key'), fetchImpl: async () => { throw new Error('no network'); } });
  // A first, so its ids are smaller than B's; B has its own record of every kind too.
  const A = await seedAgency(app.db, hub, 'a', MARK_A);
  const B = await seedAgency(app.db, hub, 'b', MARK_B);
  const asB = app.client(); await asB.signIn(`${B.tag}owner`);
  const asA = app.client(); await asA.signIn(`${A.tag}owner`);
  const asCon = app.client(); await asCon.signIn(A.contractor.username);
  const asEmp = app.client(); await asEmp.signIn(A.employee.username);
  return { app, A, B, asA, asB, asCon, asEmp };
}

// Runs a test body against a fresh pair of agencies and always closes the server, so a failed check cannot hang the run.
async function withSweep(fn) {
  const f = await build();
  try { await fn(f); } finally { await f.app.close(); }
}

const fill = (pattern, ids, map) => pattern.replace(/:(\w+)/g, (_, name) => String(map[ids[name]]));
// Request bodies may name ids of the attacker's own records ('OWN_...') or of the target's ('project').
const resolveBody = (body, A, B) => {
  if (body === undefined) return undefined;
  return JSON.parse(JSON.stringify(body, (k, v) => (typeof v === 'string' && A[v] !== undefined ? A[v] : typeof v === 'string' && v.startsWith('OWN_') ? B[v.slice(4)] : v)));
};
const denied = (status) => status === 403 || status === 404;

test('the sweep sees every route of the API: each id route has an attack, each other route is classified', async () => withSweep(async (f) => {
  const routes = routesOf(f.app.db);
  assert.ok(routes.length > 100, 'the router was read');
  const covered = new Set([...Object.keys(ID_ROUTES), ...ID_ROUTES_GLOBAL]);
  for (const { method, pattern } of routes) {
    const key = `${method} ${pattern}`;
    if (pattern.includes(':')) assert.ok(covered.has(key), `${key} takes an id: add it to ID_ROUTES in test/security-sweep.test.js`);
    else if (method !== 'GET') assert.ok(OWN_ONLY.has(key) || BODY_ROUTES({}).some(([m, p]) => m === method && p === pattern), `${key} changes data: add it to OWN_ONLY or BODY_ROUTES in test/security-sweep.test.js`);
  }
  for (const key of covered) assert.ok(routes.some((r) => `${r.method} ${r.pattern}` === key), `${key} is in the sweep but is no longer a route`);
}));

test('the two agencies really hold every kind of record (so the sweep is not empty)', async () => withSweep(async (f) => {
  const snap = snapshot(f.app.db, f.A.orgId);
  for (const table of REQUIRED_TABLES) assert.ok(snap[table].length > 0, `agency A has rows in ${table}`);
  for (const table of REQUIRED_TABLES) assert.ok(snapshot(f.app.db, f.B.orgId)[table].length > 0, `agency B has rows in ${table}`);
  assert.notEqual(f.A.ids.task, f.B.ids.task);
  // the owner of A reaches every one of A's ids (the control: the same requests succeed for the right person)
  for (const [key, entry] of Object.entries(ID_ROUTES)) {
    if (!key.startsWith('GET ')) continue;
    const url = fill(key.slice(4), entry.ids, f.A.ids) + (entry.query || '');
    const r = await f.asA.call('GET', url);
    assert.equal(r.status, 200, `${key} for A's own owner: ${JSON.stringify(r.data)}`);
  }
}));

test('a signed-in person of agency B gets not found or not allowed on every id route with A\'s ids, and nothing in A changes', async () => withSweep(async (f) => {
  const before = snapshot(f.app.db, f.A.orgId);
  for (const [key, entry] of Object.entries(ID_ROUTES)) {
    const [method, pattern] = key.split(' ');
    const url = fill(pattern, entry.ids, f.A.ids) + (entry.query || '');
    const r = await f.asB.call(method, url, resolveBody(entry.body, f.A.ids, f.B.ids));
    assert.ok(denied(r.status), `${key} with A's id answered ${r.status}: ${JSON.stringify(r.data)}`);
    assert.doesNotMatch(JSON.stringify(r.data), new RegExp(MARK_A), `${key} leaked A's data`);
  }
  // A's sign-in requests are unguessable ids that belong to no agency; a made-up one is simply gone
  for (const key of ID_ROUTES_GLOBAL) { const [method, pattern] = key.split(' '); const r = await f.asB.call(method, pattern.replace(':id', 'does-not-exist'), method === 'POST' ? { access: 'read' } : undefined); assert.equal(r.status, 404, key); }
  assert.deepEqual(snapshot(f.app.db, f.A.orgId), before, 'nothing in agency A changed');
  // and the other way round: the same attack on B's records from A fails too, so the sweep is symmetric
  const asA = f.asA;
  const beforeB = snapshot(f.app.db, f.B.orgId);
  for (const [key, entry] of Object.entries(ID_ROUTES)) {
    const [method, pattern] = key.split(' ');
    const r = await asA.call(method, fill(pattern, entry.ids, f.B.ids) + (entry.query || ''), resolveBody(entry.body, f.B.ids, f.A.ids));
    assert.ok(denied(r.status), `${key} with B's id answered ${r.status}`);
  }
  assert.deepEqual(snapshot(f.app.db, f.B.orgId), beforeB, 'nothing in agency B changed');
}));

test('routes that create or change something refuse ids of another agency in their body', async () => withSweep(async (f) => {
  const before = snapshot(f.app.db, f.A.orgId);
  const ownIds = f.B.ids;
  for (const [method, p, body] of BODY_ROUTES(f.A.ids)) {
    const url = p.replace(/OWN_(\w+)/g, (_, name) => String(ownIds[name]));
    const r = await f.asB.call(method, url, resolveBody(body, {}, { ...ownIds, project: ownIds.project, sop: ownIds.sop }));
    assert.ok([400, 403, 404].includes(r.status), `${method} ${p} with A's ids answered ${r.status}: ${JSON.stringify(r.data)}`);
    assert.doesNotMatch(JSON.stringify(r.data), new RegExp(MARK_A), `${method} ${p} leaked A's data`);
  }
  assert.deepEqual(snapshot(f.app.db, f.A.orgId), before, 'nothing in agency A changed');
}));

test('every list route returns none of A\'s rows to a person of B, with or without A\'s ids as filters', async () => withSweep(async (f) => {
  const routes = routesOf(f.app.db).filter((r) => r.method === 'GET' && !r.pattern.includes(':'));
  assert.ok(routes.length > 20);
  const skip = new Set(['/integrations/google/callback']); // a redirect that Google, not a person, starts
  const seen = [];
  for (const { pattern } of routes) {
    if (skip.has(pattern)) continue;
    const url = pattern === '/calendar' ? `/calendar?from=${day(-30)}&to=${day(60)}` : pattern === '/retainers' || pattern === '/search' ? `${pattern}${pattern === '/search' ? `?q=${MARK_A}` : ''}` : pattern;
    const r = await f.asB.call('GET', url);
    seen.push(pattern);
    assert.ok(r.status === 200 || r.status === 400, `${pattern} answered ${r.status}`);
    assert.doesNotMatch(JSON.stringify(pattern === '/search' ? r.data.groups : r.data), new RegExp(MARK_A), `${pattern} listed A's data`);
  }
  for (const url of FILTER_LISTS(f.A.ids)) {
    const r = await f.asB.call('GET', url);
    assert.ok([200, 400, 403, 404].includes(r.status), `${url} answered ${r.status}`);
    assert.doesNotMatch(JSON.stringify(url.startsWith('/search') && r.data ? r.data.groups : r.data), new RegExp(MARK_A), `${url} listed A's data`);
  }
  // B sees its own, so the lists are not simply empty
  assert.match(JSON.stringify((await f.asB.call('GET', '/tasks')).data), new RegExp(MARK_B));
  assert.match(JSON.stringify((await f.asB.call('GET', '/members')).data), new RegExp(MARK_B));
  assert.ok(seen.length >= 20);
}));

test('a Contractor of A cannot reach other people\'s private records by id', async () => withSweep(async (f) => {
  const before = snapshot(f.app.db, f.A.orgId);
  // The same attacks, from inside the agency, with a Contractor's sign-in. Records that are not theirs are not found;
  // everything else a Contractor may not use at all is refused.
  for (const [key, entry] of Object.entries(ID_ROUTES)) {
    const [method, pattern] = key.split(' ');
    const r = await f.asCon.call(method, fill(pattern, entry.ids, f.A.ids) + (entry.query || ''), resolveBody(entry.body, f.A.ids, f.A.ids));
    assert.ok(denied(r.status), `${key} as a Contractor answered ${r.status}: ${JSON.stringify(r.data)}`);
    assert.doesNotMatch(JSON.stringify(r.data), new RegExp(`${MARK_A}.*(Secret|private|Employee)`, 'i'), `${key} leaked something private`);
  }
  assert.deepEqual(snapshot(f.app.db, f.A.orgId), before, 'nothing changed');
  // what is theirs is theirs: the same kinds of request succeed on their own records
  const mine = f.A.ids;
  for (const url of [`/tasks/${mine.taskCon}`, `/tasks/${mine.taskCon}/comments`, `/tasks/${mine.taskCon}/trace`, `/events/${mine.eventCon}`, `/meeting-notes/${mine.noteCon}`, `/follow-ups/${mine.followUpCon}`, `/time-entries/${mine.timeCon}`]) {
    const r = await f.asCon.call('GET', url);
    assert.equal(r.status, 200, `${url} is the Contractor's own: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await f.asCon.call('POST', `/notifications/${mine.notificationCon}/read`)).status, 200);
  assert.equal((await f.asCon.call('POST', `/notifications/${mine.notification}/read`)).status, 404, 'another person\'s notification is not found');
  assert.equal(f.app.db.prepare('SELECT read_at FROM notifications WHERE id = ?').get(mine.notification).read_at, null, 'and it stays unread');
  // lists show only what is theirs
  const list = async (url) => JSON.stringify((await f.asCon.call('GET', url)).data);
  assert.doesNotMatch(await list('/tasks'), /Employee task|QA task/);
  assert.match(await list('/tasks'), /Contractor task/);
  assert.doesNotMatch(await list(`/meeting-notes`), /Private notes|Event notes/);
  assert.doesNotMatch(await list(`/calendar?from=${day(-30)}&to=${day(60)}`), /Team event/);
  assert.doesNotMatch(await list('/follow-ups'), /Follow-up AGENCY|"Follow-up /);
  assert.doesNotMatch(await list('/time-entries'), /Secret time|Approved time/);
  assert.doesNotMatch(await list('/notifications'), /Employee task/);
  assert.deepEqual(JSON.parse(await list('/search?q=Secret%20discussion')).groups, [], 'the words of a note they cannot open do not find it');
  assert.deepEqual(JSON.parse(await list('/search?q=Secret%20time')).groups, []);
  assert.doesNotMatch(await list('/sop-changes'), /SOP change AGENCY/);
  for (const url of ['/clients', '/projects', '/requests', '/decisions', '/reports', '/retainers', '/members', '/activity', '/api-keys', '/ai/proposals', '/qa', '/sops']) {
    const r = await f.asCon.call('GET', url);
    assert.ok(r.status === 403 || (r.status === 200 && Array.isArray(r.data) && r.data.length === 0), `${url} for a Contractor answered ${r.status}`);
  }
}));

// ---- the AI endpoint ----

const rpc = (app, token) => async (name, args) => {
  const res = await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const body = await res.json();
  return { isError: !!(body.result && body.result.isError), text: body.result ? body.result.content[0].text : JSON.stringify(body) };
};

// How to ask each read tool for A's records by id (null: it takes no id; it must simply list none of A's).
const READ_ATTACKS = (A) => ({
  list_clients: null, get_client: { id: A.client }, list_projects: { clientId: A.client }, get_project: { id: A.project }, list_tasks: { projectId: A.project }, get_task: { id: A.task },
  list_events: { from: day(-30), to: day(60), clientId: A.client }, get_event: { id: A.event }, list_meeting_notes: { clientId: A.client }, get_meeting_note: { id: A.note },
  list_requests: { clientId: A.client }, get_request: { id: A.request }, list_decisions: { clientId: A.client }, list_follow_ups: { clientId: A.client }, get_meeting_brief: { noteId: A.note },
  get_workspace: null, list_notifications: null, list_team: null, get_workload: null, list_sops: null, get_sop: { id: A.sop }, list_services: null, list_goals: { clientId: A.client },
  get_metrics: { clientId: A.client }, list_results: { clientId: A.client }, get_report_data: { clientId: A.client, from: day(-30), to: day() }, list_reports: { clientId: A.client }, get_report: { id: A.report },
  list_sop_changes: { sopId: A.sop }, get_sop_change: { id: A.sopChange }, list_qa_queue: null, search_agency: { q: MARK_A }, list_time_entries: { clientId: A.client, userId: A.member },
  get_workload_capacity: { userId: A.member }, get_retainer_usage: { clientId: A.client }, get_client_timeline: { clientId: A.client }, trace_task: { taskId: A.task },
});

// How to change A's records through each action of a plan (null: the action creates something from scratch and takes no id).
const WRITE_ATTACKS = (A) => ({
  create_client: { name: 'Planted', serviceIds: [A.service], accountOwnerId: A.member }, update_client: { id: A.client, name: 'Hacked' }, create_contact: { clientId: A.client, name: 'Planted' },
  create_project: { clientId: A.client, name: 'Planted' }, update_project: { id: A.project, name: 'Hacked' }, create_task: { projectId: A.project, title: 'Planted' }, update_task: { id: A.task, title: 'Hacked' },
  create_event: { title: 'Planted', startsAt: `${day(3)}T10:00:00Z`, clientId: A.client }, update_event: { id: A.event, title: 'Hacked' }, create_meeting_note: { title: 'Planted', meetingDate: day(), eventId: A.event },
  update_meeting_note: { id: A.note, title: 'Hacked' }, create_request: { clientId: A.client, title: 'Planted' }, update_request: { id: A.request, title: 'Hacked' }, create_decision: { title: 'Planted', decidedOn: day(), clientId: A.client },
  update_decision: { id: A.decision, title: 'Hacked' }, create_follow_up: { title: 'Planted', clientId: A.client }, update_follow_up: { id: A.followUp, title: 'Hacked' }, create_records_from_note: { noteId: A.note },
  log_time: { taskId: A.task, minutes: 10 }, update_time_entry: { id: A.timeEntry, minutes: 5 }, add_comment: { taskId: A.task, body: 'Planted' }, record_result: { clientId: A.client, metric: 'Planted', value: 1 },
  create_report: { clientId: A.client, title: 'Planted', periodStart: day(-5), periodEnd: day() }, update_report: { id: A.report, title: 'Hacked' }, generate_report: { clientId: A.client, periodStart: day(-5), periodEnd: day() },
  create_goal: { clientId: A.client, title: 'Planted' }, update_goal: { id: A.goal, title: 'Hacked' }, create_sop: null, update_sop: { id: A.sop, title: 'Hacked' }, add_sop_version: { id: A.sop, ...CONTENT, changeNote: 'Planted' },
  create_sop_change: { sopId: A.sop, title: 'Planted', details: 'Planted' }, update_sop_change: { id: A.sopChange, title: 'Hacked' }, create_tasks_from_sop: { sopId: A.sop, projectId: A.project },
});

test('the AI tool list and plan actions are all in the sweep', () => {
  for (const tool of TOOLS.filter((t) => !t.write)) assert.ok(tool.name in READ_ATTACKS({}), `${tool.name} is a read tool: add it to READ_ATTACKS`);
  for (const name of Object.keys(READ_ATTACKS({}))) assert.ok(TOOLS.some((t) => t.name === name && !t.write), `${name} is in READ_ATTACKS but is not a read tool`);
  for (const action of Object.keys(ACTIONS)) assert.ok(action in WRITE_ATTACKS({}), `${action} is a plan action: add it to WRITE_ATTACKS`);
  for (const action of Object.keys(WRITE_ATTACKS({}))) assert.ok(action in ACTIONS, `${action} is in WRITE_ATTACKS but is not an action`);
  // every write tool maps to an action that is attacked
  for (const tool of TOOLS.filter((t) => t.write && t.name !== 'apply_changes')) assert.ok(tool.submit({}).steps[0].action in ACTIONS, tool.name);
});

test('a key of agency B cannot read or write A\'s records through any AI tool', async () => withSweep(async (f) => {
  const call = rpc(f.app, f.B.token);
  const before = snapshot(f.app.db, f.A.orgId);
  for (const [name, args] of Object.entries(READ_ATTACKS(f.A.ids))) {
    const r = await call(name, args || {});
    // a search answer repeats the words asked for, so only its groups are checked
    assert.doesNotMatch(name === 'search_agency' ? JSON.stringify(JSON.parse(r.text).groups) : r.text, new RegExp(MARK_A), `${name} showed A's data: ${r.text.slice(0, 200)}`);
  }
  // reads by id are errors, not empty answers (the record is "not found" for B)
  for (const name of ['get_client', 'get_project', 'get_task', 'get_event', 'get_meeting_note', 'get_request', 'get_meeting_brief', 'get_sop', 'get_report', 'get_sop_change', 'trace_task', 'get_client_timeline', 'get_metrics', 'list_goals', 'list_results', 'get_report_data']) {
    const r = await call(name, READ_ATTACKS(f.A.ids)[name]);
    assert.equal(r.isError, true, `${name} with A's id should be an error: ${r.text.slice(0, 200)}`);
  }
  // writes: each action on its own, as a plan, and as the tool of the same name
  for (const [action, args] of Object.entries(WRITE_ATTACKS(f.A.ids))) {
    if (args === null) continue;
    const plan = await call('apply_changes', { summary: `Attack ${action}`, steps: [{ action, args }] });
    assert.equal(plan.isError, true, `apply_changes ${action} with A's ids should fail: ${plan.text.slice(0, 200)}`);
    assert.doesNotMatch(plan.text, new RegExp(MARK_A), action);
  }
  for (const tool of TOOLS.filter((t) => t.write && t.name !== 'apply_changes')) {
    const action = tool.submit({}).steps[0].action;
    const args = WRITE_ATTACKS(f.A.ids)[action];
    if (args === null) continue;
    const r = await call(tool.name, args);
    assert.equal(r.isError, true, `${tool.name} with A's ids should fail: ${r.text.slice(0, 200)}`);
  }
  assert.deepEqual(snapshot(f.app.db, f.A.orgId), before, 'nothing in agency A changed');
  // control: the key of A reads and writes A's own records
  const own = rpc(f.app, f.A.token);
  assert.equal((await own('get_task', { id: f.A.ids.task })).isError, false);
  assert.equal((await own('trace_task', { taskId: f.A.ids.task })).isError, false);
  assert.equal((await own('apply_changes', { summary: 'Own change', steps: [{ action: 'update_task', args: { id: f.A.ids.task, title: 'Changed by A' } }] })).isError, false);
}));
