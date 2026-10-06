// Joshua Nunez
// Front-end smoke test as an Employee: SOPs are read only, there is no QA queue, and their own task can be submitted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('an Employee reads SOPs, follows them on their task, submits for QA, and cannot review', async () => {
  const app = await openApp('employee');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  assert.deepEqual([...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim()), ['Dashboard', 'Calendar', 'Meetings', 'Requests', 'Tasks', 'Projects', 'Clients', 'Reports', 'SOPs', 'Team', 'AI agent']);
  assert.doesNotMatch(app.main().textContent, /waiting for review/);

  await app.go('#/sops');
  assert.equal(document.querySelector('.page-head .btn-primary'), null); // no New SOP
  assert.ok(![...document.querySelectorAll('.chip')].some((c) => /Draft/.test(c.textContent)));
  assert.match(app.main().textContent, /Page Optimization/);
  await app.go('#/sops/1');
  assert.match(app.main().textContent, /Quality checklist/);
  assert.equal(buttonWith(app.main(), 'New version'), undefined);
  assert.equal(buttonWith(app.main(), 'Details'), undefined);
  assert.equal(buttonWith(app.main(), 'Use in a project'), undefined);
  assert.equal(strayText(document.body), null);

  await app.go('#/qa'); // not allowed: back to the dashboard
  assert.equal(app.window.location.hash, '#/dashboard');

  await app.go('#/tasks');
  document.querySelector('.task-row').click();
  await app.wait(250);
  const sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Page Optimization v1\.0/);
  assert.equal(buttonWith(sheet, 'Review'), undefined);
  assert.equal(buttonWith(sheet, 'Edit'), undefined);
  assert.equal(strayText(sheet), null);
  buttonWith(sheet, 'Submit for QA').click();
  await app.wait(200);
  assert.ok(app.calls.some((c) => c.method === 'PATCH' && c.path === '/tasks/1' && c.body.status === 'review'));
  // my profile: an invitation to link Google, and the password card while password sign-in is on
  await app.go('#/profile');
  assert.match(app.main().textContent, /invited sarah@example\.com/);
  assert.ok([...app.main().querySelectorAll('button')].some((b) => /Link my Google account/.test(b.textContent)));
  assert.ok(app.main().querySelector('input[name=current]'));
  assert.equal(strayText(document.body), null);

  // results are recorded by staff; reports are read only
  await app.go('#/clients/1');
  assert.ok(buttonWith(app.main(), 'Record result'));
  assert.equal(buttonWith(app.main(), 'Generate from data'), undefined);
  assert.equal(buttonWith(app.main(), 'New report'), undefined);
  assert.match(app.main().textContent, /August report/);
  assert.doesNotMatch(app.main().textContent, /Google data/); // nothing is connected and staff cannot connect
  assert.equal(strayText(document.body), null);
  app.main().querySelector('.metric').click();
  await app.wait(250);
  const metricSheet = document.querySelector('.sheet');
  const entryRows = [...metricSheet.querySelectorAll('.row')];
  assert.deepEqual(entryRows.map((r) => r.tagName), ['BUTTON', 'DIV']); // only their own entry can be edited
  metricSheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);
  await app.go('#/reports');
  assert.equal(document.querySelector('.page-head .btn-primary'), null);
  await app.go('#/reports/1');
  assert.match(app.main().textContent, /Executive summary/);
  for (const t of ['Edit', 'Approve', 'Delete draft']) assert.equal(buttonWith(app.main(), t), undefined, t);
  assert.ok(buttonWith(app.main(), 'Copy as text'));
  assert.equal(strayText(document.body), null);

  assert.deepEqual(app.errors, []);
});
