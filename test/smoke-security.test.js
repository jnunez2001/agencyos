// Joshua Nunez
// Front-end smoke test as the Owner for the Security panel: requiring Google sign-in, and the message when it is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('the Owner can require Google sign-in and is told who still needs an invitation', async () => {
  let attempts = 0;
  const app = await openApp('owner', {
    respond: (method, path) => {
      if (method === 'PUT' && path === '/org/security') {
        attempts += 1;
        return attempts === 1 ? { __status: 400, error: 'Invite these people with a Google email first, so they are not locked out: Mark, Sarah' } : { requireGoogle: true };
      }
      return undefined;
    },
  });
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  await app.go('#/settings');
  let text = app.main().textContent;
  assert.match(text, /Security/);
  assert.match(text, /Require Google sign-in/);
  assert.match(text, /Owners keep their password/);
  assert.equal(strayText(document.body), null);

  const sw = () => app.main().querySelector('button.switch[aria-label="Require Google sign-in"]');
  assert.equal(sw().getAttribute('aria-checked'), 'false');
  sw().click();
  await app.wait(250);
  assert.equal(app.calls.filter((c) => c.method === 'PUT' && c.path === '/org/security').length, 1);
  assert.match(app.main().textContent, /Invite these people with a Google email first.*Mark, Sarah/);
  assert.equal(sw().getAttribute('aria-checked'), 'false'); // it did not switch on
  sw().click();
  await app.wait(250);
  const puts = app.calls.filter((c) => c.method === 'PUT' && c.path === '/org/security');
  assert.deepEqual([puts.length, puts[1].body, puts[1].csrf], [2, { requireGoogle: true }, 'csrf-token']);
  assert.equal(strayText(document.body), null);
  assert.deepEqual(app.errors, []);
});
