// Joshua Nunez
// Front-end smoke test for the Time page as an Owner: timer, my week, the review queue and the team workload,
// plus the retainer on the client page and the logged time on a task.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

test('the Owner uses the timer, reviews time, sees team workload, and the retainer and logged hours show', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const nav = [...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim());
  assert.equal(nav[nav.indexOf('Meetings') + 1], 'Time');

  await app.go('#/time');
  const text = () => app.main().textContent;
  assert.match(text(), /Timer/);
  assert.match(text(), /My week/);
  assert.match(text(), /Wrote the hero section/);
  assert.match(text(), /Rejected: Add the task/);
  assert.match(text(), /Submit week for approval \(2\)/);
  assert.match(text(), /Waiting for review/);
  assert.match(text(), /Sarah, 1 h 30 min/);
  assert.match(text(), /Team workload/);
  assert.match(text(), /Over capacity by 6 hours/);
  assert.equal(document.querySelectorAll('.week-day').length, 7);
  assert.ok(document.querySelectorAll('.load-row .bar-fill.over').length >= 1);
  assert.equal(strayText(document.body), null, `stray text: ${strayText(document.body)}`);

  // start, pause, resume and stop the timer
  buttonWith(app.main(), 'Start timer').click();
  await app.wait(120);
  assert.equal(app.calls.filter((c) => c.path === '/time/timer/start').length, 1);
  assert.ok(app.main().querySelector('.timer-clock'));
  assert.match(text(), /Running/);
  buttonWith(app.main(), 'Pause').click();
  await app.wait(120);
  assert.match(text(), /Paused/);
  buttonWith(app.main(), 'Resume').click();
  await app.wait(120);
  buttonWith(app.main(), 'Stop and save').click();
  await app.wait(120);
  assert.equal(app.main().querySelector('.timer-clock'), null);
  assert.ok(buttonWith(app.main(), 'Start timer'));

  // add time by hand
  buttonWith(app.main(), 'Add time').click();
  await app.wait(150);
  const sheet = document.querySelector('.sheet');
  assert.ok(sheet);
  sheet.querySelector('[name=hours]').value = '2';
  sheet.querySelector('form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await app.wait(150);
  const posted = app.calls.find((c) => c.method === 'POST' && c.path === '/time-entries');
  assert.equal(posted.body.minutes, 120);
  assert.equal(document.querySelector('.sheet'), null);

  // submit the week
  buttonWith(app.main(), 'Submit week for approval').click();
  await app.wait(120);
  assert.ok(app.calls.some((c) => c.path === '/time-entries/submit' && c.body.from && c.body.to));

  // approve one, and reject needs a note
  buttonWith(app.main(), 'Approve').click();
  await app.wait(120);
  assert.ok(app.calls.some((c) => /\/time-entries\/4\/approve/.test(c.path)));
  buttonWith(app.main(), 'Reject').click();
  await app.wait(150);
  const rejectSheet = document.querySelector('.sheet');
  rejectSheet.querySelector('[name=note]').value = 'Wrong client';
  rejectSheet.querySelector('form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await app.wait(150);
  assert.equal(app.calls.find((c) => /\/reject$/.test(c.path)).body.note, 'Wrong client');
  // the approved list shows Lock
  [...document.querySelectorAll('.chip')].find((c) => c.textContent.includes('ready to lock')).click();
  await app.wait(150);
  assert.ok(buttonWith(app.main(), 'Lock'));

  // the client page shows the retainer, with its warning, and a manager can edit it
  await app.go('#/clients/1');
  assert.match(text(), /Retainer/);
  assert.match(text(), /85 percent of the retainer is used, 3 hours left/);
  assert.match(text(), /Nearly used/);
  assert.match(text(), /2 h more is waiting for approval/);
  assert.equal(document.querySelectorAll('.bar-fill.warn').length, 1);
  assert.equal(strayText(document.body), null);
  [...document.querySelectorAll('.panel')].find((p) => /Retainer/.test(p.textContent)).querySelector('.btn-text').click();
  await app.wait(150);
  const retainerSheet = document.querySelector('.sheet');
  retainerSheet.querySelector('[name=hoursAllocated]').value = '25';
  retainerSheet.querySelector('form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await app.wait(150);
  assert.equal(app.calls.find((c) => c.method === 'PUT' && c.path === '/clients/1/retainer').body.hoursAllocated, 25);

  // the dashboard workload flags overload, and a task shows logged against estimated time
  await app.go('#/dashboard');
  assert.equal(strayText(document.body), null);
  await app.go('#/tasks');
  [...document.querySelectorAll('.task-row')][0].click();
  await app.wait(200);
  assert.match(document.querySelector('.sheet').textContent, /1.5 hours of 4 estimated/);
  assert.ok([...document.querySelectorAll('.sheet button')].some((b) => b.textContent.trim() === 'Log time'));
  assert.deepEqual(app.errors, []);
});
