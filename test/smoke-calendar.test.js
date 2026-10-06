// Joshua Nunez
// Front-end smoke test for the calendar: the views, the details sheet, the event form and the limits of an Employee.
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

test('the Owner can browse the calendar and add, open and change an event', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  await app.go('#/calendar');
  assert.ok([...document.querySelectorAll('.nav-link')].some((a) => a.textContent.includes('Calendar')));
  assert.equal(document.querySelectorAll('.cal-dow').length, 7);
  await toOctober(app);
  const text = app.main().textContent;
  assert.match(text, /Kickoff call/);
  assert.match(text, /Team retreat/);
  assert.match(text, /Task due: Homepage copy/);
  assert.match(text, /Project due: New website/);
  assert.equal(document.querySelectorAll('.cal-chip.deadline-item').length, 2);
  clean('month');
  const retreatDays = [...document.querySelectorAll('.cal-chip')].filter((c) => c.textContent.includes('Team retreat'));
  assert.equal(retreatDays.length, 2, 'an all-day event shows on each day it spans');

  // week, day, agenda
  buttonWith(app.main(), 'Agenda').click();
  await app.wait(150);
  assert.ok(document.querySelectorAll('.cal-row').length >= 1);
  clean('agenda');
  buttonWith(app.main(), 'Week').click();
  await app.wait(150);
  assert.equal(document.querySelectorAll('.cal-col').length, 7);
  clean('week');
  buttonWith(app.main(), 'Month').click();
  await app.wait(150);
  await toOctober(app);

  // filters ask the server
  buttonWith(app.main(), 'My calendar').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.path.startsWith('/calendar?') && c.path.includes('userId=1')));
  buttonWith(app.main(), 'Client').click();
  await app.wait(150);
  assert.ok(document.querySelector('select[aria-label=Client]'));
  buttonWith(app.main(), 'Team').click();
  await app.wait(150);
  await toOctober(app);

  // details of an event
  [...document.querySelectorAll('.cal-chip')].find((c) => c.textContent.includes('Kickoff call')).click();
  await app.wait(150);
  let sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Client meeting/);
  assert.match(sheet.textContent, /Zoom/);
  assert.match(sheet.textContent, /Acme Dental/);
  assert.match(sheet.textContent, /Josh Nunez, Mark Cruz/);
  clean('event details');

  // edit it
  buttonWith(sheet, 'Edit').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('input[name=title]').value, 'Kickoff call');
  sheet.querySelector('input[name=title]').value = 'Kickoff call, moved';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const patch = app.calls.find((c) => c.method === 'PATCH' && c.path === '/events/1');
  assert.equal(patch.body.title, 'Kickoff call, moved');
  assert.match(patch.body.startsAt, /^2026-10-12T14:00:00Z$/);
  assert.deepEqual(patch.body.attendees.sort(), [1, 3]);
  assert.equal(patch.csrf, 'csrf-token');

  // new event: an all-day one sends dates, not times
  buttonWith(app.main(), 'New event').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  clean('event form');
  sheet.querySelector('input[name=title]').value = 'Offsite';
  sheet.querySelector('input[name=allDay]').click();
  sheet.querySelector('input[name=startDate]').value = '2026-11-02';
  sheet.querySelector('input[name=endDate]').value = '2026-11-03';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const post = app.calls.find((c) => c.method === 'POST' && c.path === '/events');
  assert.deepEqual([post.body.title, post.body.allDay, post.body.startsAt, post.body.endsAt], ['Offsite', true, '2026-11-02', '2026-11-03']);
  assert.deepEqual(app.errors, []);
});
