// Joshua Nunez
// Front-end smoke test as the Owner for SOP change requests: the panel, the list, every sheet, and the QA shortcut.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const buttonWith = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const closeSheet = async (app) => { app.document.querySelector('.sheet button[aria-label=Close]').click(); await app.wait(100); };

test('the Owner can raise, read, decide and publish SOP change requests', async () => {
  const app = await openApp('owner');
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const clean = (where) => assert.equal(strayText(document.body), null, `${where} has stray text: ${strayText(document.body)}`);

  // SOP page panel and button
  await app.go('#/sops/1');
  let text = app.main().textContent;
  for (const part of ['Change requests', 'Add a speed check', 'Needs review', 'Reword step two', 'Published']) assert.ok(text.includes(part), part);
  assert.ok(buttonWith(app.main(), 'Raise change request'));
  clean('sop page with changes');

  // raise one
  buttonWith(app.main(), 'Raise change request').click();
  await app.wait(150);
  let sheet = document.querySelector('.sheet');
  clean('raise form');
  sheet.querySelector('input[name=title]').value = 'Mention page speed';
  sheet.querySelector('textarea[name=details]').value = 'Add a check';
  sheet.querySelector('select[name=priority]').value = 'high';
  sheet.querySelector('input[name=needsReview]').checked = true;
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const raised = app.calls.find((c) => c.method === 'POST' && c.path === '/sop-changes');
  assert.deepEqual([raised.body.sopId, raised.body.title, raised.body.priority, raised.body.status, raised.csrf], [1, 'Mention page speed', 'high', 'needs_review', 'csrf-token']);
  await app.wait(100);

  // read one and approve it
  buttonWith(app.main(), 'Add a speed check').click();
  await app.wait(200);
  sheet = document.querySelector('.sheet');
  for (const part of ['Needs review', 'Raised by', 'Task: Homepage copy', 'What should change and why', 'Check the page speed']) assert.ok(sheet.textContent.includes(part), part);
  clean('change sheet');
  buttonWith(sheet, 'Approve').click();
  await app.wait(200);
  const approved = app.calls.find((c) => c.method === 'PATCH' && c.path === '/sop-changes/1');
  assert.equal(approved.body.status, 'approved');
  await app.wait(100);

  // reject needs a reason box first
  buttonWith(app.main(), 'Add a speed check').click();
  await app.wait(200);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('textarea[name=rejectedReason]').closest('.stack').hidden, true);
  buttonWith(sheet, 'Reject').click();
  sheet.querySelector('textarea[name=rejectedReason]').value = 'Duplicate';
  buttonWith(sheet, 'Confirm reject').click();
  await app.wait(200);
  const rejected = app.calls.filter((c) => c.method === 'PATCH' && c.path === '/sop-changes/1').pop();
  assert.deepEqual([rejected.body.status, rejected.body.rejectedReason], ['rejected', 'Duplicate']);
  await app.wait(100);

  // publish the approved one with content written in the sheet
  buttonWith(app.main(), 'Reword step two').click();
  await app.wait(250);
  sheet = document.querySelector('.sheet');
  buttonWith(sheet, 'Publish').click();
  await app.wait(300);
  sheet = document.querySelector('.sheet');
  assert.match(sheet.textContent, /Tasks already using it keep it/);
  assert.equal(sheet.querySelector('textarea[name=steps]').value, 'Research\nWrite');
  clean('publish sheet');
  sheet.querySelector('textarea[name=steps]').value = 'Research\nWrite\nCheck speed';
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const published = app.calls.find((c) => c.method === 'POST' && c.path === '/sop-changes/2/publish');
  assert.deepEqual([published.body.content.steps, published.body.major, published.csrf], [['Research', 'Write', 'Check speed'], false, 'csrf-token']);
  await app.wait(100);

  // the list from the SOPs page, with filters
  await app.go('#/sops');
  const link = [...app.main().querySelectorAll('a')].find((a) => a.textContent.includes('Change requests'));
  assert.equal(link.getAttribute('href'), '#/sops/changes');
  await app.go('#/sops/changes');
  text = app.main().textContent;
  assert.match(text, /SOP change requests/);
  assert.match(text, /Add a speed check/);
  assert.doesNotMatch(text, /Older fix/); // open by default
  clean('change list');
  buttonWith(app.main(), 'Published').click();
  await app.wait(150);
  assert.match(app.main().textContent, /Older fix/);
  assert.match(app.main().textContent, /published as v1\.1/);
  assert.doesNotMatch(app.main().textContent, /Add a speed check/);
  buttonWith(app.main(), 'All').click();
  await app.wait(150);
  assert.match(app.main().textContent, /Older fix/);

  // the QA review sheet offers a shortcut when the task follows an SOP
  await app.go('#/qa');
  buttonWith(app.main(), 'Logo options').click();
  await app.wait(300);
  sheet = document.querySelector('.sheet');
  sheet.querySelector('textarea[name=comments]').value = 'The title step is too vague';
  buttonWith(sheet, 'Raise SOP change request').click();
  await app.wait(200);
  sheet = document.querySelector('.sheet');
  assert.equal(sheet.querySelector('textarea[name=details]').value, 'The title step is too vague');
  assert.match(sheet.textContent, /linked to the QA review/);
  sheet.querySelector('form').requestSubmit();
  await app.wait(200);
  const fromQa = app.calls.filter((c) => c.method === 'POST' && c.path === '/sop-changes').pop();
  assert.deepEqual([fromQa.body.sourceType, fromQa.body.sourceId, fromQa.body.sopId], ['qa_review', 5, 1]);

  assert.deepEqual(app.errors, []);
});
