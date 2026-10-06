// Joshua Nunez
// Front-end smoke test for the link from a calendar event to its meeting notes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button, a.btn')].find((b) => b.textContent.trim() === text);

test('an event on the calendar offers its notes', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  await app.go('#/calendar');
  for (let i = 0; i < 80 && !/October 2026/.test(document.querySelector('.cal-title').textContent); i++) {
    const now = new Date();
    document.querySelector(`[aria-label=${now.getFullYear() * 12 + now.getMonth() > 2026 * 12 + 9 ? 'Previous' : 'Next'}]`).click();
    await app.wait(40);
  }
  [...document.querySelectorAll('.cal-chip')].find((c) => c.textContent.includes('Kickoff call')).click();
  await app.wait(150);
  assert.ok(buttonWith(document.querySelector('.sheet'), 'Add meeting notes'), 'an event without notes offers to add them');
  buttonWith(document.querySelector('.sheet'), 'Add meeting notes').click();
  await app.wait(250);
  const form = document.querySelector('.sheet');
  assert.equal(form.querySelector('input[name=title]').value, 'Kickoff call');
  assert.equal(form.querySelector('input[name=meetingDate]').value.length, 10);
  form.querySelector('form').requestSubmit();
  await app.wait(250);
  assert.equal(app.calls.find((c) => c.method === 'POST' && c.path === '/meeting-notes').body.eventId, 1);
  assert.deepEqual(app.errors, []);
});
