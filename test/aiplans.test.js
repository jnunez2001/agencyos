// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const keys = require('../server/services/apikeys');
const plans = require('../server/services/aiplans');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const { updateMember } = require('../server/services/members');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

// A key for one of the fixture's people, authenticated the way the MCP endpoint does it.
function keyFor(f, ctx, access) {
  const k = keys.createKey(f.db, ctx, { name: `${access} key`, access });
  return { auth: keys.authenticate(f.db, k.token), id: k.id, token: k.token };
}

const PLAN = {
  summary: 'Set up Acme Dental',
  steps: [
    { action: 'create_client', as: 'acme', args: { name: 'Acme Dental', industry: 'Dental' } },
    { action: 'create_contact', args: { clientId: '$acme', name: 'Dr. Lee', email: 'lee@acme.example', isPrimary: true } },
    { action: 'create_project', as: 'site', args: { clientId: '$acme', name: 'New website', status: 'active' } },
    { action: 'create_task', as: 't1', args: { projectId: '$site', title: 'Homepage copy', priority: 'high' } },
    { action: 'create_task', args: { projectId: '$site', title: 'Sitemap' } },
    { action: 'add_comment', args: { taskId: '$t1', body: 'Created by AI' } },
  ],
};

test('direct mode: a plan with references applies at once and is logged as AI', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'direct');
  const r = plans.submitPlan(f.db, auth, PLAN);
  assert.equal(r.status, 'applied');
  assert.equal(r.results.length, 6);
  assert.deepEqual(r.results.map((x) => x.action), PLAN.steps.map((s) => s.action));
  const client = clients.listClients(f.db, f.josh)[0];
  assert.equal(client.name, 'Acme Dental');
  assert.equal(clients.getClient(f.db, f.josh, client.id).contacts[0].name, 'Dr. Lee');
  const list = tasks.listTasks(f.db, f.josh);
  assert.deepEqual(list.map((t) => t.title).sort(), ['Homepage copy', 'Sitemap']);
  assert.equal(tasks.listComments(f.db, f.josh, list.find((t) => t.title === 'Homepage copy').id)[0].body, 'Created by AI');
  const rows = listActivity(f.db, f.josh).filter((a) => ['client.create', 'project.create', 'task.create'].includes(a.action));
  assert.ok(rows.length === 4 && rows.every((a) => a.source === 'ai' && a.actorName === 'Josh'));
});

test('a plan is all or nothing: a bad step undoes every earlier step and names itself', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'direct');
  const bad = { summary: 'x', steps: [PLAN.steps[0], PLAN.steps[2], { action: 'create_task', args: { projectId: '$site', title: '' } }] };
  assert.throws(() => plans.submitPlan(f.db, auth, bad), /Step 3 \(create_task\).*title/i);
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
  assert.equal(projects.listProjects(f.db, f.josh).length, 0);
  assert.equal(listActivity(f.db, f.josh).filter((a) => a.source === 'ai').length, 0);
});

test('the plan itself is checked: shape, actions, names and references', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'direct');
  const run = (p) => plans.submitPlan(f.db, auth, p);
  assert.throws(() => run({ summary: '', steps: PLAN.steps }), /summary/i);
  assert.throws(() => run({ summary: 's', steps: [] }), /step/i);
  assert.throws(() => run({ summary: 's' }), /step/i);
  assert.throws(() => run({ summary: 's', steps: Array(51).fill(PLAN.steps[0]) }), /50/);
  assert.throws(() => run({ summary: 's', steps: [{ action: 'delete_everything', args: {} }] }), /Step 1.*action/i);
  assert.throws(() => run({ summary: 's', steps: [{ action: 'create_member', args: {} }] }), /Step 1.*action/i);
  assert.throws(() => run({ summary: 's', steps: [{ action: 'create_client', args: 'x' }] }), /Step 1.*args/i);
  assert.throws(() => run({ summary: 's', steps: [{ action: 'create_project', args: { clientId: '$nobody', name: 'P' } }] }), /Step 1.*\$nobody/);
  assert.throws(() => run({ summary: 's', steps: [{ action: 'create_client', as: 'a', args: { name: 'A' } }, { action: 'create_client', as: 'a', args: { name: 'B' } }] }), /Step 2.*already/i);
  assert.throws(() => run({ summary: 's', steps: [{ action: 'create_client', as: 'bad name!', args: { name: 'A' } }] }), /Step 1.*name/i);
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
});

