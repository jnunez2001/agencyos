// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const services = require('../server/services/services');
const goals = require('../server/services/goals');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const dashboard = require('../server/services/dashboard');
const { updateMember } = require('../server/services/members');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.seo = services.createService(f.db, f.josh, { name: 'SEO' });
  f.web = services.createService(f.db, f.josh, { name: 'Web Development' });
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental', serviceIds: [f.seo.id] });
  return f;
}

// ---- services ----

test('Owner and Admin manage services; everyone but a Contractor reads them', async () => {
  const f = await fixture();
  const s = services.createService(f.db, f.rayne, { name: 'Social Media' });
  assert.deepEqual([s.name, s.isActive], ['Social Media', true]);
  for (const ctx of [f.mark, f.sarah, f.cole]) {
    assert.throws(() => services.createService(f.db, ctx, { name: 'X' }), /not allowed/i);
    assert.throws(() => services.updateService(f.db, ctx, s.id, { name: 'Y' }), /not allowed/i);
  }
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) assert.deepEqual(services.listServices(f.db, ctx).map((x) => x.name), ['Social Media']);
  assert.throws(() => services.listServices(f.db, f.cole), /not allowed/i);
});

test('service names are checked and unique within the agency, ignoring case', async () => {
  const f = await fixture();
  services.createService(f.db, f.josh, { name: 'SEO' });
  assert.throws(() => services.createService(f.db, f.josh, { name: ' ' }), /name/i);
  assert.throws(() => services.createService(f.db, f.josh, { name: 'seo' }), /already/i);
  assert.throws(() => services.createService(f.db, f.josh, { name: 'x'.repeat(61) }), /name/i);
  assert.equal(services.createService(f.db, f.zed, { name: 'SEO' }).name, 'SEO'); // another agency may use it
});

test('a service is renamed or deactivated, never deleted; inactive ones leave the pickers', async () => {
  const f = await setup();
  assert.equal(services.updateService(f.db, f.rayne, f.web.id, { name: 'Web Design' }).name, 'Web Design');
  assert.throws(() => services.updateService(f.db, f.josh, f.web.id, { name: 'SEO' }), /already/i);
  services.updateService(f.db, f.josh, f.web.id, { isActive: false });
  assert.deepEqual(services.listServices(f.db, f.mark).map((s) => s.name), ['SEO']);
  assert.deepEqual(services.listServices(f.db, f.josh, { all: true }).map((s) => s.name), ['SEO', 'Web Design']);
  assert.deepEqual(services.listServices(f.db, f.mark, { all: true }).map((s) => s.name), ['SEO']); // staff never see inactive ones
  assert.throws(() => clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: [f.web.id] }), /service/i);
});

test('the common services can be added in one step, without duplicates', async () => {
  const f = await fixture();
  services.createService(f.db, f.josh, { name: 'seo' });
  const list = services.addDefaultServices(f.db, f.josh);
  assert.equal(list.length, 10);
  assert.ok(list.some((s) => s.name === 'Web Development'));
  assert.equal(services.addDefaultServices(f.db, f.josh).length, 10);
  assert.throws(() => services.addDefaultServices(f.db, f.mark), /not allowed/i);
});

test('another agency cannot see or change a service', async () => {
  const f = await setup();
  assert.deepEqual(services.listServices(f.db, f.zed), []);
  assert.throws(() => services.updateService(f.db, f.zed, f.seo.id, { name: 'hack' }), /not found/i);
  assert.throws(() => clients.createClient(f.db, f.zed, { name: 'Z', serviceIds: [f.seo.id] }), /service/i);
});

test('service changes are logged', async () => {
  const f = await fixture();
  const s = services.createService(f.db, f.josh, { name: 'SEO' });
  services.updateService(f.db, f.josh, s.id, { name: 'Local SEO' });
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'service');
  assert.deepEqual(rows.map((r) => r.action), ['service.update', 'service.create']);
  assert.deepEqual([rows[0].before, rows[0].after], [{ name: 'SEO' }, { name: 'Local SEO' }]);
});

