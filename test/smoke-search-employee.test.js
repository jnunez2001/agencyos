// Joshua Nunez
// Front-end smoke test for Create as an Employee: only what an Employee may start.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./support/browser');

test('an Employee may block time, log a request and add a follow-up, nothing else', async () => {
  const app = await openApp('employee');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  document.querySelector('.sidebar .quick-create').click();
  await app.wait(100);
  assert.deepEqual([...document.querySelectorAll('.create-menu .row-title')].map((e) => e.textContent), ['Block my time', 'Client request', 'Follow-up']);
  document.querySelector('[data-create=event]').click();
  await app.wait(300);
  const type = document.querySelector('.sheet select[name=type]');
  assert.deepEqual([...type.options].map((o) => o.value), ['blocked_time']);
  document.querySelector('.sheet [aria-label=Close]').click();
  await app.wait(100);
  assert.ok(document.querySelector('.topbar [aria-label=Create]'));
  assert.deepEqual(app.errors, []);
});
