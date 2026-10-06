// Joshua Nunez
// Front-end smoke test as the Owner for client requests, decisions, follow-ups and Create records on a note.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button, a.btn')].find((b) => b.textContent.trim() === text);

test('the Owner works through requests, decisions, follow-ups and records from a note', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);
  assert.ok([...document.querySelectorAll('.nav-link')].some((a) => a.textContent.includes('Requests')));

  // requests
  await app.go('#/requests');
  assert.match(app.main().textContent, /Add online booking/);
  assert.match(app.main().textContent, /asked by Dr. Lee/);
  clean('requests list');
  buttonWith(app.main(), 'All').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.path.startsWith('/requests') && !c.path.includes('open=1')));
  await app.go('#/requests/1');
  const text = app.main().textContent;
  for (const w of ['Add online booking', 'New', 'Acme Dental', 'Dr. Lee', 'Kickoff call', 'For hygiene visits']) assert.match(text, new RegExp(w));
  clean('request page');
  app.main().querySelector('select[name=status]').value = 'approved';
  app.main().querySelector('select[name=status]').dispatchEvent(new document.defaultView.Event('change'));
  await app.wait(150);
  assert.deepEqual(app.calls.find((c) => c.method === 'PATCH' && c.path === '/requests/1').body, { status: 'approved' });
  buttonWith(app.main(), 'Convert to task').click();
  await app.wait(300);
  const sheet = document.querySelector('.sheet');
  clean('convert form');
  assert.equal(sheet.querySelector('input[name=title]').value, 'Add online booking');
  sheet.querySelector('form').requestSubmit();
  await app.wait(250);
  const conv = app.calls.find((c) => c.method === 'POST' && c.path === '/requests/1/convert');
  assert.deepEqual([conv.body.projectId, conv.body.title], [1, 'Add online booking']);
  buttonWith(app.main(), 'Edit').click();
  await app.wait(300);
  assert.equal(document.querySelector('.sheet input[name=title]').value, 'Add online booking');
  document.querySelector('.sheet [aria-label=Close]').click();
  await app.wait(200);

  // decisions and follow-ups tabs
  await app.go('#/meetings/decisions');
  assert.match(app.main().textContent, /Use WordPress/);
  assert.match(app.main().textContent, /Cheaper to run/);
  clean('decisions');
  buttonWith(app.main(), 'New decision').click();
  await app.wait(300);
  const dform = document.querySelector('.sheet');
  dform.querySelector('input[name=title]').value = 'Go live in November';
  dform.querySelector('form').requestSubmit();
  await app.wait(250);
  assert.equal(app.calls.find((c) => c.method === 'POST' && c.path === '/decisions').body.title, 'Go live in November');

  await app.go('#/meetings/follow-ups');
  assert.match(app.main().textContent, /Send the quote/);
  assert.match(app.main().textContent, /Overdue, Jan 1, 2020/);
  clean('follow-ups');
  document.querySelector('.row input[type=checkbox]').click();
  await app.wait(200);
  assert.deepEqual(app.calls.find((c) => c.method === 'PATCH' && c.path === '/follow-ups/1').body, { status: 'done' });

  // a note creates its records
  await app.go('#/meetings/1');
  assert.match(app.main().textContent, /Records from these notes/);
  buttonWith(app.main(), 'Create records').click();
  await app.wait(250);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/meeting-notes/1/records'));
  assert.ok(app.errors.some((e) => /Created 1 decisions, 1 requests and 2 follow-ups/.test(e)), 'the person is told what was made');
  app.errors.length = 0;
  assert.deepEqual(app.errors, []);
});
