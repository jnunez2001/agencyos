// Joshua Nunez
// The MCP server: JSON-RPC 2.0 over POST /mcp with a Bearer API key. It exposes tools that call the same services
// as the screens, as the person who owns the key. Reads work for every key; writes go through plans (aiplans.js).
const apikeys = require('./services/apikeys');
const plans = require('./services/aiplans');
const clients = require('./services/clients');
const projects = require('./services/projects');
const tasks = require('./services/tasks');
const members = require('./services/members');
const dashboard = require('./services/dashboard');
const sops = require('./services/sops');
const qa = require('./services/qa');
const services = require('./services/services');
const goals = require('./services/goals');
const { ServiceError } = require('./services/errors');
const { originOf } = require('./oauthRoutes');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const RATE = { windowMs: 60 * 1000, max: 120 };

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'integer', description });

const CLIENT_FIELDS = { name: str('Client name'), status: { type: 'string', enum: ['lead', 'onboarding', 'active', 'paused', 'at_risk', 'completed', 'archived'] }, accountOwnerId: num('Team member id'), startDate: str('YYYY-MM-DD'), serviceIds: { type: 'array', items: { type: 'integer' }, description: 'Service ids from list_services' }, website: str('Website'), industry: str('Industry'), notes: str('Notes') };
const PROJECT_FIELDS = { serviceId: num('Service id'), goalId: num('A goal of the same client'), name: str('Project name'), description: str('Description'), status: { type: 'string', enum: ['planning', 'active', 'on_hold', 'completed', 'archived'] }, startDate: str('YYYY-MM-DD'), dueDate: str('YYYY-MM-DD'), managerId: num('Team member id') };
const TASK_FIELDS = { goalId: num('A goal of the same client'), sopId: num('SOP to follow (testing or approved)'), qaRequired: { type: 'boolean' }, title: str('Task title'), description: str('Description'), status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, assigneeId: num('Team member id'), dueDate: str('YYYY-MM-DD'), estimateHours: { type: 'number' } };

const PLAN_NOTE = ' With a key that asks first, the change waits in the AI inbox until a person approves it.';
const asPlan = (summary, action, args) => ({ summary, steps: [{ action, args }] });
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

