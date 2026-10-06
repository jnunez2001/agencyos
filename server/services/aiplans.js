// Joshua Nunez
// What an AI may change, as a "plan": an ordered list of steps run inside one transaction, so a plan is all or
// nothing. Every step goes through the same services, permission checks and validation as the screens, as the
// person who owns the key. A key set to "propose" stores the plan in the AI inbox until an Owner or Admin approves.
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { cleanText } = require('./validate');
const perms = require('./permissions');
const clients = require('./clients');
const projects = require('./projects');
const tasks = require('./tasks');

const MAX_STEPS = 50;
const REF_KEYS = ['clientId', 'projectId', 'taskId', 'id'];
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;

const withId = (args, fn) => { const { id, ...rest } = args; return fn(id, rest); };

// Everything an AI can do. Nothing here touches members, roles, passwords, keys or settings, and nothing deletes.
const ACTIONS = {
  create_client: (db, ctx, a) => clients.createClient(db, ctx, a),
  update_client: (db, ctx, a) => withId(a, (id, rest) => clients.updateClient(db, ctx, id, rest)),
  create_contact: (db, ctx, a) => { const { clientId, ...rest } = a; return clients.addContact(db, ctx, clientId, rest); },
  create_project: (db, ctx, a) => projects.createProject(db, ctx, a),
  update_project: (db, ctx, a) => withId(a, (id, rest) => projects.updateProject(db, ctx, id, rest)),
  create_task: (db, ctx, a) => tasks.createTask(db, ctx, a),
  update_task: (db, ctx, a) => withId(a, (id, rest) => tasks.updateTask(db, ctx, id, rest)),
  add_comment: (db, ctx, a) => { const { taskId, ...rest } = a; return tasks.addComment(db, ctx, taskId, rest); },
};

const fail = (status, message) => { throw new ServiceError(status, message); };
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function checkPlan(plan) {
  if (!isPlainObject(plan)) fail(400, 'Send a plan with a summary and steps');
  const summary = cleanText(plan.summary, 'Summary', 1, 300);
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) fail(400, 'A plan needs at least one step');
  if (plan.steps.length > MAX_STEPS) fail(400, `A plan can have at most ${MAX_STEPS} steps`);
  const names = new Set();
  const steps = plan.steps.map((s, i) => {
    const at = `Step ${i + 1}`;
    if (!isPlainObject(s) || !Object.prototype.hasOwnProperty.call(ACTIONS, s.action)) fail(400, `${at}: unknown action. Use one of ${Object.keys(ACTIONS).join(', ')}`);
    if (!isPlainObject(s.args)) fail(400, `${at} (${s.action}): args must be an object`);
    if (s.as !== undefined) {
      if (typeof s.as !== 'string' || !NAME_PATTERN.test(s.as)) fail(400, `${at} (${s.action}): "as" must be a name of letters, numbers and underscores`);
      if (names.has(s.as)) fail(400, `${at} (${s.action}): the name ${s.as} is already used by an earlier step`);
      names.add(s.as);
    }
    return { action: s.action, as: s.as, args: s.args };
  });
  return { summary, steps };
}

// "$site" in clientId, projectId, taskId or id means the record an earlier step created.
function resolveRefs(args, aliases, at) {
  const out = { ...args };
  for (const key of REF_KEYS) {
    const v = out[key];
    if (typeof v === 'string' && v.startsWith('$')) {
      const name = v.slice(1);
      if (!Object.prototype.hasOwnProperty.call(aliases, name)) fail(400, `${at}: ${v} is not defined by an earlier step`);
      out[key] = aliases[name];
    }
  }
  return out;
}

// Runs every step in order. The caller owns the transaction.
function execute(db, ctx, steps) {
  const aliases = {};
  return steps.map((s, i) => {
    const at = `Step ${i + 1} (${s.action})`;
    try {
      const result = ACTIONS[s.action](db, ctx, resolveRefs(s.args, aliases, at));
      if (s.as) aliases[s.as] = result.id;
      return { action: s.action, as: s.as || null, id: result.id == null ? null : result.id, name: result.name || result.title || null };
    } catch (err) {
      if (err instanceof ServiceError) throw new ServiceError(err.status, err.message.startsWith('Step ') ? err.message : `${at}: ${err.message}`);
      throw err;
    }
  });
}

class Rollback extends Error {}

