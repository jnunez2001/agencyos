// Joshua Nunez
// Front-end smoke test for the notification bell as an Employee: the count, the list, opening one, mark all read.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('the bell shows the unread count, lists notifications, and opening one marks it read and goes there', async () => {
  const app = await openApp('employee');
  await import('../public/js/app.js');
  await app.wait(300);
  const { document } = app;
  const bell = document.querySelector('.sidebar .bell');
  assert.ok(bell, 'there is a bell');
  assert.equal(bell.querySelector('.badge').textContent, '2');
  assert.match(bell.getAttribute('aria-label'), /2 unread/);
  bell.click();
  await app.wait(250);
  const sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Task assigned to you: Homepage copy/);
  assert.match(sheet.textContent, /Your day: 1 overdue/);
  assert.equal(sheet.querySelectorAll('.notif.read').length, 1);
  assert.equal(strayText(document.body), null);
  sheet.querySelector('.notif').click();
  await app.wait(300);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/notifications/2/read'));
  assert.equal(document.querySelector('.sheet'), null);
  assert.deepEqual(app.errors, []);
});
