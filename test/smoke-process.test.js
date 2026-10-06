// Joshua Nunez
// Front-end smoke test as the Owner for SOPs and QA: the list, an SOP page, every form and sheet, the QA queue and review.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('the Owner can use SOPs and QA without an error or stray text', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // dashboard points at QA
  assert.match(app.main().textContent, /1 task is waiting for review/);

  // SOP list: approved by default, all with the chip
  await app.go('#/sops');
  assert.match(app.main().textContent, /Page Optimization/);
  assert.doesNotMatch(app.main().textContent, /Draft idea/);
  assert.match(app.main().textContent, /v1\.1/);
  clean('sop list');
  buttonWith(app.main(), 'All').click();
  await app.wait(150);
  assert.match(app.main().textContent, /Draft idea/);

  // SOP page
  await app.go('#/sops/1');
  let text = app.main().textContent;
  for (const part of ['Page Optimization', 'Approved', 'v1.1', 'Needs QA', 'Rank the page', 'Research', 'Quality checklist', 'Title ok', 'Version 1.1', 'Current', 'Version 1.0', 'Added a step']) assert.ok(text.includes(part), part);
  assert.ok(buttonWith(app.main(), 'Use in a project') && buttonWith(app.main(), 'New version') && buttonWith(app.main(), 'Details'));
  clean('sop page');
  buttonWith(app.main(), 'View').click();
  await app.wait(150);
  let sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Old step one/);
  sheet.querySelector('button[aria-label=Close]').click();
  await app.wait(100);

  // new version: fields carry over, steps go as a list
  buttonWith(app.main(), 'New version').click();
  await app.wait(150);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('textarea[name=steps]').value, 'Research\nWrite');
  assert.match(sheet.textContent, /This adds version 1\.2/);
  sheet.querySelector('textarea[name=steps]').value = 'Research\nWrite\n\nPublish';
  sheet.querySelector('input[name=changeNote]').value = 'Added publish';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const ver = app.calls.find((c) => c.method === 'POST' && c.path === '/sops/1/versions');
  assert.deepEqual([ver.body.steps, ver.body.changeNote, ver.body.major, ver.csrf], [['Research', 'Write', 'Publish'], 'Added publish', false, 'csrf-token']);
  await app.wait(80);

  // details
  buttonWith(app.main(), 'Details').click();
  await app.wait(200);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('select[name=status]').value, 'approved');
  sheet.querySelector('select[name=status]').value = 'deprecated';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  assert.equal(app.calls.find((c) => c.method === 'PATCH' && c.path === '/sops/1').body.status, 'deprecated');
  await app.wait(80);

  // use in a project
  buttonWith(app.main(), 'Use in a project').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('select[name=mode]').value = 'steps';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const used = app.calls.find((c) => c.method === 'POST' && c.path === '/sops/1/tasks');
  assert.deepEqual([used.body.mode, used.body.projectId], ['steps', 1]);
  await app.wait(200);
  assert.equal(app.window.location.hash, '#/projects/1');

  // new SOP
  await app.go('#/sops');
  buttonWith(app.main(), 'New SOP').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  clean('new sop form');
  sheet.querySelector('input[name=title]').value = 'New one';
  sheet.querySelector('textarea[name=steps]').value = 'One\nTwo';
  sheet.querySelector('input[name=requiresQa]').checked = true;
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const created = app.calls.find((c) => c.method === 'POST' && c.path === '/sops');
  assert.deepEqual([created.body.title, created.body.steps, created.body.requiresQa, created.body.status], ['New one', ['One', 'Two'], true, 'draft']);
  await app.wait(200);
  assert.equal(app.window.location.hash, '#/sops/3');

  // a task that follows an SOP
  await app.go('#/tasks');
  const rows = [...document.querySelectorAll('.task-row')];
  rows[0].click(); // Homepage copy: in progress, needs QA
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Page Optimization v1\.0/);
  assert.match(sheet.textContent, /Newer version 1\.1 exists/);
  assert.match(sheet.textContent, /Needs QA/);
  const done = [...sheet.querySelectorAll('select[name=status] option')].find((o) => o.value === 'done');
  const changes = [...sheet.querySelectorAll('select[name=status] option')].find((o) => o.value === 'changes');
  assert.deepEqual([done.disabled, changes.disabled], [true, true]);
  assert.match(sheet.querySelector('details').textContent, /Research/);
  clean('task with sop');
  buttonWith(sheet, 'Submit for QA').click();
  await app.wait(200);
  assert.ok(app.calls.some((c) => c.method === 'PATCH' && c.path === '/tasks/1' && c.body.status === 'review'));
  await app.wait(100);

  // a task waiting in QA: history and the review sheet
  document.querySelectorAll('.task-row')[1].click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Waiting/);
  assert.match(sheet.textContent, /Title was too long/);
  assert.match(sheet.textContent, /Checklist 1 of 2/);
  clean('task in qa');
  buttonWith(sheet, 'Review').click();
  await app.wait(300);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Review: Logo options/);
  const approve = buttonWith(sheet, 'Approve');
  assert.equal(approve.disabled, true);
  sheet.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = true; b.dispatchEvent(new app.window.Event('change')); });
  assert.equal(approve.disabled, false);
  clean('review sheet');
  approve.click();
  await app.wait(200);
  const approved = app.calls.find((c) => c.method === 'POST' && c.path === '/tasks/2/qa');
  assert.deepEqual([approved.body.result, approved.body.checklist, approved.csrf], ['approved', [true, true], 'csrf-token']);
  await app.wait(100);

  // the QA queue
  await app.go('#/qa');
  assert.match(app.main().textContent, /Logo options/);
  assert.match(app.main().textContent, /Page Optimization v1\.0/);
  assert.match(app.main().textContent, /2 checks/);
  clean('qa queue');
  document.querySelector('.row').click();
  await app.wait(300);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('textarea[name=comments]').value = 'Shorten the title';
  buttonWith(sheet, 'Request changes').click();
  await app.wait(200);
  const asked = app.calls.filter((c) => c.method === 'POST' && c.path === '/tasks/2/qa').pop();
  assert.deepEqual([asked.body.result, asked.body.comments], ['changes_requested', 'Shorten the title']);
  await app.wait(100);

  // the task form offers SOPs and carries the QA flag over
  await app.go('#/tasks');
  buttonWith(app.main(), 'New task').click();
  await app.wait(300);
  sheet = document.querySelector('.sheet');
  const sopSelect = sheet.querySelector('select[name=sopId]');
  assert.deepEqual([...sopSelect.options].map((o) => o.textContent), ['No SOP', 'Page Optimization v1.1']);
  assert.equal(sheet.querySelector('input[name=qaRequired]').checked, false);
  sopSelect.value = '1';
  sopSelect.dispatchEvent(new app.window.Event('change'));
  assert.equal(sheet.querySelector('input[name=qaRequired]').checked, true);
  assert.ok(![...sheet.querySelectorAll('select[name=status] option')].some((o) => o.value === 'changes'));
  sheet.querySelector('input[name=title]').value = 'Follow the SOP';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const made = app.calls.filter((c) => c.method === 'POST' && c.path === '/tasks').pop();
  assert.deepEqual([made.body.sopId, made.body.qaRequired], [1, true]);
  await app.wait(100);

  // activity reads well
  await app.go('#/activity');
  assert.deepEqual(app.errors, []);
});