test('a key never does more than its person: the live role is checked on every step', async () => {
  const f = await fixture();
  const { token } = keyFor(f, f.rayne, 'direct');
  updateMember(f.db, f.josh, f.ids.rayne, { role: 'employee' });
  const auth = keys.authenticate(f.db, token);
  assert.equal(auth.actor.role, 'employee');
  assert.throws(() => plans.submitPlan(f.db, auth, PLAN), /Step 1 \(create_client\).*not allowed/i);
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
});

test('a read key cannot write at all', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'read');
  assert.throws(() => plans.submitPlan(f.db, auth, PLAN), /only read/i);
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
});

test('propose mode: nothing changes until a person approves; mistakes are reported at once', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'propose');
  const r = plans.submitPlan(f.db, auth, PLAN);
  assert.equal(r.status, 'pending');
  assert.ok(r.proposalId);
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
  assert.equal(tasks.listTasks(f.db, f.josh).length, 0);
  assert.equal(listActivity(f.db, f.josh).filter((a) => a.action === 'client.create').length, 0);
  const pending = plans.listProposals(f.db, f.josh, { status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].summary, 'Set up Acme Dental');
  assert.deepEqual(pending[0].lines, [
    'Create client "Acme Dental"',
    'Add contact "Dr. Lee" to "Acme Dental"',
    'Create project "New website" for "Acme Dental"',
    'Create task "Homepage copy" in "New website"',
    'Create task "Sitemap" in "New website"',
    'Comment on "Homepage copy": Created by AI',
  ]);
  assert.match(pending[0].keyName, /propose key/);
  // a plan that cannot work is refused when it is sent, not when it is approved
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 'bad', steps: [{ action: 'create_client', args: { name: ' ' } }] }), /Step 1/);
  assert.equal(plans.listProposals(f.db, f.josh, { status: 'pending' }).length, 1);
});

test('approving runs the plan as the key person, logs it as AI, and cannot be done twice', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'propose');
  const { proposalId } = plans.submitPlan(f.db, auth, PLAN);
  const r = plans.approveProposal(f.db, f.rayne, proposalId);
  assert.equal(r.status, 'approved');
  assert.equal(clients.listClients(f.db, f.josh)[0].name, 'Acme Dental');
  assert.equal(tasks.listTasks(f.db, f.josh).length, 2);
  const rows = listActivity(f.db, f.josh);
  assert.ok(rows.find((a) => a.action === 'client.create' && a.source === 'ai' && a.actorName === 'Josh'));
  const approval = rows.find((a) => a.action === 'ai.proposal.approve');
  assert.equal(approval.actorName, 'Rayne');
  assert.throws(() => plans.approveProposal(f.db, f.josh, proposalId), /already/i);
  assert.throws(() => plans.rejectProposal(f.db, f.josh, proposalId), /already/i);
  assert.equal(plans.listProposals(f.db, f.josh, { status: 'approved' }).length, 1);
});

test('rejecting changes nothing', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'propose');
  const { proposalId } = plans.submitPlan(f.db, auth, PLAN);
  assert.equal(plans.rejectProposal(f.db, f.josh, proposalId).status, 'rejected');
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
  assert.equal(plans.listProposals(f.db, f.josh, { status: 'rejected' }).length, 1);
});

test('if the data changed while it waited, approval fails cleanly and applies nothing', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'propose');
  const { proposalId } = plans.submitPlan(f.db, auth, PLAN);
  clients.createClient(f.db, f.josh, { name: 'Acme Dental' }); // someone added it by hand
  const r = plans.approveProposal(f.db, f.josh, proposalId);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Step 1.*already exists/i);
  assert.equal(clients.listClients(f.db, f.josh).length, 1);
  assert.equal(tasks.listTasks(f.db, f.josh).length, 0);
  assert.equal(plans.listProposals(f.db, f.josh, { status: 'failed' }).length, 1);
});

test('Owner and Admin decide anyone\'s proposals; everyone else only their own; another agency none', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'propose');
  const { proposalId } = plans.submitPlan(f.db, auth, PLAN);
  for (const ctx of [f.mark, f.sarah, f.cole]) {
    assert.deepEqual(plans.listProposals(f.db, ctx, {}), []);
    assert.throws(() => plans.approveProposal(f.db, ctx, proposalId), /not found/i);
    assert.throws(() => plans.rejectProposal(f.db, ctx, proposalId), /not found/i);
    assert.equal(plans.pendingCount(f.db, ctx), 0);
  }
  assert.deepEqual(plans.listProposals(f.db, f.zed, {}), []);
  assert.throws(() => plans.approveProposal(f.db, f.zed, proposalId), /not found/i);
  assert.throws(() => plans.rejectProposal(f.db, f.zed, proposalId), /not found/i);
  assert.equal(plans.pendingCount(f.db, f.josh), 1);
  assert.equal(plans.pendingCount(f.db, f.rayne), 1);
  assert.equal(plans.pendingCount(f.db, f.zed), 0);
});

