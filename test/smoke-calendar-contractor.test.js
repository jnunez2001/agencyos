// Joshua Nunez
// Front-end smoke test for the calendar as an Employee, then as a Contractor (one role per file).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

async function toOctober(app) {
  const { document } = app;
  for (let i = 0; i < 80 && !/October 2026/.test(document.querySelector('.cal-title').textContent); i++) {
    const now = new Date();
    const back = now.getFullYear() * 12 + now.getMonth() > 2026 * 12 + 9;
    document.querySelector(`[aria-label=${back ? 'Previous' : 'Next'}]`).click();
    await app.wait(40);
  }
  assert.match(document.querySelector('.cal-title').textContent, /October 2026/);
}

test('a Contractor can open the calendar', async () => {
  const app = await openApp('contractor');
  await import('../public/js/app.js');
  await app.wait(250);
  await app.go('#/calendar');
  assert.ok(app.main().querySelector('.cal-month'));
  assert.deepEqual(app.errors, []);
});
