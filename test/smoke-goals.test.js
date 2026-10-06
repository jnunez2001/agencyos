// Joshua Nunez
// Front-end smoke test as the Owner for goals and services: the client page, every form, and Settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can use goals and services without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // client list: filters and services
  await app.go('#/clients');
  assert.deepEqual([...document.querySelectorAll('.chip')].map((c) => c.textContent), ['Current', 'Paused', 'Past', 'All']);
  assert.equal(document.querySelectorAll('a.row').length, 1);
  assert.match(app.main().textContent, /SEO · Dental/);
  clean('client list');
  buttonWith(app.main(), 'Paused').click();
  await app.wait(150);
  assert.match(app.main().textContent, /Beta Bakery/);
  assert.match(app.main().textContent, /Paused/);

  // client page: goals with progress, services, account owner
  await app.go('#/clients/1');
  let text = app.main().textContent;
  for (const part of ['Goals', 'Increase qualified organic leads', 'Target: 50 leads a month', 'SEO', 'by Mar 31, 2027', '1 of 4 tasks done, 1 project', 'Account owner', 'Mark Cruz', 'Started', 'Goal: Increase qualified organic leads']) assert.ok(text.includes(part), part);
  assert.equal(app.main().querySelector('.goal .bar-fill').style.width, '25%');
  assert.ok(app.main().querySelector('.head-meta .pill.svc'));
  clean('client page');

  // edit a goal
  document.querySelector('.goal').click();
  await app.wait(250);
  let sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('input[name=title]').value, 'Increase qualified organic leads');
  assert.equal(sheet.querySelector('select[name=serviceId]').value, '1');
  clean('goal form');
  sheet.querySelector('input[name=target]').value = '80 leads a month';
  sheet.querySelector('select[name=status]').value = 'achieved';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const patched = app.calls.find((c) => c.method === 'PATCH' && c.path === '/goals/1');
  assert.deepEqual([patched.body.target, patched.body.status, patched.body.serviceId, patched.body.dueDate, patched.csrf], ['80 leads a month', 'achieved', 1, '2027-03-31', 'csrf-token']);
  await app.wait(80);

  // add a goal
  buttonWith(app.main(), 'Add goal').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('input[name=title]').value = 'Improve reviews';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const made = app.calls.find((c) => c.method === 'POST' && c.path === '/clients/1/goals');
  assert.deepEqual([made.body.title, made.body.status, made.body.serviceId], ['Improve reviews', 'active', null]);
  await app.wait(80);

  // edit the client: services toggle, account owner, start date
  buttonWith(app.main(), 'Edit').click();
  await app.wait(300);
  sheet = document.querySelector('.sheet');
  const chips = [...sheet.querySelectorAll('.chip')];
  assert.deepEqual(chips.map((c) => [c.textContent, c.getAttribute('aria-pressed')]), [['SEO', 'true'], ['Web Development', 'false']]);
  assert.equal(sheet.querySelector('select[name=accountOwnerId]').value, '3');
  assert.equal(sheet.querySelector('input[name=startDate]').value, '2026-09-01');
  assert.equal(sheet.querySelector('select[name=status]').options.length, 7);
  clean('client form');
  chips[1].click();
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const client = app.calls.find((c) => c.method === 'PATCH' && c.path === '/clients/1');
  assert.deepEqual([client.body.serviceIds, client.body.accountOwnerId, client.body.startDate], [[1, 2], 3, '2026-09-01']);
  await app.wait(80);

  // project form: service and the client's goals
  await app.go('#/projects/1');
  assert.match(app.main().textContent, /Service/);
  assert.match(app.main().textContent, /Goal/);
  buttonWith(app.main(), 'Edit').click();
  await app.wait(350);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('select[name=serviceId]').value, '1');
  assert.deepEqual([...sheet.querySelectorAll('select[name=goalId] option')].map((o) => o.textContent), ['No goal', 'Increase qualified organic leads']);
  assert.equal(sheet.querySelector('select[name=goalId]').value, '1');
  clean('project form');
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const project = app.calls.find((c) => c.method === 'PATCH' && c.path === '/projects/1');
  assert.deepEqual([project.body.serviceId, project.body.goalId], [1, 1]);
  await app.wait(80);

  // task form: goal choice
  await app.go('#/tasks');
  buttonWith(app.main(), 'New task').click();
  await app.wait(350);
  sheet = document.querySelector('.sheet');
  assert.deepEqual([...sheet.querySelectorAll('select[name=goalId] option')].map((o) => o.textContent), ["The project's goal", 'Increase qualified organic leads']);
  clean('task form');
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);

  // settings: services
  await app.go('#/settings');
  text = app.main().textContent;
  assert.match(text, /Services/);
  assert.match(text, /Web Development/);
  assert.match(text, /Old service/);
  assert.match(text, /Not in use/);
  clean('settings');
  buttonWith(app.main(), 'Add common services').click();
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.method === 'POST' && c.path === '/services/defaults'));
  buttonWith(app.main(), 'Add service').click();
  await app.wait(150);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('input[name=name]').value = 'Branding';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  assert.equal(app.calls.find((c) => c.method === 'POST' && c.path === '/services').body.name, 'Branding');
  await app.wait(80);
  document.querySelectorAll('.list-inner .row')[2].click(); // the inactive one
  await app.wait(150);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('input[name=name]').value, 'Old service');
  assert.equal(sheet.querySelector('.switch').getAttribute('aria-checked'), 'false');
  sheet.querySelector('.switch').click();
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const svc = app.calls.find((c) => c.method === 'PATCH' && c.path === '/services/3');
  assert.deepEqual([svc.body.name, svc.body.isActive], ['Old service', true]);

  assert.deepEqual(app.errors, []);
});
