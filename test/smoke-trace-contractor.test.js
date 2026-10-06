// Joshua Nunez
// Front-end smoke test as a Contractor, and for a client with nothing lately: what a person with no trace sees.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('a Contractor sees no trace beyond the SOP, and no client page at all', async () => {
  const app = await openApp('contractor');
  await import('../public/js/app.js');
  await app.wait(250);
  await app.go('#/tasks');
  app.document.querySelector('.task-row').click();
  await app.wait(250);
  const sheet = app.document.querySelector('.sheet');
  const block = sheet.querySelector('.trace-block');
  assert.match(block.textContent, /Page Optimization v1\.0/);
  assert.equal(block.querySelectorAll('a').length, 0, 'a Contractor cannot open SOPs, so no link');
  assert.doesNotMatch(block.textContent, /request|Kickoff|Use WordPress/i);
  assert.equal(strayText(sheet), null);
  await app.go('#/clients');
  assert.equal(app.window.location.hash, '#/dashboard');
  assert.deepEqual(app.errors, []);
});
