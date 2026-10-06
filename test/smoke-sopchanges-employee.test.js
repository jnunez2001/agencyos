// Joshua Nunez
// Front-end smoke test as an Employee: can see and raise change requests, but has no way to decide or publish.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('an Employee can raise a change request but not approve, reject or publish', async () => {
  const app = await openApp('employee');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  await app.go('#/sops/1');
  assert.ok(buttonWith(app.main(), 'Raise change request'));
  assert.match(app.main().textContent, /Add a speed check/);
  assert.equal(strayText(document.body), null);
  buttonWith(app.main(), 'Add a speed check').click();
  await app.wait(200);
  let sheet = document.querySelector('.sheet');
  assert.doesNotMatch(sheet.textContent, /Task: Homepage copy/); // source titles are for managers
  for (const word of ['Approve', 'Reject', 'Publish', 'Start work']) assert.equal(buttonWith(sheet, word), undefined, word);
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);
  buttonWith(app.main(), 'Reword step two').click();
  await app.wait(200);
  sheet = document.querySelector('.sheet');
  assert.equal(buttonWith(sheet, 'Publish'), undefined);
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);
  await app.go('#/sops/changes');
  assert.match(app.main().textContent, /SOP change requests/);
  assert.deepEqual(app.errors, []);
});
