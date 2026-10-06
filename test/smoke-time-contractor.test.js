// Joshua Nunez
// Front-end smoke test for the Time page as a Contractor: tasks only, no client choice, no retainer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

test('a Contractor logs time on their own tasks, with no client field', async () => {
  const app = await openApp('contractor');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const nav = [...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim());
  assert.deepEqual(nav, ['Dashboard', 'Calendar', 'Meetings', 'Time', 'Tasks', 'AI agent']);
  await app.go('#/time');
  assert.match(app.main().textContent, /My week/);
  assert.doesNotMatch(app.main().textContent, /Team workload|Acme Dental/);
  assert.equal(buttonWith(app.main(), 'Approve'), undefined);
  assert.equal(app.main().querySelector('[name=clientId]'), null);
  assert.equal(app.main().querySelector('[name=taskId] option[value=""]'), null, 'a task is required');
  assert.equal(strayText(document.body), null, `stray text: ${strayText(document.body)}`);
  buttonWith(app.main(), 'Add time').click();
  await app.wait(150);
  const sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('[name=clientId]'), null);
  sheet.querySelector('[name=hours]').value = '0.5';
  sheet.querySelector('form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await app.wait(150);
  const posted = app.calls.find((c) => c.method === 'POST' && c.path === '/time-entries');
  assert.deepEqual([posted.body.minutes, posted.body.taskId], [30, 1]);
  assert.equal(app.calls.some((c) => /retainer/.test(c.path)), false);
  assert.deepEqual(app.errors, []);
});
