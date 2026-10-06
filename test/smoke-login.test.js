// Joshua Nunez
// Front-end smoke test of the login page: the Google button, and the message after a Google sign-in did not work.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('the login page offers Google and explains a failed Google sign-in once', async () => {
  const app = await openApp('owner', { signedOut: true });
  app.window.location.hash = '#/signin-failed/no-account';
  await import('../public/js/app.js');
  await app.wait(300);
  const { document } = app;
  assert.match(document.body.textContent, /Sign in/);
  assert.match(document.body.textContent, /no AgencyOS account/);
  assert.match(document.body.textContent, /invite you with this email/);
  const google = [...document.querySelectorAll('a.btn')].find((a) => /Sign in with Google/.test(a.textContent));
  assert.equal(google.getAttribute('href'), '/api/auth/google/start');
  assert.ok(document.querySelector('input[name=username]') && document.querySelector('input[name=password]'));
  assert.equal(app.window.location.hash, ''); // tidied, so a reload does not show it again
  assert.equal(strayText(document.body), null);
  assert.deepEqual(app.errors, []);
});
