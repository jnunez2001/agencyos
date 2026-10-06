// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = require('../server/services/profiles');
const { fixture } = require('./fixture');

test('everyone has a profile with sensible defaults', async () => {
  const f = await fixture();
  const p = profiles.getProfile(f.db, f.sarah, f.ids.sarah);
  assert.deepEqual([p.jobTitle, p.department, p.workDays, p.workStart, p.workEnd, p.weeklyCapacityHours], ['', '', [1, 2, 3, 4, 5], '09:00', '17:00', 40]);
  assert.equal(p.displayName, 'Sarah');
  assert.equal(p.role, 'employee');
});

test('you can edit your own profile, and it is logged with before and after', async () => {
  const f = await fixture();
  const p = profiles.updateProfile(f.db, f.sarah, f.ids.sarah, { jobTitle: 'SEO Specialist', department: 'SEO', timezone: 'Asia/Singapore', workDays: [1, 2, 3, 4], workStart: '08:00', workEnd: '16:00', weeklyCapacityHours: 32 });
  assert.deepEqual([p.jobTitle, p.workDays, p.workStart, p.weeklyCapacityHours], ['SEO Specialist', [1, 2, 3, 4], '08:00', 32]);
  const log = f.db.prepare("SELECT * FROM activity_logs WHERE action = 'profile.update'").get();
  assert.equal(JSON.parse(before(log)).weeklyCapacityHours, 40);
  assert.equal(JSON.parse(log.after_json).weeklyCapacityHours, 32);
});
const before = (log) => log.before_json;

test('bad profile values are refused', async () => {
  const f = await fixture();
  const bad = (patch, re) => assert.throws(() => profiles.updateProfile(f.db, f.sarah, f.ids.sarah, patch), re);
  bad({ timezone: 'Mars/Base' }, /timezone/i);
  bad({ workDays: [] }, /working days/i);
  bad({ workDays: [0, 8] }, /working days/i);
  bad({ workStart: '9am' }, /time/i);
  bad({ workStart: '17:00', workEnd: '09:00' }, /after/i);
  bad({ weeklyCapacityHours: 200 }, /capacity/i);
  bad({ weeklyCapacityHours: 'lots' }, /capacity/i);
  bad({ jobTitle: 'x'.repeat(61) }, /job title/i);
});

test('an Owner or Admin can edit another member, but only below their rank', async () => {
  const f = await fixture();
  assert.equal(profiles.updateProfile(f.db, f.rayne, f.ids.sarah, { jobTitle: 'Writer' }).jobTitle, 'Writer');
  assert.equal(profiles.updateProfile(f.db, f.josh, f.ids.rayne, { jobTitle: 'Operations' }).jobTitle, 'Operations');
  assert.throws(() => profiles.updateProfile(f.db, f.rayne, f.ids.josh, { jobTitle: 'Boss' }), /not allowed/i);
  for (const ctx of [f.mark, f.sarah, f.cole]) assert.throws(() => profiles.updateProfile(f.db, ctx, f.ids.rayne, { jobTitle: 'x' }), /not allowed/i);
});

test('other agency profiles are not found, for reading and writing', async () => {
  const f = await fixture();
  assert.throws(() => profiles.getProfile(f.db, f.josh, f.ids.zed), /not found/i);
  assert.throws(() => profiles.updateProfile(f.db, f.josh, f.ids.zed, { jobTitle: 'x' }), /not found/i);
  assert.equal(profiles.getProfile(f.db, f.zed, f.ids.zed).displayName, 'Zed');
});

test('a contractor can read only their own profile', async () => {
  const f = await fixture();
  assert.equal(profiles.getProfile(f.db, f.cole, f.ids.cole).displayName, 'Cole');
  assert.throws(() => profiles.getProfile(f.db, f.cole, f.ids.josh), /not allowed/i);
  assert.equal(profiles.getProfile(f.db, f.sarah, f.ids.josh).displayName, 'Josh');
});
