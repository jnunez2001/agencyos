// Joshua Nunez
// Front-end smoke test as the Owner for signing in with Google: the profile panel, the Team sheets, the result pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can link Google, go Google only, and invite members without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // my profile: linked, with the ways to change it
  await app.go('#/profile');
  let text = app.main().textContent;
  assert.match(text, /Sign in with Google/);
  assert.match(text, /Linked: josh@example\.com/);
  assert.ok(app.main().querySelector('form input[name=current]')); // the password card is there while password sign-in is on
  clean('profile');
  const off = buttonWith(app.main(), 'Sign in only with Google');
  off.click();
  assert.match(off.textContent, /again to turn off/);
  off.click();
  await app.wait(250);
  assert.deepEqual(app.calls.find((c) => c.method === 'POST' && c.path === '/profile/password-login').body, { enabled: false });
  const unlink = buttonWith(app.main(), 'Unlink Google');
  unlink.click();
  unlink.click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.method === 'DELETE' && c.path === '/profile/google' && c.csrf === 'csrf-token'));

  // Team: add a member by Google email, no password
  await app.go('#/team');
  buttonWith(app.main(), 'Add member').click();
  await app.wait(200);
  let sheet = document.querySelector('.sheet');
  assert.ok(sheet.querySelector('input[name=googleEmail]'));
  sheet.querySelector('input[name=displayName]').value = 'New Person';
  sheet.querySelector('input[name=username]').value = 'newbie';
  sheet.querySelector('input[name=googleEmail]').value = 'newbie@example.com';
  sheet.querySelector('input[name=password]').value = '';
  clean('add member sheet');
  sheet.querySelector('form').requestSubmit();
  await app.wait(250);
  const created = app.calls.find((c) => c.method === 'POST' && c.path === '/members');
  assert.deepEqual([created.body.googleEmail, 'password' in created.body, created.body.username], ['newbie@example.com', false, 'newbie']);
  await app.wait(100);

  // a member with a pending invitation, one linked, one with neither
  const rows = [...document.querySelectorAll('.row')];
  rows[2].click(); // Mark: invited
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('input[name=invite]').value, 'mark@example.com');
  sheet.querySelector('input[name=invite]').value = 'mark.new@example.com';
  buttonWith(sheet, 'Save invitation').click();
  await app.wait(250);
  assert.deepEqual(app.calls.find((c) => c.method === 'PUT' && c.path === '/members/3/google').body, { email: 'mark.new@example.com' });
  await app.wait(100);
  document.querySelectorAll('.row')[3].click(); // Sarah: linked, password sign-in already off
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Linked: sarah@example\.com \(password sign-in is off\)/);
  assert.equal(buttonWith(sheet, 'Turn off password sign-in'), undefined);
  clean('member sheet linked');
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);
  document.querySelectorAll('.row')[0].click(); // Josh: linked with a password
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  const turnOff = buttonWith(sheet, 'Turn off password sign-in');
  turnOff.click();
  turnOff.click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/members/1/password-login'));
  await app.wait(100);

  // where Google sends the person back after linking
  await app.go('#/google/linked');
  assert.match(app.main().textContent, /Google account linked/);
  assert.equal(app.main().querySelector('a.btn').getAttribute('href'), '#/profile');
  for (const [code, words] of [['taken', /already linked to someone else/], ['invited', /invited for another member/], ['different', /different Google account/], ['expired', /expired/]]) {
    await app.go(`#/google/link-failed/${code}`);
    assert.match(app.main().textContent, words);
    assert.match(app.main().textContent, /not linked/);
  }
  clean('result pages');
  assert.deepEqual(app.errors, []);
});
