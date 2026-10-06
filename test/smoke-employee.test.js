// Joshua Nunez
// Front-end smoke test as an Employee-level view and as a first sign-in: the screens show less, and nothing breaks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('a Manager sees only what the role allows, and a forbidden address falls back to the dashboard', async () => {
  const app = await openApp('manager');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  assert.deepEqual([...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim()), ['Dashboard', 'Tasks', 'Projects', 'Clients', 'Team']);
  await app.go('#/team');
  assert.equal(document.querySelector('.page-head .btn-primary'), null); // no Add member
  document.querySelectorAll('.row')[0].click();
  await app.wait(150);
  const sheet = document.querySelector('.sheet');
  assert.ok(sheet);
  assert.deepEqual([...sheet.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean), ['Close']); // read only
  assert.equal(strayText(sheet), null);
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(80); // the browser steps back from the sheet's history entry
  await app.go('#/activity'); // not allowed
  assert.match(app.main().textContent, /Good (morning|afternoon|evening)/);
  assert.equal(app.window.location.hash, '#/dashboard');
  await app.go('#/profile');
  assert.match(app.main().textContent, /My profile/);
  assert.equal(strayText(document.body), null);
  assert.deepEqual(app.errors, []);
});