// ---- client extras ----

test('a client has services, an account owner, a start date and the wider statuses', async () => {
  const f = await setup();
  const c = clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: [f.seo.id, f.web.id], accountOwnerId: f.ids.sarah, startDate: '2026-09-01', status: 'onboarding' });
  assert.deepEqual(c.services.map((s) => s.name).sort(), ['SEO', 'Web Development']);
  assert.deepEqual([c.accountOwnerName, c.startDate, c.status], ['Sarah', '2026-09-01', 'onboarding']);
  for (const s of ['lead', 'at_risk', 'completed', 'archived', 'active', 'paused']) assert.equal(clients.updateClient(f.db, f.mark, f.client.id, { status: s }).status, s);
  assert.throws(() => clients.updateClient(f.db, f.mark, f.client.id, { status: 'dead' }), /status/i);
  assert.equal(clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: [] }).services.length, 0);
  assert.throws(() => clients.updateClient(f.db, f.mark, f.client.id, { accountOwnerId: f.ids.zed }), /team member/i);
  assert.throws(() => clients.updateClient(f.db, f.mark, f.client.id, { startDate: '2026-02-30' }), /date/i);
  assert.throws(() => clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: 'SEO' }), /service/i);
  assert.throws(() => clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: [99999] }), /service/i);
  assert.equal(clients.listClients(f.db, f.sarah)[0].services.length, 0);
});

test('client list filters by status, including the new ones', async () => {
  const f = await setup();
  clients.createClient(f.db, f.mark, { name: 'Lead Co', status: 'lead' });
  assert.deepEqual(clients.listClients(f.db, f.mark, { status: 'lead' }).map((c) => c.name), ['Lead Co']);
  assert.equal(clients.listClients(f.db, f.mark).length, 2);
});

test('client changes log services by name, only when they change', async () => {
  const f = await setup();
  clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: [f.seo.id] }); // unchanged
  clients.updateClient(f.db, f.mark, f.client.id, { serviceIds: [f.seo.id, f.web.id] });
  const rows = listActivity(f.db, f.josh).filter((r) => r.action === 'client.update');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].before, rows[0].after], [{ services: ['SEO'] }, { services: ['SEO', 'Web Development'] }]);
});

test('the dashboard counts current clients as active, onboarding or at risk', async () => {
  const f = await setup();
  clients.createClient(f.db, f.mark, { name: 'A', status: 'onboarding' });
  clients.createClient(f.db, f.mark, { name: 'B', status: 'at_risk' });
  clients.createClient(f.db, f.mark, { name: 'C', status: 'lead' });
  clients.createClient(f.db, f.mark, { name: 'D', status: 'completed' });
  assert.equal(dashboard.getDashboard(f.db, f.mark).agency.activeClients, 3);
});

// ---- goals ----

const GOAL = { title: 'Increase qualified organic leads', why: 'Phones are quiet in the off season', target: '50 leads a month', dueDate: '2027-03-31' };

test('Owner, Admin and Manager add goals; staff read them; a Contractor cannot', async () => {
  const f = await setup();
  const g = goals.createGoal(f.db, f.mark, f.client.id, { ...GOAL, serviceId: f.seo.id });
  assert.deepEqual([g.title, g.status, g.target, g.dueDate, g.serviceName, g.why], [GOAL.title, 'active', GOAL.target, GOAL.dueDate, 'SEO', GOAL.why]);
  assert.deepEqual(g.progress, { tasksTotal: 0, tasksDone: 0, projects: 0 });
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) assert.equal(goals.listGoals(f.db, ctx, f.client.id).length, 1);
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => goals.createGoal(f.db, ctx, f.client.id, GOAL), /not allowed/i);
    assert.throws(() => goals.updateGoal(f.db, ctx, g.id, { title: 'x' }), /not allowed/i);
  }
  assert.throws(() => goals.listGoals(f.db, f.cole, f.client.id), /not allowed/i);
  assert.equal(clients.getClient(f.db, f.sarah, f.client.id).goals[0].title, GOAL.title);
});

