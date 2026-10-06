// Joshua Nunez
// Front-end smoke test as the Owner for the work screens: tasks, projects, clients and the dashboard.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const click = (el) => el.click();
const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can open every work screen and sheet without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // Dashboard: my work, agency totals, workload
  await app.go('#/dashboard');
  let text = app.main().textContent;
  assert.match(text, /My work/);
  assert.match(text, /Active clients/);
  assert.match(text, /Workload/);
  assert.match(text, /30 of 20 h/);
  assert.match(text, /Overdue, Jan 1, 2020/);
  assert.ok(app.main().querySelector('.bar-fill.over'), 'an overloaded person is marked');
  assert.equal(app.main().querySelector('.bar-fill').style.width, '30%');
  assert.match(text, /Today/);
  assert.match(text, /Team sync/);
  assert.match(text, /Owner overview/);
  assert.match(text, /Needs a manager/);
  assert.match(text, /Meetings with no notes yet/);
  assert.match(text, /Clients at risk/);
  clean('dashboard');

  // Tasks: list, board, filters
  await app.go('#/tasks');
  assert.equal(document.querySelectorAll('.task-row').length, 3);
  assert.match(app.main().textContent, /Homepage copy/);
  clean('task list');
  click(buttonWith(app.main(), 'Board'));
  await app.wait(150);
  assert.equal(document.querySelectorAll('.column').length, 5);
  assert.equal(document.querySelectorAll('.card').length, 3);
  clean('board');
  click(buttonWith(app.main(), 'List'));
  await app.wait(150);
  click(buttonWith(app.main(), 'My tasks'));
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.path.startsWith('/tasks?') && c.path.includes('mine=1')));
  click(buttonWith(app.main(), 'My tasks'));
  await app.wait(100);

  // a task sheet: details, status, comments, edit form, comment post
  document.querySelector('.task-row').click();
  await app.wait(200);
  let sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Homepage copy/);
  assert.match(sheet.textContent, /New website, Acme Dental/);
  assert.match(sheet.textContent, /Please start with the services page/);
  assert.equal(sheet.querySelector('select[name=status]').disabled, false);
  clean('task sheet');
  sheet.querySelector('textarea[name=body]').value = 'On it';
  sheet.querySelectorAll('form')[0].requestSubmit();
  await app.wait(150);
  const comment = app.calls.find((c) => c.method === 'POST' && c.path === '/tasks/1/comments');
  assert.deepEqual([comment.body.body, comment.csrf], ['On it', 'csrf-token']);
  const status = sheet.querySelector('select[name=status]');
  status.value = 'review';
  status.dispatchEvent(new app.window.Event('change'));
  await app.wait(150);
  assert.ok(app.calls.some((c) => c.method === 'PATCH' && c.path === '/tasks/1' && c.body.status === 'review'));
  click(buttonWith(sheet, 'Edit'));
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Edit task/);
  assert.equal(sheet.querySelector('input[name=title]').value, 'Homepage copy');
  assert.equal(sheet.querySelector('input[name=estimateHours]').value, '4');
  clean('task form');
  const del = buttonWith(sheet, 'Delete task');
  click(del);
  assert.match(del.textContent, /again to delete/);
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const patch = app.calls.filter((c) => c.method === 'PATCH' && c.path === '/tasks/1').pop();
  assert.equal(patch.body.title, 'Homepage copy');
  assert.equal(patch.body.assigneeId, 1);
  assert.equal(document.querySelector('.sheet'), null);
  await app.wait(80);

  // New task
  click(buttonWith(app.main(), 'New task'));
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /New task/);
  sheet.querySelector('input[name=title]').value = 'Write the brief';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const created = app.calls.find((c) => c.method === 'POST' && c.path === '/tasks');
  assert.deepEqual([created.body.title, created.body.projectId, created.body.assigneeId, created.body.dueDate], ['Write the brief', 1, null, null]);
  await app.wait(80);

  // Projects: list, page, form
  await app.go('#/projects');
  assert.match(app.main().textContent, /New website/);
  assert.match(app.main().textContent, /Acme Dental/);
  clean('project list');
  await app.go('#/projects/1');
  text = app.main().textContent;
  assert.match(text, /Rebuild the site/);
  assert.match(text, /2 open, 1 done/);
  assert.equal(document.querySelectorAll('.task-row').length, 3);
  clean('project page');
  click(buttonWith(app.main(), 'Edit'));
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('input[name=name]').value, 'New website');
  assert.equal(sheet.querySelector('input[name=dueDate]').value, '2030-01-31');
  clean('project form');
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);

  // Clients: list, page, forms
  await app.go('#/clients');
  assert.equal(document.querySelectorAll('a.row').length, 1); // only active by default
  clean('client list');
  click(buttonWith(app.main(), 'All'));
  await app.wait(150);
  assert.equal(document.querySelectorAll('a.row').length, 2);
  await app.go('#/clients/1');
  text = app.main().textContent;
  assert.match(text, /Dr\. Lee/);
  assert.match(text, /Primary/);
  assert.match(text, /Prefers email/);
  assert.match(text, /New website/);
  clean('client page');
  click(buttonWith(app.main(), 'Add contact'));
  await app.wait(150);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('input[name=name]').value = 'Sam';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const contact = app.calls.find((c) => c.method === 'POST' && c.path === '/clients/1/contacts');
  assert.deepEqual([contact.body.name, contact.body.isPrimary], ['Sam', false]);
  await app.wait(80);
  click([...document.querySelectorAll('.list-inner button.row')][0]);
  await app.wait(150);
  assert.match(document.querySelector('.sheet').textContent, /Edit contact/);
  assert.ok(buttonWith(document.querySelector('.sheet'), 'Delete contact'));
  document.querySelector('.sheet button[aria-label=Close]').click();
  await app.wait(100);

  assert.deepEqual(app.errors, []);
});
