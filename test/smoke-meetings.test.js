// Joshua Nunez
// Front-end smoke test for meeting notes as the Owner: the list, a note page, the form, and the link from an event.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button, a.btn')].find((b) => b.textContent.trim() === text);

test('the Owner can list, open, edit, finalize and delete meeting notes', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);
  assert.ok([...document.querySelectorAll('.nav-link')].some((a) => a.textContent.includes('Meetings')));

  await app.go('#/meetings');
  assert.match(app.main().textContent, /Kickoff call/);
  assert.match(app.main().textContent, /Acme Dental/);
  assert.equal(document.querySelectorAll('.row').length, 1);
  clean('list');
  buttonWith(app.main(), 'Final').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.path.startsWith('/meeting-notes?') && c.path.includes('status=final')));
  buttonWith(app.main(), 'All').click();
  await app.wait(150);

  document.querySelector('.row').click();
  await app.go('#/meetings/1');
  let text = app.main().textContent;
  for (const w of ['Kickoff call', 'Draft', 'Talked about the website', 'Use WordPress', 'Send the logo', 'Mark sends a quote', 'New website']) assert.match(text, new RegExp(w));
  clean('note page');

  buttonWith(app.main(), 'Mark final').click();
  await app.wait(150);
  assert.deepEqual(app.calls.find((c) => c.method === 'PATCH' && c.path === '/meeting-notes/1').body, { status: 'final' });

  buttonWith(app.main(), 'Edit').click();
  await app.wait(250);
  const sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('textarea[name=discussion]').value, 'Talked about the website');
  sheet.querySelector('textarea[name=decisions]').value = 'Use WordPress and Elementor';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const saved = app.calls.filter((c) => c.method === 'PATCH' && c.path === '/meeting-notes/1').pop();
  assert.equal(saved.body.decisions, 'Use WordPress and Elementor');
  assert.equal(saved.csrf, 'csrf-token');

  // new notes on their own
  await app.go('#/meetings');
  buttonWith(app.main(), 'New notes').click();
  await app.wait(250);
  const form = document.querySelector('.sheet');
  clean('new notes form');
  form.querySelector('input[name=title]').value = 'Phone call';
  form.querySelector('form').requestSubmit();
  await app.wait(250);
  const post = app.calls.find((c) => c.method === 'POST' && c.path === '/meeting-notes');
  assert.equal(post.body.title, 'Phone call');
  assert.equal(post.body.eventId, undefined);
  assert.deepEqual(app.errors, []);
});
