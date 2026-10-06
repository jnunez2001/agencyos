// Joshua Nunez
// Front-end smoke test .
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

test('an Employee sees the calendar but may only block time', async () => {
  const app = await openApp('employee');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  await app.go('#/calendar');
  await toOctober(app);
  assert.match(app.main().textContent, /Kickoff call/);
  assert.ok(buttonWith(app.main(), 'Block time'));
  assert.equal(buttonWith(app.main(), 'New event'), undefined);
  [...document.querySelectorAll('.cal-chip')].find((c) => c.textContent.includes('Kickoff call')).click();
  await app.wait(150);
  assert.equal(buttonWith(document.querySelector('.sheet'), 'Edit'), undefined);
  assert.equal(buttonWith(document.querySelector('.sheet'), 'Delete'), undefined);
  document.querySelector('.sheet [aria-label=Close]').click();
  buttonWith(app.main(), 'Block time').click();
  await app.wait(250);
  const sheet = document.querySelector('.sheet');
  assert.deepEqual([...sheet.querySelectorAll('select[name=type] option')].map((o) => o.value), ['blocked_time']);
  assert.equal(sheet.querySelector('select[name=clientId]'), null);
  assert.deepEqual(app.errors, []);
});
