// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const orgs = require('../server/services/organizations');
const { fixture, PASSWORD } = require('./fixture');

const input = (over = {}) => ({ organizationName: 'Whalls Agency', displayName: 'Josh', username: 'josh', password: PASSWORD, ...over });

test('first setup creates the agency, its Owner and a profile, and logs it', async () => {
  const db = openDb(':memory:');
  assert.equal(orgs.needsSetup(db), true);
  const r = await orgs.setupOrganization(db, input());
  assert.equal(orgs.needsSetup(db), false);
  const member = db.prepare('SELECT role FROM organization_members WHERE user_id = ?').get(r.userId);
  assert.equal(member.role, 'owner');
  assert.ok(db.prepare('SELECT 1 FROM employee_profiles WHERE user_id = ?').get(r.userId));
  const log = db.prepare('SELECT * FROM activity_logs WHERE action = ?').get('organization.setup');
  assert.equal(log.organization_id, r.organizationId);
  assert.equal(log.actor_user_id, r.userId);
});

test('setup can only happen once, and needs the setup code when the server has one', async () => {
  const db = openDb(':memory:');
  await assert.rejects(() => orgs.setupOrganization(db, input(), { setupToken: 'secret-code' }), /setup code/i);
  await assert.rejects(() => orgs.setupOrganization(db, input({ setupCode: 'wrong' }), { setupToken: 'secret-code' }), /setup code/i);
  await orgs.setupOrganization(db, input({ setupCode: 'secret-code' }), { setupToken: 'secret-code' });
  await assert.rejects(() => orgs.setupOrganization(db, input({ username: 'other' }), { setupToken: 'secret-code' }), /already complete/i);
});

test('setup validates the agency name, username and password', async () => {
  const db = openDb(':memory:');
  await assert.rejects(() => orgs.setupOrganization(db, input({ organizationName: '' })), /name/i);
  await assert.rejects(() => orgs.setupOrganization(db, input({ username: 'a b' })), /username/i);
  await assert.rejects(() => orgs.setupOrganization(db, input({ password: 'short' })), /at least 10/i);
  assert.equal(orgs.needsSetup(db), true);
});

test('everyone can see their own organization', async () => {
  const f = await fixture();
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah, f.cole]) {
    const o = orgs.getOrganization(f.db, ctx);
    assert.equal(o.name, 'Whalls Agency');
  }
  assert.equal(orgs.getOrganization(f.db, f.zed).name, 'Other Agency');
});

test('only an Owner or Admin can change the name and timezone, and the change is logged with before and after', async () => {
  const f = await fixture();
  const o = orgs.updateOrganization(f.db, f.rayne, { name: 'Whalls Digital', timezone: 'Asia/Singapore' });
  assert.deepEqual([o.name, o.timezone], ['Whalls Digital', 'Asia/Singapore']);
  const log = f.db.prepare("SELECT * FROM activity_logs WHERE action = 'organization.update'").get();
  assert.deepEqual(JSON.parse(log.before_json), { name: 'Whalls Agency', timezone: 'Asia/Manila' });
  assert.deepEqual(JSON.parse(log.after_json), { name: 'Whalls Digital', timezone: 'Asia/Singapore' });
  for (const ctx of [f.mark, f.sarah, f.cole]) assert.throws(() => orgs.updateOrganization(f.db, ctx, { name: 'Hacked' }), /not allowed/i);
  assert.equal(orgs.getOrganization(f.db, f.josh).name, 'Whalls Digital');
});

test('changing one agency never touches another', async () => {
  const f = await fixture();
  orgs.updateOrganization(f.db, f.josh, { name: 'Changed' });
  assert.equal(orgs.getOrganization(f.db, f.zed).name, 'Other Agency');
  assert.throws(() => orgs.updateOrganization(f.db, f.josh, { name: '' }), /name/i);
  assert.throws(() => orgs.updateOrganization(f.db, f.josh, { timezone: 'Mars/Base' }), /timezone/i);
});
