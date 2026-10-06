// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');

test('results and reports over HTTP, start to finish', async () => {
  const app = await setUp();
  const o = app.owner;
  const mark = app.client(); await mark.signIn('mark');
  const sarah = app.client(); await sarah.signIn('sarah');
  const cole = app.client(); await cole.signIn('cole');
  const c = (await mark.call('POST', '/clients', { name: 'Acme' })).data;

  // results: staff record, a Contractor cannot
  const r1 = (await sarah.call('POST', `/clients/${c.id}/results`, { metric: 'Organic leads', value: 40, unit: 'leads', recordedOn: '2026-08-31' })).data;
  assert.equal(r1.recordedByName, 'Sarah');
  await sarah.call('POST', `/clients/${c.id}/results`, { metric: 'Organic leads', value: 55, unit: 'leads', recordedOn: '2026-09-30' });
  assert.equal((await cole.call('POST', `/clients/${c.id}/results`, { metric: 'x', value: 1 })).status, 403);
  assert.equal((await cole.call('GET', `/clients/${c.id}/metrics`)).status, 403);
  const metrics = (await sarah.call('GET', `/clients/${c.id}/metrics`)).data;
  assert.deepEqual([metrics[0].latest.value, metrics[0].change, metrics[0].changePct], [55, 15, 37.5]);
  assert.equal((await sarah.call('GET', `/clients/${c.id}/results?metric=organic%20leads`)).data.length, 2);
  assert.equal((await sarah.call('PATCH', `/results/${r1.id}`, { value: 41 })).data.value, 41);
  assert.equal((await mark.call('POST', `/clients/${c.id}/results`, { metric: 'Calls', value: 'many' })).status, 400);

  // reports
  const gen = (await mark.call('POST', `/clients/${c.id}/reports/generate`, { periodStart: '2026-09-01', periodEnd: '2026-09-30' })).data;
  assert.equal(gen.status, 'draft');
  assert.match(gen.sections.keyResults, /Organic leads: 55 leads \(up 14 from 41\)/);
  assert.equal((await sarah.call('POST', `/clients/${c.id}/reports/generate`, { periodStart: '2026-09-01', periodEnd: '2026-09-30' })).status, 403);
  const data = (await sarah.call('GET', `/clients/${c.id}/report-data?from=2026-09-01&to=2026-09-30`)).data;
  assert.equal(data.results[0].change, 14);
  assert.equal((await mark.call('GET', `/clients/${c.id}/report-data?from=2026-09-01`)).status, 400);
  assert.equal((await cole.call('GET', '/reports')).status, 403);
  const made = (await mark.call('POST', '/reports', { clientId: c.id, title: 'Blank report', periodStart: '2026-09-01', periodEnd: '2026-09-30', executiveSummary: 'A good month' })).data;
  assert.equal((await sarah.call('GET', `/reports/${made.id}`)).data.sections.executiveSummary, 'A good month');
  assert.equal((await sarah.call('GET', '/reports')).data.length, 2);
  assert.equal((await mark.call('GET', `/reports?clientId=${c.id}&status=draft`)).data.length, 2);
  assert.equal((await sarah.call('POST', `/reports/${made.id}/approve`, {})).status, 403);
  assert.equal((await o.call('POST', `/reports/${made.id}/approve`, {})).data.status, 'approved');
  assert.equal((await mark.call('DELETE', `/reports/${made.id}`)).status, 400); // approved
  assert.equal((await mark.call('PATCH', `/reports/${made.id}`, { recommendations: 'Do more' })).data.status, 'draft');
  assert.equal((await mark.call('DELETE', `/reports/${made.id}`)).status, 200);
  assert.equal((await mark.call('GET', `/reports/${made.id}`)).status, 404);
  assert.equal((await mark.call('DELETE', `/results/${r1.id}`)).status, 200);

  const log = (await o.call('GET', '/activity?limit=100')).data.map((a) => a.action);
  for (const a of ['result.create', 'result.update', 'result.delete', 'report.generate', 'report.create', 'report.approve', 'report.update', 'report.delete']) assert.ok(log.includes(a), a);
  for (const [m, path] of [['GET', '/reports'], ['POST', '/reports'], ['GET', '/clients/1/metrics'], ['POST', '/clients/1/results'], ['DELETE', '/results/1']]) assert.equal((await app.client().call(m, path, ['GET', 'DELETE'].includes(m) ? undefined : {})).status, 401, `${m} ${path}`);
  await app.close();
});
