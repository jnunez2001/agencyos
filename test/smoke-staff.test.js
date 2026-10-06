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
  assert.deepEqual([...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim()), ['Dashboard', 'Tasks', 'Projects', 'Clients', 'SOPs', 'Team', 'AI agent']);
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
  assert.deepEqual(app.errors, []);
});