// name, description, input schema, whether it changes anything, and how to run it.
const TOOLS = [
  { name: 'list_clients', description: 'List the agency\'s clients with their services, optionally by status.', schema: obj({ status: { type: 'string', enum: ['lead', 'onboarding', 'active', 'paused', 'at_risk', 'completed', 'archived'] } }), run: (db, ctx, a) => clients.listClients(db, ctx, { status: a.status }) },
  { name: 'get_client', description: 'One client with its contacts, projects, services and goals.', schema: obj({ id: num('Client id') }, ['id']), run: (db, ctx, a) => clients.getClient(db, ctx, a.id) },
  { name: 'list_projects', description: 'List projects, optionally for one client or one status.', schema: obj({ clientId: num('Client id'), status: str('planning, active, on_hold, completed or archived') }), run: (db, ctx, a) => projects.listProjects(db, ctx, a) },
  { name: 'get_project', description: 'One project with its task counts.', schema: obj({ id: num('Project id') }, ['id']), run: (db, ctx, a) => projects.getProject(db, ctx, a.id) },
  { name: 'list_tasks', description: 'List tasks. Filters: projectId, assigneeId, status, overdue, mine, q (search in the title).', schema: obj({ projectId: num('Project id'), assigneeId: num('Team member id'), status: str('todo, in_progress, review or done'), overdue: { type: 'boolean' }, mine: { type: 'boolean', description: 'Only tasks assigned to the key owner' }, q: str('Search text') }),
    run: (db, ctx, a) => tasks.listTasks(db, ctx, { ...a, overdue: a.overdue ? '1' : '', mine: a.mine ? '1' : '' }) },
  { name: 'get_task', description: 'One task with its comments.', schema: obj({ id: num('Task id') }, ['id']), run: (db, ctx, a) => ({ ...tasks.getTask(db, ctx, a.id), comments: tasks.listComments(db, ctx, a.id) }) },
  { name: 'list_team', description: 'The people in the agency with their ids, roles and job titles. Use the ids to assign work.', schema: obj(),
    run: (db, ctx) => members.listMembers(db, ctx).map((m) => ({ id: m.id, username: m.username, displayName: m.displayName, role: m.role, isActive: m.isActive, jobTitle: m.jobTitle, department: m.department })) },
  { name: 'get_workload', description: 'Each active person\'s open tasks, overdue tasks and open estimated hours against weekly capacity.', schema: obj(),
    run: (db, ctx) => { const d = dashboard.getDashboard(db, ctx); if (!d.workload) throw new ServiceError(403, 'Not allowed'); return { today: d.today, workload: d.workload }; } },
  { name: 'list_sops', description: 'List the agency\'s SOPs (standard operating procedures), optionally by status, service or text. Each has its current version label.', schema: obj({ status: str('draft, testing, approved or deprecated'), service: str('Service name such as SEO'), q: str('Search text') }), run: (db, ctx, a) => sops.listSops(db, ctx, a) },
  { name: 'get_sop', description: 'One SOP with its current content (purpose, steps, quality checklist and more) and its version history.', schema: obj({ id: num('SOP id') }, ['id']), run: (db, ctx, a) => sops.getSop(db, ctx, a.id) },
  { name: 'list_services', description: 'The agency\'s services (SEO, Web Development and so on) with their ids. Use the ids on clients, projects and goals.', schema: obj(), run: (db, ctx) => services.listServices(db, ctx) },
  { name: 'list_goals', description: 'The goals of one client (why the agency does the work), with their progress.', schema: obj({ clientId: num('Client id'), status: str('active, achieved or dropped') }, ['clientId']), run: (db, ctx, a) => goals.listGoals(db, ctx, a.clientId, { status: a.status }) },
  { name: 'list_qa_queue', description: 'Work waiting for QA review. Reviewing itself is done by a person in AgencyOS, not by an AI.', schema: obj(), run: (db, ctx) => qa.listQueue(db, ctx) },

  { name: 'apply_changes', write: true, description: `Make several changes at once as one plan that is applied all together or not at all. Steps run in order; give a step "as" to name its result and use "$name" in clientId, projectId, taskId or id of later steps. Actions: create_client, update_client (args.id), create_contact (args.clientId), create_project (args.clientId), update_project (args.id), create_task (args.projectId, optional sopId, qaRequired and goalId), create_goal (args.clientId: title, why, target, dueDate, serviceId), update_goal (args.id, status active, achieved or dropped), update_task (args.id), add_comment (args.taskId), create_sop, update_sop (args.id), add_sop_version (args.id), create_tasks_from_sop (args.sopId and args.projectId, mode task or steps). An AI can draft SOPs (status draft or testing) but only a person can approve one or review work in QA. At most 50 steps.${PLAN_NOTE}`,
    schema: obj({ summary: str('One sentence: what this plan does'), steps: { type: 'array', items: obj({ action: str('One of the actions above'), as: str('Optional name for this step\'s result'), args: { type: 'object' } }, ['action', 'args']) } }, ['summary', 'steps']),
    submit: (a) => ({ summary: a.summary, steps: a.steps }) },
  { name: 'create_client', write: true, description: `Add a client.${PLAN_NOTE}`, schema: obj(CLIENT_FIELDS, ['name']), submit: (a) => asPlan(`Create client "${a.name}"`, 'create_client', a) },
  { name: 'create_project', write: true, description: `Add a project to a client.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), ...PROJECT_FIELDS }, ['clientId', 'name']), submit: (a) => asPlan(`Create project "${a.name}"`, 'create_project', a) },
  { name: 'create_goal', write: true, description: `Add a goal to a client: the statement (why the agency does the work), optional why, target, dueDate and serviceId.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), title: str('The goal, for example Increase qualified organic leads'), why: str('Why it matters'), target: str('A measurable target'), dueDate: str('YYYY-MM-DD'), serviceId: num('Service id') }, ['clientId', 'title']), submit: (a) => asPlan(`Add goal "${a.title}"`, 'create_goal', a) },
  { name: 'create_sop', write: true, description: `Draft an SOP: title, service, purpose, whenToUse, inputs, steps (list), checklist (list), expectedOutput, commonMistakes, examples, requiresQa. It starts as a draft for a person to approve.${PLAN_NOTE}`,
    schema: obj({ title: str('SOP title'), service: str('Service, such as SEO'), requiresQa: { type: 'boolean' }, status: { type: 'string', enum: ['draft', 'testing'] }, purpose: str('Purpose'), whenToUse: str('When to use'), inputs: str('Required inputs'), steps: { type: 'array', items: { type: 'string' } }, checklist: { type: 'array', items: { type: 'string' } }, expectedOutput: str('Expected output'), commonMistakes: str('Common mistakes'), examples: str('Examples') }, ['title']),
    submit: (a) => asPlan(`Create SOP "${a.title}"`, 'create_sop', a) },
  { name: 'create_tasks_from_sop', write: true, description: `Start work from an SOP in a project: one task named after it, or one task per step (mode steps).${PLAN_NOTE}`, schema: obj({ sopId: num('SOP id'), projectId: num('Project id'), mode: { type: 'string', enum: ['task', 'steps'] }, assigneeId: num('Team member id'), dueDate: str('YYYY-MM-DD'), priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } }, ['sopId', 'projectId']), submit: (a) => asPlan('Create tasks from an SOP', 'create_tasks_from_sop', a) },
  { name: 'create_task', write: true, description: `Add a task to a project.${PLAN_NOTE}`, schema: obj({ projectId: num('Project id'), ...TASK_FIELDS }, ['projectId', 'title']), submit: (a) => asPlan(`Create task "${a.title}"`, 'create_task', a) },
  { name: 'update_task', write: true, description: `Change a task (status, assignee, due date and so on).${PLAN_NOTE}`, schema: obj({ id: num('Task id'), ...TASK_FIELDS }, ['id']), submit: (a) => asPlan(`Change task #${a.id}`, 'update_task', a) },
  { name: 'add_comment', write: true, description: `Comment on a task.${PLAN_NOTE}`, schema: obj({ taskId: num('Task id'), body: str('The comment') }, ['taskId', 'body']), submit: (a) => asPlan(`Comment on task #${a.taskId}`, 'add_comment', a) },
];

