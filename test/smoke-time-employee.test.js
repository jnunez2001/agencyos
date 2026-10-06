// Joshua Nunez
// Front-end smoke test for the Time page as an Employee: their own week and timer, and no review or team views.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

test('an Employee logs their own time and sees no review queue, team workload or retainer editing', async () => {
  const app = await openApp('employee');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  await app.go('#/time');
  const text = () => app.main().textContent;
  assert.match(text(), /My week/);
  assert.match(text(), /Start timer/);
  assert.doesNotMatch(text(), /Team workload/);
  assert.equal(buttonWith(app.main(), 'Approve'), undefined);
  assert.equal(buttonWith(app.main(), 'Reject'), undefined);
  assert.equal(app.calls.some((c) => /status=submitted/.test(c.path)), false);
  assert.ok(buttonWith(app.main(), 'Submit week for approval'));
  assert.equal(strayText(document.body), null, `stray text: ${strayText(document.body)}`);
  // an entry that is a draft opens for editing and can be deleted
  document.querySelector('.week .row[type=button]').click();
  await app.wait(150);
  assert.ok(document.querySelector('.sheet [name=hours]'));
  assert.ok([...document.querySelectorAll('.sheet button')].some((b) => /Delete/.test(b.textContent)));
  document.querySelector('.sheet .icon-btn').click();
  await app.wait(60);
  // the client page shows the retainer usage without a way to change it
  await app.go('#/clients/1');
  assert.match(app.main().textContent, /85 percent of the retainer is used/);
  assert.ok(![...app.main().querySelectorAll('.panel')].find((p) => /Retainer/.test(p.textContent)).querySelector('.btn-text'));
  assert.deepEqual(app.errors, []);
});
