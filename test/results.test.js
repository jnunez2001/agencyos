// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const results = require('../server/services/results');
const clients = require('../server/services/clients');
const goals = require('../server/services/goals');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.goal = goals.createGoal(f.db, f.mark, f.client.id, { title: 'More leads' });
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: '2026-10-10' };
  return f;
}
const rec = (f, ctx, over = {}) => results.recordResult(f.db, ctx, f.client.id, { metric: 'Organic leads', value: 40, unit: 'leads', recordedOn: '2026-08-31', ...over });

test('staff record results; a Contractor cannot see or record any', async () => {
  const f = await setup();
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) assert.ok(rec(f, ctx).id);
  assert.equal(results.listResults(f.db, f.sarah, f.client.id).length, 4);
  assert.throws(() => rec(f, f.cole), /not allowed/i);
  assert.throws(() => results.listResults(f.db, f.cole, f.client.id), /not allowed/i);
  assert.throws(() => results.metricsSummary(f.db, f.cole, f.client.id), /not allowed/i);
});

test('a result is checked: metric, a real number, a real date, the goal of the same client', async () => {
  const f = await setup();
  const r = rec(f, f.sarah, { goalId: f.goal.id, note: 'From Search Console' });
  assert.deepEqual([r.metric, r.value, r.unit, r.recordedOn, r.goalId, r.goalTitle, r.note, r.recordedByName], ['Organic leads', 40, 'leads', '2026-08-31', f.goal.id, 'More leads', 'From Search Console', 'Sarah']);
  assert.throws(() => rec(f, f.sarah, { metric: ' ' }), /metric/i);
  assert.throws(() => rec(f, f.sarah, { value: 'lots' }), /number/i);
  assert.throws(() => rec(f, f.sarah, { value: null }), /number/i);
  assert.throws(() => rec(f, f.sarah, { value: Infinity }), /number/i);
  assert.throws(() => rec(f, f.sarah, { recordedOn: '2026-13-01' }), /date/i);
  assert.throws(() => rec(f, f.sarah, { unit: 'x'.repeat(21) }), /unit/i);
  assert.throws(() => rec(f, f.sarah, { goalId: 99999 }), /not found/i);
  const other = clients.createClient(f.db, f.mark, { name: 'Beta' });
  const otherGoal = goals.createGoal(f.db, f.mark, other.id, { title: 'Beta goal' });
  assert.throws(() => rec(f, f.sarah, { goalId: otherGoal.id }), /same client/i);
  assert.equal(rec(f, f.sarah, { recordedOn: undefined }).recordedOn, '2026-10-10'); // today when no date is given
  assert.throws(() => results.recordResult(f.db, f.sarah, 99999, { metric: 'x', value: 1 }), /not found/i);
});

test('metrics: latest value, change from the previous one, and the history', async () => {
  const f = await setup();
  rec(f, f.sarah, { value: 10, recordedOn: '2026-06-30' });
  rec(f, f.sarah, { value: 20, recordedOn: '2026-07-31' });
  rec(f, f.sarah, { value: 30, recordedOn: '2026-08-31' });
  rec(f, f.sarah, { metric: 'organic LEADS', value: 99, recordedOn: '2026-05-31' }); // same metric, other case
  rec(f, f.sarah, { metric: 'Top 10 keywords', value: 12, unit: '', recordedOn: '2026-08-31' });
  const s = results.metricsSummary(f.db, f.mark, f.client.id);
  assert.deepEqual(s.map((m) => m.metric).sort(), ['Organic leads', 'Top 10 keywords']);
  const leads = s.find((m) => m.metric === 'Organic leads');
  assert.deepEqual([leads.latest.value, leads.latest.recordedOn, leads.previous.value, leads.change, leads.changePct, leads.count, leads.unit], [30, '2026-08-31', 20, 10, 50, 4, 'leads']);
  assert.deepEqual(leads.history.map((h) => h.value), [99, 10, 20, 30]); // oldest first
  const kw = s.find((m) => m.metric === 'Top 10 keywords');
  assert.deepEqual([kw.previous, kw.change, kw.changePct], [null, null, null]);
  // a previous value of zero has no percentage
  rec(f, f.sarah, { metric: 'Calls', value: 0, recordedOn: '2026-07-01' });
  rec(f, f.sarah, { metric: 'Calls', value: 5, recordedOn: '2026-08-01' });
  assert.equal(results.metricsSummary(f.db, f.mark, f.client.id).find((m) => m.metric === 'Calls').changePct, null);
  assert.equal(results.metricsSummary(f.db, f.mark, f.client.id).find((m) => m.metric === 'Calls').change, 5);
});

