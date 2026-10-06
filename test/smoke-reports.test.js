// Joshua Nunez
// Front-end smoke test as the Owner for results and reports: the client page, every sheet, and the reports pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can use results and reports without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  app.window.print = () => { app.printed = (app.printed || 0) + 1; };
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // client page: metric cards with trend, and the client's reports
  await app.go('#/clients/1');
  let text = app.main().textContent;
  for (const part of ['Results', 'Organic leads', '55 leads', 'Up 15 (37.5%) since Aug 31', 'Top keywords', 'First reading', 'Reports', 'August report']) assert.ok(text.includes(part), part);
  assert.equal(app.main().querySelectorAll('.metric').length, 2);
  assert.ok(app.main().querySelector('.metric svg.spark polyline'));
  assert.ok(app.main().querySelector('.metric-change.up'));
  clean('client page');

  // a metric's history, editing an entry
  app.main().querySelector('.metric').click();
  await app.wait(250);
  let sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /55 leads/);
  assert.match(sheet.textContent, /Mark Cruz/);
  assert.match(sheet.textContent, /Goal: Increase qualified organic leads/);
  clean('metric sheet');
  sheet.querySelector('.row').click();
  await app.wait(200);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('input[name=value]').value, '55');
  assert.equal(sheet.querySelector('select[name=goalId]').value, '1');
  sheet.querySelector('input[name=value]').value = '56';
  const del = buttonWith(sheet, 'Delete result');
  del.click();
  assert.match(del.textContent, /again to delete/);
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const patched = app.calls.find((c) => c.method === 'PATCH' && c.path === '/results/3');
  assert.deepEqual([patched.body.value, patched.body.metric, patched.csrf], [56, 'Organic leads', 'csrf-token']);
  await app.wait(80);

  // record a new result
  buttonWith(app.main(), 'Record result').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('input[name=metric]').value = 'Calls';
  sheet.querySelector('input[name=value]').value = '12';
  sheet.querySelector('input[name=unit]').value = 'calls';
  clean('record form');
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const rec = app.calls.find((c) => c.method === 'POST' && c.path === '/clients/1/results');
  assert.deepEqual([rec.body.metric, rec.body.value, rec.body.unit, 'recordedOn' in rec.body], ['Calls', 12, 'calls', false]);
  await app.wait(80);

  // generate a draft from data
  buttonWith(app.main(), 'Generate from data').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.querySelector('input[name=periodStart]').value, /^\d{4}-\d{2}-01$/);
  assert.match(sheet.querySelector('input[name=periodEnd]').value, /^\d{4}-\d{2}-\d{2}$/);
  sheet.querySelector('form').requestSubmit();
  await app.wait(250);
  const gen = app.calls.find((c) => c.method === 'POST' && c.path === '/clients/1/reports/generate');
  assert.ok(gen.body.periodStart && gen.body.periodEnd && !('title' in gen.body));
  await app.wait(150);
  assert.equal(app.window.location.hash, '#/reports/3');

  // the reports list
  await app.go('#/reports');
  assert.equal(document.querySelectorAll('a.row').length, 2);
  assert.match(app.main().textContent, /August report/);
  clean('reports list');
  buttonWith(app.main(), 'Drafts').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.path.startsWith('/reports?') && c.path.includes('status=draft')));

  // a draft report: sections, copy, print, edit, approve, delete
  await app.go('#/reports/1');
  text = app.main().textContent;
  for (const part of ['Executive summary', 'Work completed', 'Key results', 'Important changes', 'Problems and risks', 'Next priorities', 'Recommendations', 'A strong month for organic leads.', 'Claim profile (Sarah, Sep 10)', 'Not written yet.', 'Draft']) assert.ok(text.includes(part), part);
  clean('report page');
  buttonWith(app.main(), 'Copy as text').click();
  await app.wait(100);
  assert.match(buttonWith(app.main(), 'by hand') ? 'by hand' : buttonWith(app.main(), 'Copied').textContent, /by hand|Copied/);
  buttonWith(app.main(), 'Print').click();
  assert.equal(app.printed, 1);
  buttonWith(app.main(), 'Edit').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('textarea[name=executiveSummary]').value, 'A strong month for organic leads.');
  assert.equal(sheet.querySelectorAll('textarea').length, 7);
  clean('report form');
  sheet.querySelector('textarea[name=importantChanges]').value = 'New booking form went live.';
  sheet.querySelector('form').requestSubmit();
  await app.wait(250);
  const edit = app.calls.find((c) => c.method === 'PATCH' && c.path === '/reports/1');
  assert.deepEqual([edit.body.importantChanges, edit.body.title], ['New booking form went live.', 'Acme Dental report, Sep 1, 2026 to Sep 30, 2026']);
  await app.wait(100);
  buttonWith(app.main(), 'Approve').click();
  await app.wait(200);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/reports/1/approve' && c.csrf === 'csrf-token'));
  const delDraft = buttonWith(app.main(), 'Delete draft');
  delDraft.click();
  assert.match(delDraft.textContent, /again to delete/);

  // an approved report cannot be approved again or deleted
  await app.go('#/reports/2');
  assert.match(app.main().textContent, /Approved by Mark Cruz/);
  assert.equal(buttonWith(app.main(), 'Approve'), undefined);
  assert.equal(buttonWith(app.main(), 'Delete draft'), undefined);
  assert.ok(buttonWith(app.main(), 'Edit'));

  // the new report form
  await app.go('#/reports');
  buttonWith(app.main(), 'New report').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('select[name=clientId]').value, '1');
  sheet.querySelector('input[name=title]').value = 'Quarterly review';
  sheet.querySelector('input[name=periodStart]').value = '2026-07-01';
  sheet.querySelector('input[name=periodEnd]').value = '2026-09-30';
  sheet.querySelector('form').requestSubmit();
  await app.wait(250);
  const made = app.calls.find((c) => c.method === 'POST' && c.path === '/reports');
  assert.deepEqual([made.body.clientId, made.body.title, made.body.periodStart], [1, 'Quarterly review', '2026-07-01']);
  await app.wait(150);
  assert.equal(app.window.location.hash, '#/reports/4');

  assert.deepEqual(app.errors, []);
});