test('goal input is checked', async () => {
  const f = await setup();
  assert.throws(() => goals.createGoal(f.db, f.mark, f.client.id, { ...GOAL, title: ' ' }), /statement|title/i);
  assert.throws(() => goals.createGoal(f.db, f.mark, f.client.id, { ...GOAL, title: 'x'.repeat(201) }), /statement|title/i);
  assert.throws(() => goals.createGoal(f.db, f.mark, f.client.id, { ...GOAL, status: 'maybe' }), /status/i);
  assert.throws(() => goals.createGoal(f.db, f.mark, f.client.id, { ...GOAL, dueDate: 'soon' }), /date/i);
  assert.throws(() => goals.createGoal(f.db, f.mark, f.client.id, { ...GOAL, serviceId: 99999 }), /service/i);
  assert.throws(() => goals.createGoal(f.db, f.mark, 99999, GOAL), /not found/i);
  assert.equal(goals.createGoal(f.db, f.mark, f.client.id, { title: 'Only a statement' }).target, '');
});

test('a goal is changed, achieved or dropped, never deleted', async () => {
  const f = await setup();
  const g = goals.createGoal(f.db, f.mark, f.client.id, GOAL);
  assert.equal(goals.updateGoal(f.db, f.mark, g.id, { target: '80 leads a month' }).target, '80 leads a month');
  assert.equal(goals.updateGoal(f.db, f.mark, g.id, { status: 'achieved' }).status, 'achieved');
  assert.equal(goals.updateGoal(f.db, f.mark, g.id, { status: 'dropped' }).status, 'dropped');
  assert.deepEqual(goals.listGoals(f.db, f.mark, f.client.id, { status: 'dropped' }).map((x) => x.id), [g.id]);
  assert.deepEqual(goals.listGoals(f.db, f.mark, f.client.id, { status: 'active' }), []);
  assert.throws(() => goals.listGoals(f.db, f.mark, f.client.id, { status: 'x' }), /status/i);
});

test('a project supports a goal of its own client, and tasks follow it; progress counts the work', async () => {
  const f = await setup();
  const g = goals.createGoal(f.db, f.mark, f.client.id, GOAL);
  const p = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Local SEO', goalId: g.id, serviceId: f.seo.id });
  assert.deepEqual([p.goalId, p.goalTitle, p.serviceName], [g.id, GOAL.title, 'SEO']);
  const t1 = tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'One' });
  const t2 = tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'Two' });
  assert.deepEqual([t1.goalId, t1.goalTitle, t1.goalInherited], [null, GOAL.title, true]);
  tasks.updateTask(f.db, f.mark, t2.id, { status: 'done' });
  assert.deepEqual(goals.listGoals(f.db, f.mark, f.client.id)[0].progress, { tasksTotal: 2, tasksDone: 1, projects: 1 });
  // a task can support a different goal of the same client
  const g2 = goals.createGoal(f.db, f.mark, f.client.id, { title: 'Improve reviews' });
  const t3 = tasks.createTask(f.db, f.mark, { projectId: p.id, title: 'Ask for reviews', goalId: g2.id });
  assert.deepEqual([t3.goalId, t3.goalTitle, t3.goalInherited], [g2.id, 'Improve reviews', false]);
  const prog = Object.fromEntries(goals.listGoals(f.db, f.mark, f.client.id).map((x) => [x.title, x.progress]));
  assert.deepEqual(prog[GOAL.title], { tasksTotal: 2, tasksDone: 1, projects: 1 });
  assert.deepEqual(prog['Improve reviews'], { tasksTotal: 1, tasksDone: 0, projects: 0 });
  assert.equal(tasks.getTask(f.db, f.sarah, t3.id).goalTitle, 'Improve reviews');
  assert.equal(clients.getClient(f.db, f.sarah, f.client.id).projects[0].goalTitle, GOAL.title);
});

