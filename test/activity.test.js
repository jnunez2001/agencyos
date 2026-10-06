// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const activity = require('../server/services/activity');
const dashboard = require('../server/services/dashboard');
const members = require('../server/services/members');
const orgs = require('../server/services/organizations');
const { fixture, PASSWORD } = require('./fixture');

test('only an Owner or Admin can read the activity log', async () => {
  const f = await fixture();
  assert.ok(activity.listActivity(f.db, f.josh).length > 0);
  assert.ok(activity.listActivity(f.db, f.rayne).length > 0);
  for (const ctx of [f.mark, f.sarah, f.cole]) assert.throws(() => activity.listActivity(f.db, ctx), /not allowed/i);
});

test('the log shows newest first, with who did what, and never another agency', async () => {
  const f = await fixture();
  members.updateMember(f.db, f.josh, f.ids.sarah, { role: 'manager' });
  orgs.updateOrganization(f.db, f.zed, { name: 'Other Agency Ltd' }); // another agency acts too
  const rows = activity.listActivity(f.db, f.josh);
  assert.equal(rows[0].action, 'member.update');
  assert.equal(rows[0].actorName, 'Josh');
  assert.equal(rows[0].objectType, 'member');
  assert.deepEqual(rows[0].before, { role: 'employee' });
  assert.deepEqual(rows[0].after, { role: 'manager' });
  assert.ok(rows.every((r) => r.action !== 'organization.setup' || r.actorName === 'Josh'));
  assert.ok(!JSON.stringify(rows).includes('Zed'));
  const other = activity.listActivity(f.db, f.zed);
  assert.ok(other.every((r) => r.actorName === 'Zed'));
});

test('the log can be filtered by action and by person, and limited', async () => {
  const f = await fixture();
  await members.createMember(f.db, f.rayne, { username: 'extra', displayName: 'Extra', role: 'employee', password: PASSWORD });
  const created = activity.listActivity(f.db, f.josh, { action: 'member.create' });
  assert.ok(created.length >= 5);
  assert.ok(created.every((r) => r.action === 'member.create'));
  const byRayne = activity.listActivity(f.db, f.josh, { actorId: f.ids.rayne });
  assert.ok(byRayne.length >= 1 && byRayne.every((r) => r.actorId === f.ids.rayne));
  assert.equal(activity.listActivity(f.db, f.josh, { limit: 2 }).length, 2);
  assert.ok(activity.listActivity(f.db, f.josh, { limit: 100000 }).length <= 200);
});

test('the dashboard shows a team summary to managers and above, and not to others', async () => {
  const f = await fixture();
  const d = dashboard.getDashboard(f.db, f.mark);
  assert.deepEqual([d.me.displayName, d.me.role, d.organization.name], ['Mark', 'manager', 'Whalls Agency']);
  assert.deepEqual(d.team, { total: 5, active: 5, byRole: { owner: 1, admin: 1, manager: 1, employee: 1, contractor: 1 }, mustChangePassword: 4 });
  members.updateMember(f.db, f.josh, f.ids.cole, { isActive: false });
  assert.deepEqual(dashboard.getDashboard(f.db, f.josh).team.active, 4);
  assert.equal(dashboard.getDashboard(f.db, f.sarah).team, null);
  assert.equal(dashboard.getDashboard(f.db, f.cole).team, null);
  assert.equal(dashboard.getDashboard(f.db, f.zed).team.total, 1);
});
