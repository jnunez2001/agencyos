// Joshua Nunez
// Front-end smoke test for global search and Create as an Owner.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const typeInto = (app, input, text) => { input.value = text; input.dispatchEvent(new app.window.Event('input', { bubbles: true })); };
const key = (app, target, k) => target.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('search and Create work for an Owner', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  assert.ok(document.querySelector('.sidebar .quick-search'), 'the sidebar has a search button');
  assert.ok(document.querySelector('.topbar [aria-label=Search]'), 'the phone top bar has a search button');

  document.querySelector('.sidebar .quick-search').click();
  await app.wait(100);
  const input = document.querySelector('.sheet input[name=q]');
  assert.ok(input);
  assert.equal(document.activeElement, input, 'the box is focused');
  assert.match(document.querySelector('.sheet').textContent, /at least 2 characters/);
  typeInto(app, input, 'a');
  await app.wait(300);
  assert.equal(app.calls.filter((c) => c.path.startsWith('/search')).length, 0, 'one character is not searched');
  typeInto(app, input, 'acme');
  await app.wait(350);
  const row = document.querySelector('.sheet .search-group .row');
  assert.match(row.textContent, /Acme Dental/);
  assert.match(document.querySelector('.sheet').textContent, /Clients/);
  assert.equal(strayText(document.querySelector('.sheet')), null);
  key(app, input, 'Enter');
  await app.wait(350);
  assert.equal(document.querySelector('.sheet'), null, 'the sheet closed');
  assert.equal(app.window.location.hash, '#/clients/1');

  // The / key opens it again, but not while typing in a field; Escape closes.
  key(app, document.body, '/');
  assert.ok(document.querySelector('.sheet input[name=q]'));
  key(app, document, 'Escape');
  assert.equal(document.querySelector('.sheet'), null);
  await app.wait(100);

  // Nothing found says so; a task result opens the task.
  document.querySelector('.sidebar .quick-search').click();
  await app.wait(100);
  const again = document.querySelector('.sheet input[name=q]');
  typeInto(app, again, 'zzz');
  await app.wait(350);
  assert.match(document.querySelector('.sheet').textContent, /Nothing found/);
  typeInto(app, again, 'home');
  await app.wait(350);
  document.querySelector('.sheet .row').click();
  await app.wait(500);
  assert.ok(app.calls.some((c) => c.path === '/tasks/1'), 'the task was opened');
  assert.ok(document.querySelector('.sheet'), 'the task sheet is showing');
  assert.equal(app.window.location.hash, '#/tasks');
  document.querySelector('.sheet [aria-label=Close]').click();
  await app.wait(100);

  // Create lists everything an Owner may add and opens the forms.
  const open = async () => { document.querySelector('.sidebar .quick-create').click(); await app.wait(100); };
  await open();
  const names = [...document.querySelectorAll('.create-menu .row-title')].map((e) => e.textContent);
  assert.deepEqual(names, ['Event', 'Meeting notes', 'Client request', 'Follow-up', 'Task', 'Project', 'Client', 'Decision']);
  document.querySelector('[data-create=request]').click();
  await app.wait(300);
  const form = document.querySelector('.sheet');
  assert.match(form.textContent, /New client request/);
  form.querySelector('input[name=title]').value = 'Add a blog';
  form.querySelector('form').requestSubmit();
  await app.wait(250);
  const post = app.calls.find((c) => c.method === 'POST' && c.path === '/requests');
  assert.equal(post.body.title, 'Add a blog');
  assert.equal(post.body.clientId, 1);
  assert.equal(document.querySelector('.sheet'), null);

  await open();
  document.querySelector('[data-create=followup]').click();
  await app.wait(300);
  document.querySelector('.sheet input[name=title]').value = 'Send the quote';
  document.querySelector('.sheet form').requestSubmit();
  await app.wait(250);
  assert.equal(app.calls.find((c) => c.method === 'POST' && c.path === '/follow-ups').body.title, 'Send the quote');

  await open();
  document.querySelector('[data-create=decision]').click();
  await app.wait(300);
  assert.equal(document.querySelector('.sheet input[name=decidedOn]').value.length, 10);
  document.querySelector('.sheet input[name=title]').value = 'Use WordPress';
  document.querySelector('.sheet form').requestSubmit();
  await app.wait(250);
  assert.equal(app.calls.find((c) => c.method === 'POST' && c.path === '/decisions').body.title, 'Use WordPress');

  await open();
  document.querySelector('[data-create=client]').click();
  await app.wait(300);
  assert.match(document.querySelector('.sheet').textContent, /New client/);
  document.querySelector('.sheet [aria-label=Close]').click();
  await app.wait(100);
  // An event result opens that event once and tidies the address.
  await app.go('#/calendar/1');
  await app.wait(300);
  assert.match(document.querySelector('.sheet').textContent, /Kickoff call/);
  assert.equal(app.window.location.hash, '#/calendar');
  assert.deepEqual(app.errors, []);
});
