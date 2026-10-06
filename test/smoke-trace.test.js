// Joshua Nunez
// Front-end smoke test as the Owner for traceability: "Where this came from" on a task and a request, and "Recent activity" on a client.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

test('a task, a request and a client page show where work came from and what happened lately', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // the task sheet
  await app.go('#/tasks');
  document.querySelector('.task-row').click();
  await app.wait(250);
  let sheet = document.querySelector('.sheet');
  assert.ok(app.calls.some((c) => c.method === 'GET' && c.path === '/tasks/1/trace'));
  const block = sheet.querySelector('.trace-block');
  assert.match(block.querySelector('h3').textContent, /Where this came from/);
  for (const w of ['Add online booking', 'Kickoff call, Oct 12', 'Use WordPress', 'Send the quote', 'Page Optimization v1.0', '3.5 hours in 2 entries, 2 approved']) assert.match(block.textContent, new RegExp(w.replace(/[.]/g, '\\.')), w);
  assert.deepEqual([...block.querySelectorAll('a')].map((a) => a.getAttribute('href')), ['#/requests/1', '#/meetings/1', '#/calendar/1', '#/meetings/decisions', '#/meetings/follow-ups', '#/sops/1']);
  clean('task sheet');
  block.querySelector('a').click(); // a link closes the sheet and goes there
  await app.wait(300);
  assert.equal(document.querySelector('.sheet'), null);
  assert.equal(app.window.location.hash, '#/requests/1');

  // the request page shows the chain behind the request
  assert.match(app.main().textContent, /Where this came from/);
  assert.match(app.main().textContent, /Kickoff call/);
  clean('request page');
  await app.go('#/tasks');

  // the client page: recent activity, and a longer period
  await app.go('#/clients/1');
  const panel = app.main().querySelector('.activity-panel');
  assert.match(panel.querySelector('h2').textContent, /Recent activity/);
  assert.match(panel.textContent, /Meeting notes/);
  assert.match(panel.textContent, /Add online booking/);
  assert.deepEqual([...panel.querySelectorAll('a.row')].map((a) => a.getAttribute('href')), ['#/meetings/1', '#/requests/1']);
  assert.ok(app.calls.some((c) => c.path === '/clients/1/timeline?days=7'));
  clean('client page');
  buttonWith(panel, '30 days').click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.path === '/clients/1/timeline?days=30'));
  assert.equal(buttonWith(app.main(), '30 days').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(app.errors, []);
});