test('an Employee\'s AI works within the Employee\'s role and the Employee approves their own proposals', async () => {
  const f = await fixture();
  const c = clients.createClient(f.db, f.mark, { name: 'Acme' });
  const p = projects.createProject(f.db, f.mark, { clientId: c.id, name: 'Site' });
  const mine = tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'Mine', assigneeId: f.ids.sarah });
  const notMine = tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'Not mine', assigneeId: f.ids.mark });
  const { auth } = keyFor(f, f.sarah, 'propose');
  // what Sarah could not do herself is refused when the plan is sent
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 's', steps: [{ action: 'create_task', args: { projectId: p.id, title: 'x' } }] }), /Step 1.*not allowed/i);
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 's', steps: [{ action: 'update_task', args: { id: notMine.id, status: 'done' } }] }), /Step 1/);
  const { proposalId } = plans.submitPlan(f.db, auth, { summary: 'Finish my task', steps: [{ action: 'update_task', args: { id: mine.id, status: 'done' } }] });
  assert.equal(plans.listProposals(f.db, f.sarah, { status: 'pending' }).length, 1);
  assert.deepEqual(plans.listProposals(f.db, f.mark, {}), []);
  assert.equal(plans.pendingCount(f.db, f.sarah), 1);
  assert.equal(plans.approveProposal(f.db, f.sarah, proposalId).status, 'approved');
  assert.equal(tasks.getTask(f.db, f.sarah, mine.id).status, 'done');
});

test('a Contractor\'s AI sees only the Contractor\'s own tasks', async () => {
  const f = await fixture();
  const c = clients.createClient(f.db, f.mark, { name: 'Acme' });
  const p = projects.createProject(f.db, f.mark, { clientId: c.id, name: 'Site' });
  tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'Cole job', assigneeId: f.ids.cole });
  tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'Other job', assigneeId: f.ids.sarah });
  const { auth } = keyFor(f, f.cole, 'read');
  const mcp = require('../server/mcp');
  const tool = (name) => { const t = mcp.TOOLS.find((x) => x.name === name); return t.run(f.db, { organizationId: auth.organizationId, actor: auth.actor, source: 'ai' }, {}); };
  assert.deepEqual(tool('list_tasks').map((t) => t.title), ['Cole job']);
  assert.throws(() => tool('list_clients'), /not allowed/i);
});

test('a key from another agency only ever touches its own agency', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.zed, 'direct');
  plans.submitPlan(f.db, auth, PLAN);
  assert.deepEqual(clients.listClients(f.db, f.josh), []);
  assert.equal(clients.listClients(f.db, f.zed).length, 1);
  const { auth: mine } = keyFor(f, f.josh, 'direct');
  const zedClient = clients.listClients(f.db, f.zed)[0];
  assert.throws(() => plans.submitPlan(f.db, mine, { summary: 's', steps: [{ action: 'update_client', args: { id: zedClient.id, notes: 'hack' } }] }), /Step 1.*not found/i);
});

test('update steps and the shortcuts work through the same path', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'direct');
  const c = clients.createClient(f.db, f.josh, { name: 'Beta' });
  const p = projects.createProject(f.db, f.josh, { clientId: c.id, name: 'P' });
  const t = tasks.createTask(f.db, f.josh, { projectId: p.id, title: 'T' });
  plans.submitPlan(f.db, auth, { summary: 'tidy', steps: [
    { action: 'update_client', args: { id: c.id, status: 'paused' } },
    { action: 'update_project', args: { id: p.id, status: 'active' } },
    { action: 'update_task', args: { id: t.id, status: 'done', priority: 'low' } },
  ] });
  assert.equal(clients.getClient(f.db, f.josh, c.id).status, 'paused');
  assert.equal(projects.getProject(f.db, f.josh, p.id).status, 'active');
  assert.deepEqual([tasks.getTask(f.db, f.josh, t.id).status, tasks.getTask(f.db, f.josh, t.id).priority], ['done', 'low']);
});

