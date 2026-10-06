// Joshua Nunez
// Front-end smoke test as the Owner for Google data: the client panel, connecting, syncing, read-only synced numbers, Settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can connect Google to a client and see synced numbers without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  await app.go('#/clients/1');
  let text = app.main().textContent;
  assert.match(text, /Google data/);
  assert.match(text, /Not connected/);
  assert.ok(buttonWith(app.main(), 'Connect Google'));
  assert.ok([...app.main().querySelectorAll('.metric')].find((m) => /Search clicks/.test(m.textContent)).textContent.includes('Google'));
  clean('client page, not connected');

  // choose from what the service account can see
  buttonWith(app.main(), 'Connect Google').click();
  await app.wait(300);
  let sheet = document.querySelector('.sheet');
  const optionsOf = (name) => [...sheet.querySelectorAll(`select[name=${name}] option`)].map((o) => o.textContent);
  assert.deepEqual(optionsOf('source'), ['josh@example.com', 'Service account (agencyos@project.iam.gserviceaccount.com)']);
  assert.deepEqual(optionsOf('gscSiteUrl'), ['None', 'sc-domain:acme.example', 'https://beta.example/']);
  assert.deepEqual(optionsOf('ga4PropertyId'), ['None', 'Acme site (111), Acme', 'Beta site (222), Beta']);
  clean('connect sheet');
  // the search box narrows both lists
  const search = sheet.querySelector('input[name=search]');
  search.value = 'beta';
  search.dispatchEvent(new app.window.Event('input'));
  assert.deepEqual(optionsOf('gscSiteUrl'), ['None', 'https://beta.example/']);
  assert.deepEqual(optionsOf('ga4PropertyId'), ['None', 'Beta site (222), Beta']);
  search.value = '';
  search.dispatchEvent(new app.window.Event('input'));
  // another account shows its own lists, and why one has nothing to offer
  const source = sheet.querySelector('select[name=source]');
  source.value = 'service';
  source.dispatchEvent(new app.window.Event('change'));
  assert.deepEqual(optionsOf('gscSiteUrl'), ['None']);
  assert.match(sheet.textContent, /Google refused access/);
  source.value = '7';
  source.dispatchEvent(new app.window.Event('change'));
  sheet.querySelector('select[name=gscSiteUrl]').value = 'sc-domain:acme.example';
  sheet.querySelector('select[name=ga4PropertyId]').value = '111';
  sheet.querySelector('form').requestSubmit();
  await app.wait(300);
  const put = app.calls.find((c) => c.method === 'PUT' && c.path === '/clients/1/google');
  assert.deepEqual([put.body.source, put.body.gscSiteUrl, put.body.ga4PropertyId, put.csrf], ['7', 'sc-domain:acme.example', '111', 'csrf-token']);
  await app.wait(100);

  // connected: what is linked, when it synced, and the problem if one source failed
  text = app.main().textContent;
  for (const part of ['josh@example.com', 'sc-domain:acme.example', 'Property 111', 'Last synced', 'with a problem', 'Google Analytics: Google refused access']) assert.ok(text.includes(part), part);
  assert.ok(buttonWith(app.main(), 'Sync now') && buttonWith(app.main(), 'Change') && buttonWith(app.main(), 'Disconnect'));
  assert.equal(buttonWith(app.main(), 'Connect Google'), undefined);
  clean('client page, connected');
  buttonWith(app.main(), 'Sync now').click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/clients/1/google/sync'));

  // synced numbers cannot be edited by hand
  [...app.main().querySelectorAll('.metric')].find((m) => /Search clicks/.test(m.textContent)).click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /90/);
  assert.match(sheet.textContent, /Google Search Console, Sep 2026/);
  assert.deepEqual([...sheet.querySelectorAll('.row')].map((r) => r.tagName), ['DIV']);
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);

  // disconnect takes two clicks
  const disconnect = buttonWith(app.main(), 'Disconnect');
  disconnect.click();
  assert.match(disconnect.textContent, /again to disconnect/);
  disconnect.click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.method === 'DELETE' && c.path === '/clients/1/google'));
  assert.match(app.main().textContent, /Not connected/);

  // Settings: connected accounts, adding one, removing one, and the service account tucked away
  await app.go('#/settings');
  text = app.main().textContent;
  for (const part of ['Google', 'josh@example.com', '1 client', 'added by Josh Nunez', 'old@example.com', 'Needs reconnecting', 'Service account (advanced)', 'agencyos@project.iam.gserviceaccount.com']) assert.ok(text.includes(part), part);
  clean('settings');
  buttonWith(app.main(), 'Add Google account').click();
  await app.wait(200);
  const started = app.calls.find((c) => c.method === 'POST' && c.path === '/integrations/google/accounts/start');
  assert.deepEqual([started.body.returnTo, started.csrf], ['settings', 'csrf-token']);
  const remove = buttonWith(app.main(), 'Remove');
  remove.click();
  assert.match(remove.textContent, /again to remove/);
  remove.click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.method === 'DELETE' && c.path === '/integrations/google/accounts/7'));

  // where Google sends the person back to
  await app.go('#/google/ok/clients-1');
  assert.match(app.main().textContent, /Google account connected/);
  assert.equal(app.main().querySelector('a.btn').getAttribute('href'), '#/clients/1');
  await app.go('#/google/ok/settings');
  assert.equal(app.main().querySelector('a.btn').getAttribute('href'), '#/settings');
  await app.go('#/google/ok/https:');
  assert.equal(app.main().querySelector('a.btn').getAttribute('href'), '#/settings'); // nothing else is ever followed
  await app.go('#/google/failed/denied');
  assert.match(app.main().textContent, /Access was not approved/);
  await app.go('#/google/failed/expired');
  assert.match(app.main().textContent, /expired or does not belong to you/);
  clean('google result pages');

  assert.deepEqual(app.errors, []);
});
