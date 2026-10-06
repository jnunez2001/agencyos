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
  assert.deepEqual([...sheet.querySelectorAll('select[name=gscSiteUrl] option')].map((o) => o.textContent), ['None', 'sc-domain:acme.example']);
  assert.deepEqual([...sheet.querySelectorAll('select[name=ga4PropertyId] option')].map((o) => o.textContent), ['None', 'Acme site (111), Acme']);
  assert.match(sheet.textContent, /shared with agencyos@project\.iam\.gserviceaccount\.com/);
  clean('connect sheet');
  sheet.querySelector('select[name=gscSiteUrl]').value = 'sc-domain:acme.example';
  sheet.querySelector('select[name=ga4PropertyId]').value = '111';
  sheet.querySelector('form').requestSubmit();
  await app.wait(300);
  const put = app.calls.find((c) => c.method === 'PUT' && c.path === '/clients/1/google');
  assert.deepEqual([put.body.gscSiteUrl, put.body.ga4PropertyId, put.csrf], ['sc-domain:acme.example', '111', 'csrf-token']);
  await app.wait(100);

  // connected: what is linked, when it synced, and the problem if one source failed
  text = app.main().textContent;
  for (const part of ['sc-domain:acme.example', 'Property 111', 'Last synced', 'with a problem', 'Google Analytics: Google refused access']) assert.ok(text.includes(part), part);
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

  // Settings shows the address to share
  await app.go('#/settings');
  text = app.main().textContent;
  assert.match(text, /Google/);
  assert.match(text, /Set up/);
  assert.match(text, /agencyos@project\.iam\.gserviceaccount\.com/);
  clean('settings');

  assert.deepEqual(app.errors, []);
});