// Runs the plan and undoes everything, to find mistakes without changing anything.
function dryRun(db, ctx, steps) {
  try {
    db.transaction(() => { execute(db, ctx, steps); throw new Rollback('dry run'); })();
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

const trim = (text, n = 60) => (String(text).length > n ? `${String(text).slice(0, n - 1)}…` : String(text));

// Readable lines for the inbox. Names of records an earlier step creates come from that step.
function describe(db, organizationId, steps) {
  const aliasName = {};
  const nameOf = (table, col, v) => {
    if (typeof v === 'string' && v.startsWith('$')) return aliasName[v.slice(1)] ? `"${aliasName[v.slice(1)]}"` : v;
    const row = Number.isInteger(Number(v)) && db.prepare(`SELECT ${col} AS n FROM ${table} WHERE organization_id = ? AND id = ?`).get(organizationId, Number(v));
    return row ? `"${row.n}"` : `#${v}`;
  };
  return steps.map((s) => {
    const a = s.args;
    const changed = Object.keys(a).filter((k) => k !== 'id' && !REF_KEYS.includes(k)).join(', ');
    let line;
    switch (s.action) {
      case 'create_client': line = `Create client "${a.name}"`; break;
      case 'update_client': line = `Change client ${nameOf('clients', 'name', a.id)}: ${changed}`; break;
      case 'create_contact': line = `Add contact "${a.name}" to ${nameOf('clients', 'name', a.clientId)}`; break;
      case 'create_project': line = `Create project "${a.name}" for ${nameOf('clients', 'name', a.clientId)}`; break;
      case 'update_project': line = `Change project ${nameOf('projects', 'name', a.id)}: ${changed}`; break;
      case 'create_task': line = `Create task "${a.title}" in ${nameOf('projects', 'name', a.projectId)}`; break;
      case 'update_task': line = `Change task ${nameOf('tasks', 'title', a.id)}: ${changed}`; break;
      case 'add_comment': line = `Comment on ${nameOf('tasks', 'title', a.taskId)}: ${trim(a.body || '')}`; break;
      default: line = s.action;
    }
    if (s.as) aliasName[s.as] = a.name || a.title;
    return line;
  });
}

// `auth` is what apikeys.authenticate returns.
function submitPlan(db, auth, plan) {
  if (auth.access === 'read') fail(403, 'This key can only read. Change its access to let the AI make changes');
  const { summary, steps } = checkPlan(plan);
  const ctx = { organizationId: auth.organizationId, actor: auth.actor, source: 'ai', ip: null };
  if (auth.access === 'direct') {
    return { status: 'applied', results: db.transaction(() => execute(db, ctx, steps))() };
  }
  dryRun(db, ctx, steps);
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO ai_proposals (organization_id, api_key_id, user_id, summary, steps_json) VALUES (?, ?, ?, ?, ?)').run(auth.organizationId, auth.keyId, auth.actor.id, summary, JSON.stringify(steps)).lastInsertRowid);
    logActivity(db, { organizationId: auth.organizationId, actorUserId: auth.actor.id, action: 'ai.proposal.create', objectType: 'ai_proposal', objectId: id, after: { summary, steps: steps.length }, source: 'ai' });
    return { status: 'pending', proposalId: id, lines: describe(db, auth.organizationId, steps) };
  })();
}

// ---- the inbox ----

const need = (ctx) => { if (!perms.can(ctx.actor.role, 'ai.approve')) fail(403, 'Not allowed'); };
const logCtx = (ctx) => ({ organizationId: ctx.organizationId, actorUserId: ctx.actor.id, source: ctx.source || 'web', ip: ctx.ip || null });

const SELECT = `
  SELECT p.id, p.summary, p.status, p.error, p.steps_json, p.created_at AS createdAt, p.decided_at AS decidedAt,
         k.name AS keyName, ou.display_name AS ownerName, du.display_name AS decidedByName
    FROM ai_proposals p
    LEFT JOIN api_keys k ON k.id = p.api_key_id
    JOIN users ou ON ou.id = p.user_id
    LEFT JOIN users du ON du.id = p.decided_by
   WHERE p.organization_id = ?`;

function listProposals(db, ctx, { status } = {}) {
  need(ctx);
  const rows = db.prepare(`${SELECT} ${status ? 'AND p.status = ?' : ''} ORDER BY p.id DESC LIMIT 100`).all(...(status ? [ctx.organizationId, status] : [ctx.organizationId]));
  return rows.map(({ steps_json: json, ...r }) => ({ ...r, steps: JSON.parse(json).length, lines: describe(db, ctx.organizationId, JSON.parse(json)) }));
}

function pendingCount(db, ctx) {
  if (!perms.can(ctx.actor.role, 'ai.approve')) return 0;
  return db.prepare("SELECT COUNT(*) AS n FROM ai_proposals WHERE organization_id = ? AND status = 'pending'").get(ctx.organizationId).n;
}

function findPending(db, organizationId, id) {
  const row = db.prepare('SELECT * FROM ai_proposals WHERE organization_id = ? AND id = ?').get(organizationId, Number(id));
  if (!row) fail(404, 'Proposal not found');
  if (row.status !== 'pending') fail(409, 'This proposal was already decided');
  return row;
}

function approveProposal(db, ctx, id) {
  need(ctx);
  const p = findPending(db, ctx.organizationId, id);
  const steps = JSON.parse(p.steps_json);
  // It runs as the person who owns the key, with their role as it is now.
  const owner = db.prepare('SELECT m.role FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.id = ? AND u.is_active = 1').get(ctx.organizationId, p.user_id);
  const decide = (status, error) => {
    db.prepare("UPDATE ai_proposals SET status = ?, error = ?, decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, error || null, ctx.actor.id, p.id);
  };
  try {
    if (!owner) fail(400, 'The person who owns this key is no longer active');
    const run = { organizationId: ctx.organizationId, actor: { id: p.user_id, role: owner.role }, source: 'ai', ip: null };
    const results = db.transaction(() => {
      const r = execute(db, run, steps);
      decide('approved');
      logActivity(db, { ...logCtx(ctx), action: 'ai.proposal.approve', objectType: 'ai_proposal', objectId: p.id, after: { summary: p.summary } });
      return r;
    })();
    return { status: 'approved', results };
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err;
    db.transaction(() => {
      decide('failed', err.message);
      logActivity(db, { ...logCtx(ctx), action: 'ai.proposal.fail', objectType: 'ai_proposal', objectId: p.id, after: { error: err.message } });
    })();
    return { status: 'failed', error: err.message };
  }
}

function rejectProposal(db, ctx, id) {
  need(ctx);
  const p = findPending(db, ctx.organizationId, id);
  db.transaction(() => {
    db.prepare("UPDATE ai_proposals SET status = 'rejected', decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(ctx.actor.id, p.id);
    logActivity(db, { ...logCtx(ctx), action: 'ai.proposal.reject', objectType: 'ai_proposal', objectId: p.id, after: { summary: p.summary } });
  })();
  return { status: 'rejected' };
}

module.exports = { MAX_STEPS, ACTIONS, submitPlan, listProposals, pendingCount, approveProposal, rejectProposal };
