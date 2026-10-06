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

test('only Owner and Admin see and decide proposals, and only their own agency', async () => {
  const f = await fixture();
  const { auth } = keyFor(f, f.josh, 'propose');
  const { proposalId } = plans.submitPlan(f.db, auth, PLAN);
  for (const ctx of [f.mark, f.sarah, f.cole]) {
    assert.throws(() => plans.listProposals(f.db, ctx, {}), /not allowed/i);
    assert.throws(() => plans.approveProposal(f.db, ctx, proposalId), /not allowed/i);
    assert.throws(() => plans.rejectProposal(f.db, ctx, proposalId), /not allowed/i);
  }
  assert.deepEqual(plans.listProposals(f.db, f.zed, {}), []);
  assert.throws(() => plans.approveProposal(f.db, f.zed, proposalId), /not found/i);
  assert.throws(() => plans.rejectProposal(f.db, f.zed, proposalId), /not found/i);
  assert.equal(plans.pendingCount(f.db, f.josh), 1);
  assert.equal(plans.pendingCount(f.db, f.zed), 0);
  assert.equal(plans.pendingCount(f.db, f.mark), 0);
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
