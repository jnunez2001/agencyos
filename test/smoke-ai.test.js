// Joshua Nunez
// Front-end smoke test as the Owner for the AI page: inbox, approving, keys, the one-time token.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can use the AI inbox and keys without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // the dashboard points at the inbox
  assert.match(app.main().textContent, /AI inbox/);
  assert.match(app.main().textContent, /1 plan is waiting for your approval/);

  await app.go('#/ai');
  let text = app.main().textContent;
  assert.match(text, /AI agent/);
  assert.match(text, /MCP server address/);
  assert.match(text, /http:\/\/localhost\/mcp/);
  assert.match(text, /Claude on the web and phone/);
  assert.match(text, /Add custom connector/);
  clean('setup tab');
  // create a personal key and get the setup prompt (there is no clipboard here, so it is shown to copy by hand)
  const setupAccess = app.main().querySelector('select[name=setup-access]');
  assert.equal(setupAccess.value, 'propose');
  buttonWith(app.main(), 'Create key and copy setup prompt').click();
  await app.wait(200);
  const made = app.calls.find((c) => c.method === 'POST' && c.path === '/api-keys');
  assert.deepEqual([made.body.name, made.body.access], ["Josh Nunez's agent", 'propose']);
  const prompt = app.main().querySelector('textarea[aria-label="Setup prompt"]').value;
  assert.match(prompt, /Server URL: http:\/\/localhost\/mcp/);
  assert.match(prompt, /Authorization: Bearer aos_Qq77SecretSecretSecretSecretSecret/);
  assert.match(prompt, /claude mcp add --transport http --scope user agencyos/);
  clean('setup prompt');
  buttonWith(app.main(), 'Inbox').click();
  await app.wait(150);
  text = app.main().textContent;
  assert.match(text, /Inbox \(1\)/);
  assert.match(text, /Set up Acme Dental/);
  assert.match(text, /Create project "New website" for "Acme Dental"/);
  assert.match(text, /Old plan/);
  assert.match(text, /already exists/);
  clean('inbox');

  buttonWith(app.main(), 'Approve').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/ai/proposals/2/approve' && c.csrf === 'csrf-token'));
  buttonWith(app.main(), 'Reject').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/ai/proposals/2/reject'));

  // connections
  buttonWith(app.main(), 'Connections').click();
  await app.wait(150);
  text = app.main().textContent;
  assert.match(text, /Claude on my Mac/);
  assert.match(text, /Ask me first/);
  assert.match(text, /Revoked/);
  assert.match(text, /Connected app/);
  assert.match(text, /Signed in with OAuth/);
  assert.ok(!text.includes('aos_Ab12SECRET'));
  clean('keys');

  buttonWith(app.main(), 'New key').click();
  await app.wait(100);
  let sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('select[name=access]').value, 'propose');
  assert.match(sheet.textContent, /Nothing happens until you approve/);
  sheet.querySelector('input[name=name]').value = 'New';
  sheet.querySelector('form').requestSubmit();
  await app.wait(300);
  const created = app.calls.filter((c) => c.method === 'POST' && c.path === '/api-keys').pop();
  assert.deepEqual([created.body.name, created.body.access], ['New', 'propose']);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /shown only once/);
  assert.equal(sheet.querySelector('input[aria-label="API key"]').value, 'aos_Qq77SecretSecretSecretSecretSecret');
  assert.match(sheet.querySelector('pre').textContent, /claude mcp add --transport http agencyos .*\/mcp --header "Authorization: Bearer aos_Qq77/);
  clean('token sheet');
  buttonWith(sheet, 'Done').click();
  await app.wait(100);

  // an existing key: change access, revoke needs two clicks, a revoked key is read only
  document.querySelectorAll('.row')[1].click();
  await app.wait(100);
  sheet = document.querySelector('.sheet');
  const revoke = buttonWith(sheet, 'Revoke key');
  revoke.click();
  assert.match(revoke.textContent, /again to revoke/);
  sheet.querySelector('select[name=access]').value = 'read';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  assert.ok(app.calls.some((c) => c.method === 'PATCH' && c.path === '/api-keys/1' && c.body.access === 'read'));
  await app.wait(100);
  document.querySelectorAll('.row')[2].click();
  await app.wait(100);
  assert.match(document.querySelector('.sheet').textContent, /This key is revoked/);
  document.querySelector('.sheet button[aria-label=Close]').click();
  await app.wait(100);

  // the page an AI app sends the person to
  await app.go('#/connect/abc123');
  text = app.main().textContent;
  assert.match(text, /Connect Claude/);
  assert.match(text, /claude\.ai/);
  assert.match(text, /Josh Nunez \(Owner\)/);
  assert.match(text, /Nothing happens until you approve/);
  clean('connect page');
  const select = app.main().querySelector('select[name=access]');
  select.value = 'read';
  select.dispatchEvent(new app.window.Event('change'));
  assert.match(app.main().textContent, /cannot change it/);
  buttonWith(app.main(), 'Approve').click();
  await app.wait(150);
  const approve = app.calls.find((c) => c.method === 'POST' && c.path === '/oauth/requests/abc123/approve');
  assert.deepEqual([approve.body.access, approve.csrf], ['read', 'csrf-token']);
  await app.go('#/connect/gone');
  assert.match(app.main().textContent, /has expired/);
  clean('expired request');

  assert.deepEqual(app.errors, []);
});