test('a goal must belong to the same client, be active, and be in the same agency', async () => {
  const f = await setup();
  const other = clients.createClient(f.db, f.mark, { name: 'Beta' });
  const g = goals.createGoal(f.db, f.mark, f.client.id, GOAL);
  const gOther = goals.createGoal(f.db, f.mark, other.id, { title: 'Beta goal' });
  assert.throws(() => projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'P', goalId: gOther.id }), /same client/i);
  const p = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'P', goalId: g.id });
  assert.throws(() => tasks.createTask(f.db, f.mark, { projectId: p.id, title: 't', goalId: gOther.id }), /same client/i);
  assert.throws(() => projects.updateProject(f.db, f.mark, p.id, { clientId: other.id }), /goal/i); // would leave the goal behind
  assert.equal(projects.updateProject(f.db, f.mark, p.id, { clientId: other.id, goalId: gOther.id }).goalTitle, 'Beta goal');
  goals.updateGoal(f.db, f.mark, g.id, { status: 'dropped' });
  assert.throws(() => projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Q', goalId: g.id }), /active goal/i);
  assert.throws(() => projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Q', goalId: 99999 }), /not found/i);
  const zedClient = clients.createClient(f.db, f.zed, { name: 'Z' });
  const zedGoal = goals.createGoal(f.db, f.zed, zedClient.id, { title: 'Zed goal' });
  assert.throws(() => projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'R', goalId: zedGoal.id }), /not found/i);
  // unlinking is always allowed
  assert.equal(projects.updateProject(f.db, f.mark, p.id, { goalId: null }).goalId, null);
});

test('a project service must be an active service of the agency', async () => {
  const f = await setup();
  assert.throws(() => projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'P', serviceId: 99999 }), /service/i);
  const p = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'P', serviceId: f.web.id });
  services.updateService(f.db, f.josh, f.web.id, { isActive: false });
  assert.equal(projects.getProject(f.db, f.mark, p.id).serviceName, 'Web Development'); // stays on what has it
  assert.throws(() => projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Q', serviceId: f.web.id }), /service/i);
  assert.equal(projects.updateProject(f.db, f.mark, p.id, { serviceId: null }).serviceId, null);
});

test('another agency cannot see or change a goal', async () => {
  const f = await setup();
  const g = goals.createGoal(f.db, f.mark, f.client.id, GOAL);
  assert.throws(() => goals.listGoals(f.db, f.zed, f.client.id), /not found/i);
  assert.throws(() => goals.updateGoal(f.db, f.zed, g.id, { title: 'hack' }), /not found/i);
  assert.throws(() => goals.createGoal(f.db, f.zed, f.client.id, GOAL), /not found/i);
});

test('goal changes are logged with only the changed fields', async () => {
  const f = await setup();
  const g = goals.createGoal(f.db, f.mark, f.client.id, GOAL);
  goals.updateGoal(f.db, f.mark, g.id, { status: 'achieved', title: GOAL.title });
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'goal');
  assert.deepEqual(rows.map((r) => r.action), ['goal.update', 'goal.create']);
  assert.deepEqual([rows[0].before, rows[0].after], [{ status: 'active' }, { status: 'achieved' }]);
});

test('a deactivated account owner can still be shown, but not chosen again', async () => {
  const f = await setup();
  clients.updateClient(f.db, f.mark, f.client.id, { accountOwnerId: f.ids.sarah });
  updateMember(f.db, f.josh, f.ids.sarah, { isActive: false });
  assert.equal(clients.getClient(f.db, f.mark, f.client.id).accountOwnerName, 'Sarah');
  assert.throws(() => clients.createClient(f.db, f.mark, { name: 'N', accountOwnerId: f.ids.sarah }), /team member/i);
});
