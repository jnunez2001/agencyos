// Joshua Nunez
// Front-end smoke test as a Contractor and an Employee: they see only what the role allows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('a Contractor sees only Dashboard and Tasks, and other addresses fall back to the dashboard', async () => {
  const app = await openApp('contractor');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  assert.deepEqual([...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim()), ['Dashboard', 'Calendar', 'Meetings', 'Tasks', 'AI agent']);
  assert.match(app.main().textContent, /My work/);
  assert.doesNotMatch(app.main().textContent, /Active clients|Workload/);
  await app.go('#/tasks');
  assert.equal(document.querySelectorAll('.task-row').length, 1);
  assert.equal(document.querySelector('.page-head .btn-primary'), null); // no New task
  assert.ok(![...document.querySelectorAll('button')].some((b) => /My tasks/.test(b.textContent)));
  document.querySelector('.task-row').click();
  await app.wait(200);
  const sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('select[name=status]').disabled, false); // their own task
  assert.ok(![...sheet.querySelectorAll('button')].some((b) => /^Edit$/.test(b.textContent.trim())));
  assert.equal(strayText(sheet), null);
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);
  await app.go('#/ai');
  assert.match(app.main().textContent, /MCP server address/);
  assert.equal(strayText(document.body), null);
  for (const hash of ['#/clients', '#/projects', '#/team']) {
    await app.go(hash);
    assert.equal(app.window.location.hash, '#/dashboard', hash);
  }
  assert.equal(strayText(document.body), null);
  assert.deepEqual(app.errors, []);
});
