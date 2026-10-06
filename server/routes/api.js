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
const { ServiceError } = require('../services/errors');

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new ServiceError(404, 'Not found');
  return id;
}

module.exports = function apiRouter(db) {
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
  r.get('/dashboard', (req, res) => res.json(dashboard.getDashboard(db, ctxOf(req))));

  r.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return r;
};