const toolsFor = (auth) => TOOLS.filter((t) => !t.write || auth.access !== 'read');

function callTool(db, auth, name, args) {
  const tool = toolsFor(auth).find((t) => t.name === name);
  if (!tool) throw new ServiceError(404, `Unknown tool: ${name}`);
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new ServiceError(400, 'Tool arguments must be an object');
  if (tool.write) return plans.submitPlan(db, auth, tool.submit(args));
  const ctx = { organizationId: auth.organizationId, actor: auth.actor, source: 'ai', ip: null };
  return tool.run(db, ctx, args);
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

function handleMessage(db, auth, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize': {
      const wanted = msg.params && msg.params.protocolVersion;
      return reply(msg.id, { protocolVersion: VERSIONS.includes(wanted) ? wanted : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'agencyos', version: '1.0.0' } });
    }
    case 'ping': return reply(msg.id, {});
    case 'tools/list': return reply(msg.id, { tools: toolsFor(auth).map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) });
    case 'tools/call': {
      const params = msg.params || {};
      try {
        return reply(msg.id, { content: [{ type: 'text', text: text(callTool(db, auth, params.name, params.arguments)) }] });
      } catch (err) {
        if (!(err instanceof ServiceError)) { console.error(err); return reply(msg.id, { isError: true, content: [{ type: 'text', text: 'Something went wrong' }] }); }
        return reply(msg.id, { isError: true, content: [{ type: 'text', text: err.message }] });
      }
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

function mcpHandler(db) {
  const hits = new Map(); // key id -> { start, count }
  return (req, res) => {
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ error: 'Use POST' });
    const header = req.get('authorization') || '';
    const auth = apikeys.authenticate(db, header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    // The pointer tells an OAuth client (such as claude.ai) where to find the sign-in.
    if (!auth) return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource"`).json({ error: 'A valid API key or access token is required' });
    const now = Date.now();
    const h = hits.get(auth.keyId);
    if (!h || now - h.start >= RATE.windowMs) hits.set(auth.keyId, { start: now, count: 1 });
    else if (++h.count > RATE.max) return res.status(429).json({ error: 'Too many requests. Wait a minute' });
    const out = Array.isArray(req.body) ? req.body.map((m) => handleMessage(db, auth, m)).filter(Boolean) : handleMessage(db, auth, req.body);
    if (out === null || (Array.isArray(out) && out.length === 0)) return res.status(202).end();
    res.json(out);
  };
}

module.exports = { mcpHandler, TOOLS };
