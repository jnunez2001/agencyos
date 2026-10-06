// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

test('a client with nothing lately says so, and a task made by hand says it came from nowhere', async () => {
  const app = await openApp('owner', { quiet: true });
  await import('../public/js/app.js');
  await app.wait(250);
  await app.go('#/clients/1');
  assert.match(app.main().querySelector('.activity-panel').textContent, /Nothing has happened for this client in the last 7 days\./);
  assert.equal(strayText(app.document.body), null);
  await app.go('#/tasks');
  [...app.document.querySelectorAll('.task-row')][2].click(); // Sitemap, made by hand
  await app.wait(250);
  assert.match(app.document.querySelector('.sheet .trace-block').textContent, /Made directly\. It does not link back to a request or a meeting\./);
  assert.deepEqual(app.errors, []);
});