test('listing filters by metric and dates, newest first', async () => {
  const f = await setup();
  rec(f, f.sarah, { value: 1, recordedOn: '2026-06-30' });
  rec(f, f.sarah, { value: 2, recordedOn: '2026-07-31' });
  rec(f, f.sarah, { metric: 'Calls', value: 3, recordedOn: '2026-07-31' });
  assert.deepEqual(results.listResults(f.db, f.mark, f.client.id).map((r) => r.value), [3, 2, 1]);
  assert.deepEqual(results.listResults(f.db, f.mark, f.client.id, { metric: 'organic leads' }).map((r) => r.value), [2, 1]);
  assert.deepEqual(results.listResults(f.db, f.mark, f.client.id, { from: '2026-07-01', to: '2026-07-31' }).map((r) => r.value).sort(), [2, 3]);
  assert.throws(() => results.listResults(f.db, f.mark, f.client.id, { from: 'x' }), /date/i);
});

test('a person edits or deletes their own results; a Manager or above any', async () => {
  const f = await setup();
  const mine = rec(f, f.sarah);
  const his = rec(f, f.mark, { value: 7 });
  assert.equal(results.updateResult(f.db, f.sarah, mine.id, { value: 41 }).value, 41);
  assert.throws(() => results.updateResult(f.db, f.sarah, his.id, { value: 8 }), /not allowed/i);
  assert.throws(() => results.deleteResult(f.db, f.sarah, his.id), /not allowed/i);
  assert.equal(results.updateResult(f.db, f.rayne, mine.id, { note: 'checked' }).note, 'checked');
  results.deleteResult(f.db, f.sarah, mine.id);
  results.deleteResult(f.db, f.mark, his.id);
  assert.equal(results.listResults(f.db, f.josh, f.client.id).length, 0);
  assert.throws(() => results.deleteResult(f.db, f.mark, 99999), /not found/i);
});

test('another agency cannot see or change a result', async () => {
  const f = await setup();
  const r = rec(f, f.sarah);
  assert.throws(() => results.listResults(f.db, f.zed, f.client.id), /not found/i);
  assert.throws(() => results.recordResult(f.db, f.zed, f.client.id, { metric: 'x', value: 1 }), /not found/i);
  assert.throws(() => results.updateResult(f.db, f.zed, r.id, { value: 0 }), /not found/i);
  assert.throws(() => results.deleteResult(f.db, f.zed, r.id), /not found/i);
  assert.throws(() => results.metricsSummary(f.db, f.zed, f.client.id), /not found/i);
});

test('result changes are logged with only the changed fields', async () => {
  const f = await setup();
  const r = rec(f, f.sarah);
  results.updateResult(f.db, f.sarah, r.id, { value: 41, metric: 'Organic leads' });
  results.deleteResult(f.db, f.sarah, r.id);
  const rows = listActivity(f.db, f.josh).filter((x) => x.objectType === 'result');
  assert.deepEqual(rows.map((x) => x.action), ['result.delete', 'result.update', 'result.create']);
  assert.deepEqual([rows[1].before, rows[1].after], [{ value: 40 }, { value: 41 }]);
  assert.equal(rows[0].before.metric, 'Organic leads');
});