test('SOP actions: an AI drafts SOPs and starts work from them, but a person must approve', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'direct');
  const sopsSvc = require('../server/services/sops');
  const r = plans.submitPlan(f.db, auth, { summary: 'Draft an SOP and use it', steps: [
    { action: 'create_client', as: 'c', args: { name: 'Acme' } },
    { action: 'create_project', as: 'p', args: { clientId: '$c', name: 'Site' } },
    { action: 'create_sop', as: 's', args: { title: 'Page Optimization', service: 'SEO', status: 'testing', requiresQa: true, steps: ['Research', 'Write'], checklist: ['Title ok'] } },
    { action: 'add_sop_version', args: { id: '$s', steps: ['Research', 'Write', 'Publish'], changeNote: 'Added publish' } },
    { action: 'create_tasks_from_sop', args: { sopId: '$s', projectId: '$p', mode: 'steps' } },
    { action: 'create_task', args: { projectId: '$p', title: 'One more', sopId: '$s' } },
  ] });
  assert.equal(r.status, 'applied');
  const sop = sopsSvc.listSops(f.db, f.josh)[0];
  assert.deepEqual([sop.status, sop.version], ['testing', '1.1']);
  assert.deepEqual(tasks.listTasks(f.db, f.josh).map((t) => t.title).sort(), ['One more', 'Publish', 'Research', 'Write']);
  assert.ok(tasks.listTasks(f.db, f.josh).every((t) => t.sopId === sop.id && t.qaRequired === true));
  // approval stays with a person
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 's', steps: [{ action: 'update_sop', args: { id: sop.id, status: 'approved' } }] }), /Step 1.*person/i);
  assert.equal(sopsSvc.listSops(f.db, f.josh)[0].status, 'testing');
  // and so does reviewing
  const t = tasks.listTasks(f.db, f.josh)[0];
  tasks.updateTask(f.db, f.josh, t.id, { status: 'review' });
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 's', steps: [{ action: 'update_task', args: { id: t.id, status: 'done' } }] }), /Step 1.*needs QA/i);
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 's', steps: [{ action: 'review_task', args: { id: t.id, result: 'approved' } }] }), /unknown action/i);
  // the inbox describes the new steps
  const { auth: ask } = keyFor(f, f.josh, 'propose');
  const p = plans.submitPlan(f.db, ask, { summary: 'Another SOP', steps: [{ action: 'create_sop', args: { title: 'Link Building', status: 'draft' } }, { action: 'update_sop', args: { id: sop.id, service: 'Local SEO' } }] });
  assert.deepEqual(p.lines, ['Create SOP "Link Building" (draft)', 'Change SOP "Page Optimization": service']);
});

test('goal actions: an AI sets up a client with goals and links work to them', async () => {
  const f = await fixture();
  const goalsSvc = require('../server/services/goals');
  const servicesSvc = require('../server/services/services');
  const seo = servicesSvc.createService(f.db, f.josh, { name: 'SEO' });
  const { auth } = keyFor(f, f.josh, 'direct');
  const r = plans.submitPlan(f.db, auth, { summary: 'Set up Cedar with a goal', steps: [
    { action: 'create_client', as: 'c', args: { name: 'Cedar', status: 'onboarding', serviceIds: [seo.id], accountOwnerId: f.ids.mark, startDate: '2026-10-01' } },
    { action: 'create_goal', as: 'g', args: { clientId: '$c', title: 'Increase qualified organic leads', target: '50 a month', serviceId: seo.id } },
    { action: 'create_project', as: 'p', args: { clientId: '$c', name: 'Local SEO', goalId: '$g', serviceId: seo.id } },
    { action: 'create_task', args: { projectId: '$p', title: 'Audit the site' } },
    { action: 'update_goal', args: { id: '$g', target: '80 a month' } },
  ] });
  assert.equal(r.status, 'applied');
  const client = clients.listClients(f.db, f.josh)[0];
  assert.deepEqual([client.status, client.accountOwnerName, client.services[0].name], ['onboarding', 'Mark', 'SEO']);
  const g = goalsSvc.listGoals(f.db, f.josh, client.id)[0];
  assert.deepEqual([g.target, g.progress.tasksTotal, g.progress.projects], ['80 a month', 1, 1]);
  // services are not an AI matter
  assert.throws(() => plans.submitPlan(f.db, auth, { summary: 's', steps: [{ action: 'create_service', args: { name: 'X' } }] }), /unknown action/i);
  const { auth: ask } = keyFor(f, f.josh, 'propose');
  const p = plans.submitPlan(f.db, ask, { summary: 'A goal', steps: [{ action: 'create_goal', args: { clientId: client.id, title: 'Improve reviews' } }, { action: 'update_goal', args: { id: g.id, status: 'achieved' } }] });
  assert.deepEqual(p.lines, ['Add goal "Improve reviews" for "Cedar"', 'Change goal "Increase qualified organic leads": status']);
});
