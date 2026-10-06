// Joshua Nunez
const express = require('express');
const config = require('../config');
const mw = require('../middleware');
const auth = require('../services/auth');
const perms = require('../services/permissions');
const orgs = require('../services/organizations');
const members = require('../services/members');
const profiles = require('../services/profiles');
const activity = require('../services/activity');
const dashboard = require('../services/dashboard');
const clients = require('../services/clients');
const projects = require('../services/projects');
const tasks = require('../services/tasks');
const apikeys = require('../services/apikeys');
const aiplans = require('../services/aiplans');
const oauth = require('../services/oauth');
const sops = require('../services/sops');
const qa = require('../services/qa');
const services = require('../services/services');
const goals = require('../services/goals');
const results = require('../services/results');
const reports = require('../services/reports');
const googlesync = require('../services/googlesync');
const { ServiceError } = require('../services/errors');

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ServiceError(404, 'Not found');
  return id;
}

module.exports = function apiRouter(db, { google = null } = {}) {
  const r = express.Router();
  const ctxOf = (req) => ({ organizationId: req.auth.organization.id, actor: { id: req.auth.user.id, role: req.auth.role }, ip: req.ip, source: 'web' });
  const sessionBody = (a) => ({
    user: a.user, organization: a.organization, role: a.role, csrf: a.csrf,
    // What this role may do, worked out on the server, so the screens never need their own copy of the rules.
    can: Object.fromEntries(Object.keys(perms.ACTIONS).map((action) => [action, perms.can(a.role, action)])),
    assignableRoles: perms.assignableRoles(a.role),
  });

  // ---- open routes ----
  r.get('/status', (req, res) => res.json({ needsSetup: orgs.needsSetup(db), setupCodeRequired: !!config.setupToken }));

  r.post('/setup', mw.wrap(async (req, res) => {
    await orgs.setupOrganization(db, { ...req.body, ip: req.ip }, { setupToken: config.setupToken });
    res.json({ ok: true });
  }));

  r.post('/login', mw.wrap(async (req, res) => {
    const result = await auth.login(db, { username: req.body.username, password: req.body.password, ip: req.ip, userAgent: req.get('user-agent') });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    mw.setSessionCookie(req, res, result.session.token, result.session.expires);
    res.json({ ok: true });
  }));

  // ---- everything below needs a signed-in person ----
  r.use(mw.requireAuth, mw.requireCsrf, mw.requirePasswordChanged);

  r.get('/session', (req, res) => res.json(sessionBody(req.auth)));

  r.post('/logout', (req, res) => {
    auth.destroySession(db, req.auth.sessionId);
    mw.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  r.post('/password', mw.wrap(async (req, res) => {
    await auth.changePassword(db, ctxOf(req), { current: req.body.current, next: req.body.next, keepSessionId: req.auth.sessionId });
    res.json({ ok: true });
  }));

  r.get('/org', (req, res) => res.json(orgs.getOrganization(db, ctxOf(req))));
  r.patch('/org', (req, res) => res.json(orgs.updateOrganization(db, ctxOf(req), req.body)));

  r.get('/members', (req, res) => res.json(members.listMembers(db, ctxOf(req))));
  r.post('/members', mw.wrap(async (req, res) => res.json(await members.createMember(db, ctxOf(req), req.body))));
  r.patch('/members/:id', (req, res) => res.json(members.updateMember(db, ctxOf(req), idParam(req), req.body)));
  r.post('/members/:id/reset-password', mw.wrap(async (req, res) => res.json(await members.resetPassword(db, ctxOf(req), idParam(req), req.body))));
  r.get('/members/:id/profile', (req, res) => res.json(profiles.getProfile(db, ctxOf(req), idParam(req))));
  r.patch('/members/:id/profile', (req, res) => res.json(profiles.updateProfile(db, ctxOf(req), idParam(req), req.body)));

  r.get('/profile', (req, res) => res.json(profiles.getProfile(db, ctxOf(req), req.auth.user.id)));
  r.patch('/profile', (req, res) => res.json(profiles.updateProfile(db, ctxOf(req), req.auth.user.id, req.body)));

  r.get('/activity', (req, res) => res.json(activity.listActivity(db, ctxOf(req), { actorId: req.query.actorId, action: req.query.action, limit: req.query.limit })));
  r.get('/clients', (req, res) => res.json(clients.listClients(db, ctxOf(req), { status: req.query.status })));
  r.post('/clients', (req, res) => res.json(clients.createClient(db, ctxOf(req), req.body)));
  r.get('/clients/:id', (req, res) => res.json(clients.getClient(db, ctxOf(req), idParam(req))));
  r.patch('/clients/:id', (req, res) => res.json(clients.updateClient(db, ctxOf(req), idParam(req), req.body)));
  r.post('/clients/:id/contacts', (req, res) => res.json(clients.addContact(db, ctxOf(req), idParam(req), req.body)));
  r.patch('/contacts/:id', (req, res) => res.json(clients.updateContact(db, ctxOf(req), idParam(req), req.body)));
  r.delete('/contacts/:id', (req, res) => res.json(clients.deleteContact(db, ctxOf(req), idParam(req))));

  r.get('/projects', (req, res) => res.json(projects.listProjects(db, ctxOf(req), { clientId: req.query.clientId, status: req.query.status })));
  r.post('/projects', (req, res) => res.json(projects.createProject(db, ctxOf(req), req.body)));
  r.get('/projects/:id', (req, res) => res.json(projects.getProject(db, ctxOf(req), idParam(req))));
  r.patch('/projects/:id', (req, res) => res.json(projects.updateProject(db, ctxOf(req), idParam(req), req.body)));

  r.get('/tasks', (req, res) => res.json(tasks.listTasks(db, ctxOf(req), req.query)));
  r.post('/tasks', (req, res) => res.json(tasks.createTask(db, ctxOf(req), req.body)));
  r.get('/tasks/:id', (req, res) => res.json(tasks.getTask(db, ctxOf(req), idParam(req))));
  r.patch('/tasks/:id', (req, res) => res.json(tasks.updateTask(db, ctxOf(req), idParam(req), req.body)));
  r.delete('/tasks/:id', (req, res) => res.json(tasks.deleteTask(db, ctxOf(req), idParam(req))));
  r.get('/tasks/:id/comments', (req, res) => res.json(tasks.listComments(db, ctxOf(req), idParam(req))));
  r.post('/tasks/:id/comments', (req, res) => res.json(tasks.addComment(db, ctxOf(req), idParam(req), req.body)));

  r.get('/integrations/google', (req, res) => res.json(googlesync.status(db, ctxOf(req), google)));
  r.get('/integrations/google/available', mw.wrap(async (req, res) => res.json(await googlesync.available(db, ctxOf(req), google))));
  r.get('/clients/:id/google', (req, res) => res.json(googlesync.getLink(db, ctxOf(req), idParam(req))));
  r.put('/clients/:id/google', mw.wrap(async (req, res) => res.json(await googlesync.connect(db, ctxOf(req), google, idParam(req), req.body))));
  r.post('/clients/:id/google/sync', mw.wrap(async (req, res) => res.json(await googlesync.sync(db, ctxOf(req), google, idParam(req), { months: req.body && req.body.months }))));
  r.delete('/clients/:id/google', (req, res) => res.json(googlesync.disconnect(db, ctxOf(req), idParam(req))));
  r.get('/clients/:id/results', (req, res) => res.json(results.listResults(db, ctxOf(req), idParam(req), { metric: req.query.metric, from: req.query.from, to: req.query.to })));
  r.get('/clients/:id/metrics', (req, res) => res.json(results.metricsSummary(db, ctxOf(req), idParam(req))));
  r.post('/clients/:id/results', (req, res) => res.json(results.recordResult(db, ctxOf(req), idParam(req), req.body)));
  r.patch('/results/:id', (req, res) => res.json(results.updateResult(db, ctxOf(req), idParam(req), req.body)));
  r.delete('/results/:id', (req, res) => res.json(results.deleteResult(db, ctxOf(req), idParam(req))));
  r.get('/clients/:id/report-data', (req, res) => res.json(reports.reportData(db, ctxOf(req), idParam(req), { from: req.query.from, to: req.query.to })));
  r.post('/clients/:id/reports/generate', (req, res) => res.json(reports.generateReport(db, ctxOf(req), idParam(req), req.body)));
  r.get('/reports', (req, res) => res.json(reports.listReports(db, ctxOf(req), { clientId: req.query.clientId, status: req.query.status })));
  r.post('/reports', (req, res) => res.json(reports.createReport(db, ctxOf(req), req.body)));
  r.get('/reports/:id', (req, res) => res.json(reports.getReport(db, ctxOf(req), idParam(req))));
  r.patch('/reports/:id', (req, res) => res.json(reports.updateReport(db, ctxOf(req), idParam(req), req.body)));
  r.post('/reports/:id/approve', (req, res) => res.json(reports.approveReport(db, ctxOf(req), idParam(req))));
  r.delete('/reports/:id', (req, res) => res.json(reports.deleteReport(db, ctxOf(req), idParam(req))));

  r.get('/services', (req, res) => res.json(services.listServices(db, ctxOf(req), { all: req.query.all === '1' })));
  r.post('/services', (req, res) => res.json(services.createService(db, ctxOf(req), req.body)));
  r.post('/services/defaults', (req, res) => res.json(services.addDefaultServices(db, ctxOf(req))));
  r.patch('/services/:id', (req, res) => res.json(services.updateService(db, ctxOf(req), idParam(req), req.body)));
  r.get('/clients/:id/goals', (req, res) => res.json(goals.listGoals(db, ctxOf(req), idParam(req), { status: req.query.status })));
  r.post('/clients/:id/goals', (req, res) => res.json(goals.createGoal(db, ctxOf(req), idParam(req), req.body)));
  r.patch('/goals/:id', (req, res) => res.json(goals.updateGoal(db, ctxOf(req), idParam(req), req.body)));

  r.get('/sops', (req, res) => res.json(sops.listSops(db, ctxOf(req), { status: req.query.status, service: req.query.service, q: req.query.q })));
  r.post('/sops', (req, res) => res.json(sops.createSop(db, ctxOf(req), req.body)));
  r.get('/sops/:id', (req, res) => res.json(sops.getSop(db, ctxOf(req), idParam(req))));
  r.patch('/sops/:id', (req, res) => res.json(sops.updateSop(db, ctxOf(req), idParam(req), req.body)));
  r.post('/sops/:id/versions', (req, res) => res.json(sops.addVersion(db, ctxOf(req), idParam(req), req.body)));
  r.get('/sops/:id/versions/:versionId', (req, res) => res.json(sops.getVersion(db, ctxOf(req), idParam(req), req.params.versionId)));
  r.post('/sops/:id/tasks', (req, res) => res.json(tasks.createTasksFromSop(db, ctxOf(req), idParam(req), req.body)));
  r.get('/qa', (req, res) => res.json(qa.listQueue(db, ctxOf(req))));
  r.post('/tasks/:id/qa', (req, res) => res.json(qa.reviewTask(db, ctxOf(req), idParam(req), req.body)));

  r.get('/api-keys', (req, res) => res.json(apikeys.listKeys(db, ctxOf(req))));
  r.post('/api-keys', (req, res) => res.json(apikeys.createKey(db, ctxOf(req), req.body)));
  r.patch('/api-keys/:id', (req, res) => res.json(apikeys.updateKey(db, ctxOf(req), idParam(req), req.body)));
  r.delete('/api-keys/:id', (req, res) => res.json(apikeys.revokeKey(db, ctxOf(req), idParam(req))));
  r.get('/ai/proposals', (req, res) => res.json(aiplans.listProposals(db, ctxOf(req), { status: req.query.status })));
  r.post('/ai/proposals/:id/approve', (req, res) => res.json(aiplans.approveProposal(db, ctxOf(req), idParam(req))));
  r.post('/ai/proposals/:id/reject', (req, res) => res.json(aiplans.rejectProposal(db, ctxOf(req), idParam(req))));

  // Approving a sign-in from an AI app such as claude.ai (the app sent the person here from /oauth/authorize).
  r.get('/oauth/requests/:id', (req, res) => res.json(oauth.getRequest(db, ctxOf(req), req.params.id)));
  r.post('/oauth/requests/:id/approve', (req, res) => res.json(oauth.decideRequest(db, ctxOf(req), req.params.id, { approve: true, access: req.body.access })));
  r.post('/oauth/requests/:id/deny', (req, res) => res.json(oauth.decideRequest(db, ctxOf(req), req.params.id, { approve: false })));

  r.get('/dashboard', (req, res) => res.json(dashboard.getDashboard(db, ctxOf(req))));

  r.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
};
