// Joshua Nunez
// Front-end smoke test for search and Create as a Contractor: only their own work, and blocking their own time.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./support/browser');

test('a Contractor can search their work and may only block their own time', async () => {
  const app = await openApp('contractor');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  document.querySelector('.sidebar .quick-search').click();
  await app.wait(100);
  const input = document.querySelector('.sheet input[name=q]');
  input.value = 'acme';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.wait(350);
  assert.match(document.querySelector('.sheet').textContent, /Nothing found/);
  input.value = 'home';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  await app.wait(350);
  assert.match(document.querySelector('.sheet').textContent, /Homepage copy/);
  document.querySelector('.sheet [aria-label=Close]').click();
  await app.wait(100);

  document.querySelector('.sidebar .quick-create').click();
  await app.wait(100);
  assert.deepEqual([...document.querySelectorAll('.create-menu .row-title')].map((e) => e.textContent), ['Block my time']);
  assert.deepEqual(app.errors, []);
});
