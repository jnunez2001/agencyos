// Joshua Nunez
// Front-end smoke test as the Owner: every screen and every sheet opens, nothing throws, and no stray values show.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('the Owner can open every screen and sheet without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;

  const nav = [...document.querySelectorAll('.sidebar .nav-link')].map((a) => a.textContent.trim());
  assert.deepEqual(nav, ['Dashboard', 'Calendar', 'Tasks', 'QA', 'Projects', 'Clients', 'Reports', 'SOPs', 'Team', 'AI agent', 'Activity', 'Settings']);

  for (const [hash, title] of [['#/dashboard', 'Good'], ['#/team', 'Team'], ['#/activity', 'Activity'], ['#/settings', 'Settings'], ['#/profile', 'My profile']]) {
    await app.go(hash);
    const main = app.main();
    assert.ok(main && main.textContent.includes(title), `${hash} shows ${title}`);
    assert.equal(strayText(document.body), null, `${hash} has stray text: ${strayText(document.body)}`);
  }

  // Team: the add sheet and a member sheet
  await app.go('#/team');
  const rows = [...document.querySelectorAll('.row')];
  assert.equal(rows.length, 4);
  assert.match(rows[3].textContent, /Inactive/);
  [...document.querySelectorAll('.page-head .btn-primary')][0].click();
  await app.wait();
  let sheet = document.querySelector('.sheet');
  assert.ok(sheet && /Add a team member/.test(sheet.textContent));
  assert.equal(sheet.querySelector('input[name=password]').value, ''); // Google is the standard, so no password is made
  assert.ok(sheet.querySelector('input[name=googleEmail]'));
  assert.deepEqual([...sheet.querySelectorAll('select[name=role] option')].map((o) => o.value), ['owner', 'admin', 'manager', 'employee', 'contractor']);
  assert.equal(strayText(sheet), null);
  sheet.querySelector('button[aria-label=Close]').click();
  assert.equal(document.querySelector('.sheet'), null);
  await app.wait(80);

  rows[2].click(); // Mark, a manager the Owner can manage
  await app.wait(150);
  sheet = document.querySelector('.sheet');
  assert.ok(sheet && /Mark Cruz/.test(sheet.textContent));
  assert.ok([...sheet.querySelectorAll('button')].some((b) => /Reset password/.test(b.textContent)));
  assert.equal(strayText(sheet), null);
  [...sheet.querySelectorAll('button')].find((b) => /Reset password/.test(b.textContent)).click();
  await app.wait();
  assert.ok(/Reset password for Mark Cruz/.test(document.querySelector('.sheet').textContent));
  document.querySelector('.sheet button[aria-label=Close]').click();
  await app.wait(80); // the browser steps back from the sheet's history entry

  // Activity: sentences and changes are readable, an unknown action still shows
  await app.go('#/activity');
  const text = app.main().textContent;
  assert.match(text, /Josh Nunez changed a member/);
  assert.match(text, /Role: employee to manager/);
  assert.match(text, /Working days: 1, 2 to 1, 2, 3/);
  assert.match(text, /System something\.new/);

  // Saving settings sends the CSRF token
  await app.go('#/settings');
  app.main().querySelector('form').requestSubmit();
  await app.wait(150);
  const patch = app.calls.find((c) => c.method === 'PATCH' && c.path === '/org');
  assert.ok(patch && patch.csrf === 'csrf-token');

  assert.deepEqual(app.errors, []);
});
