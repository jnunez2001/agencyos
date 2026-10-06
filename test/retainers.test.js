// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const time = require('../server/services/timeentries');
const retainers = require('../server/services/retainers');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

const TODAY = '2026-10-20';

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: TODAY };
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Site', status: 'active' });
  return f;
}
// Logs billable time for Sarah and moves it to the given status.
function log(f, minutes, date, status, extra = {}) {
  const e = time.createEntry(f.db, f.sarah, { clientId: f.client.id, minutes, date, ...extra });
  if (status === 'draft') return e;
  time.submitEntries(f.db, f.sarah, { ids: [e.id] });
  if (status === 'submitted') return e;
  time.approveEntry(f.db, f.mark, e.id);
  if (status === 'locked') time.lockEntry(f.db, f.mark, e.id);
  return e;
}

test('monthly periods follow the start day, and short months use their last day', () => {
  assert.deepEqual(retainers.periodFor('2026-01-15', '2026-10-20'), { from: '2026-10-15', to: '2026-11-14' });
  assert.deepEqual(retainers.periodFor('2026-01-15', '2026-10-14'), { from: '2026-09-15', to: '2026-10-14' });
  assert.deepEqual(retainers.periodFor('2026-01-31', '2026-02-28'), { from: '2026-02-28', to: '2026-03-30' });
  assert.deepEqual(retainers.periodFor('2026-01-31', '2026-02-27'), { from: '2026-01-31', to: '2026-02-27' });
  assert.deepEqual(retainers.periodFor('2026-12-01', '2027-01-01'), { from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(retainers.periodFor('2027-03-01', '2026-10-20'), { from: '2027-03-01', to: '2027-03-31' }); // not started: the first period
});

test('only billable approved or locked time counts; submitted is pending; warnings at 80 and over 100', async () => {
  const f = await setup();
  retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 10, startDate: '2026-10-01' });
  let u = retainers.getRetainer(f.db, f.mark, f.client.id).usage;
  assert.deepEqual([u.usedHours, u.remainingHours, u.percent, u.level, u.period], [0, 10, 0, 'ok', { from: '2026-10-01', to: '2026-10-31' }]);
  log(f, 120, '2026-10-05', 'approved');
  log(f, 60, '2026-10-06', 'locked');
  log(f, 90, '2026-10-07', 'submitted');
  log(f, 60, '2026-10-08', 'draft');
  log(f, 300, '2026-09-30', 'approved'); // last period
  log(f, 300, '2026-10-09', 'approved', { timeType: 'non_billable' });
  const rej = log(f, 300, '2026-10-10', 'submitted'); time.rejectEntry(f.db, f.mark, rej.id, { note: 'No' });
  u = retainers.getRetainer(f.db, f.mark, f.client.id).usage;
  assert.deepEqual([u.usedHours, u.pendingHours, u.remainingHours, u.percent, u.level, u.message], [3, 1.5, 7, 30, 'ok', '']);
  log(f, 300, '2026-10-11', 'approved');
  u = retainers.getRetainer(f.db, f.mark, f.client.id).usage;
  assert.deepEqual([u.usedHours, u.percent, u.level], [8, 80, 'warning']);
  assert.match(u.message, /80 percent.*2 hours left/);
  log(f, 120, '2026-10-12', 'approved'); // exactly 10 hours: used up, not yet over
  u = retainers.getRetainer(f.db, f.mark, f.client.id).usage;
  assert.deepEqual([u.usedHours, u.level, u.overHours], [10, 'warning', 0]);
  log(f, 90, '2026-10-13', 'locked');
  u = retainers.getRetainer(f.db, f.mark, f.client.id).usage;
  assert.deepEqual([u.usedHours, u.percent, u.level, u.remainingHours, u.overHours, u.message], [11.5, 115, 'over', 0, 1.5, 'Over the retainer by 1.5 hours']);
});

test('managers manage retainers; staff see usage; contractors see nothing; one active per client; never deleted', async () => {
  const f = await setup();
  assert.throws(() => retainers.saveRetainer(f.db, f.sarah, f.client.id, { hoursAllocated: 10 }), /not allowed/i);
  assert.throws(() => retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 0 }), /above 0/);
  assert.throws(() => retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 10, startDate: '2026-13-01' }), /real date/);
  assert.throws(() => retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 10, period: 'weekly' }), /monthly/);
  assert.throws(() => retainers.saveRetainer(f.db, f.mark, f.client.id, { isActive: false }), /no retainer/);
  const made = retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 12.5 });
  assert.deepEqual([made.retainer.hoursAllocated, made.retainer.startDate, made.canManage], [12.5, TODAY, true]);
  assert.equal(retainers.getRetainer(f.db, f.sarah, f.client.id).canManage, false);
  assert.throws(() => retainers.getRetainer(f.db, f.cole, f.client.id), /not allowed/i);
  assert.throws(() => retainers.getRetainer(f.db, f.zed, f.client.id), /not found/i);
  const changed = retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 20 });
  assert.equal(changed.retainer.id, made.retainer.id);
  const log = listActivity(f.db, f.josh, { action: 'retainer.update' });
  assert.deepEqual([log[0].before, log[0].after], [{ hoursAllocated: 12.5 }, { hoursAllocated: 20 }]);
  assert.equal(retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 20 }).retainer.id, made.retainer.id);
  assert.equal(listActivity(f.db, f.josh, { action: 'retainer.update' }).length, 1);
  // switch off, then a new one can start
  assert.equal(retainers.saveRetainer(f.db, f.mark, f.client.id, { isActive: false }).retainer, null);
  assert.equal(retainers.getRetainer(f.db, f.mark, f.client.id).usage, null);
  const again = retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 5 });
  assert.notEqual(again.retainer.id, made.retainer.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM client_retainers').get().n, 2);
});

test('usage for every client, worst first, scoped to the agency', async () => {
  const f = await setup();
  const c2 = clients.createClient(f.db, f.mark, { name: 'Beta' });
  retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 10, startDate: '2026-10-01' });
  retainers.saveRetainer(f.db, f.mark, c2.id, { hoursAllocated: 10, startDate: '2026-10-01' });
  log(f, 540, '2026-10-05', 'approved');
  const list = retainers.listUsage(f.db, f.mark, {});
  assert.deepEqual(list.map((x) => [x.clientName, x.percent]), [['Acme', 90], ['Beta', 0]]);
  assert.equal(retainers.listUsage(f.db, f.mark, { clientId: c2.id }).length, 1);
  assert.equal(retainers.listUsage(f.db, f.zed, {}).length, 0);
  assert.throws(() => retainers.listUsage(f.db, f.cole, {}), /not allowed/i);
});
