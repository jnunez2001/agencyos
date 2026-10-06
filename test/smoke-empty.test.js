// Joshua Nunez
// Front-end smoke test as the Owner for empty lists: each main list says what to do next, and a filter that matches nothing says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, strayText } = require('./support/browser');

const NO_MATCH = 'Nothing matches these filters.';
const chip = (root, text) => [...root.querySelectorAll('button.chip')].find((b) => b.textContent.trim() === text);

test('every main list has a friendly empty state, and filters have their own message', async () => {
  const empty = new Set();
  const app = await openApp('owner', {
    respond: (method, path) => {
      if (method !== 'GET') return undefined;
      const base = path.split('?')[0];
      if (!empty.has(base)) return undefined;
      return base === '/calendar' ? { from: '2026-10-01', to: '2026-10-31', events: [], deadlines: [] } : [];
    },
  });
  await import('../public/js/app.js');
  await app.wait(250);
  const { document } = app;
  const says = async (hash, message) => {
    await app.go(hash);
    const text = app.main().textContent;
    assert.ok(text.includes(message), `${hash} should say "${message}" but says "${text.slice(0, 200)}"`);
    assert.equal(strayText(document.body), null, `${hash} has stray text`);
  };
  for (const p of ['/clients', '/projects', '/tasks', '/calendar', '/requests', '/decisions', '/follow-ups', '/meeting-notes', '/time-entries', '/sops', '/reports', '/qa', '/members', '/activity']) empty.add(p);

  await says('#/clients', 'No clients yet. Add your first client to start organizing agency work.');
  await says('#/projects', 'No projects yet. Create a project from a client.');
  await says('#/tasks', 'No tasks yet. Create your first task.');
  await says('#/requests', 'No open requests. Add one here, or write them in a meeting note and choose Create records.');
  chip(app.main(), 'All').click();
  await app.wait(150);
  assert.match(app.main().textContent, /No requests yet\. Add one here/);
  await says('#/meetings/decisions', 'No decisions yet. Add one here, or write them in a meeting note and choose Create records.');
  await says('#/meetings/follow-ups', 'No open follow-ups. Add one here, or write them in a meeting note and choose Create records.');
  await says('#/meetings', 'No meeting notes yet. Open an event on the calendar and choose Add meeting notes.');
  await says('#/time', 'No time logged this week. Start a timer or choose Add time.');
  await says('#/sops', 'No approved SOPs yet. Create your first SOP to write down how work gets done.');
  await says('#/reports', 'No reports yet. Generate one from a client page, or choose New report.');
  await says('#/qa', 'Nothing is waiting for review. Tasks appear here when someone submits them for QA.');
  await says('#/team', 'No team members yet. Add the first person.');
  await says('#/activity', 'No activity yet. Changes made in NexusOS show up here.');

  // the calendar: a day and an agenda with nothing in them
  await app.go('#/calendar');
  for (const view of ['Day', 'Agenda']) {
    chip(app.main(), view).click();
    await app.wait(200);
    assert.ok(app.main().textContent.includes('No meetings scheduled.'), view);
  }

  // filters that match nothing: the lists have records, or the filter is on
  empty.clear();
  empty.add('/tasks');
  await app.go('#/tasks');
  chip(app.main(), 'Overdue').click();
  await app.wait(200);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'tasks with a filter');
  chip(app.main(), 'Overdue').click(); // off again
  await app.wait(200);
  assert.ok(app.main().textContent.includes('No tasks yet. Create your first task.'), 'tasks with no filter');

  await app.go('#/clients');
  chip(app.main(), 'Past').click(); // the two clients are active and paused
  await app.wait(150);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'clients');
  await app.go('#/projects');
  chip(app.main(), 'Completed').click();
  await app.wait(150);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'projects');

  empty.clear();
  for (const p of ['/requests', '/reports', '/activity', '/sops', '/meeting-notes']) empty.add(p);
  await app.go('#/requests');
  const pick = app.main().querySelector('select[aria-label=Client]');
  pick.value = '1';
  pick.dispatchEvent(new app.window.Event('change'));
  await app.wait(200);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'requests');
  await app.go('#/reports');
  chip(app.main(), 'Drafts').click();
  await app.wait(150);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'reports');
  await app.go('#/sops');
  chip(app.main(), 'Draft').click();
  await app.wait(150);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'sops');
  await app.go('#/meetings');
  chip(app.main(), 'Final').click();
  await app.wait(150);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'meeting notes');
  await app.go('#/activity');
  const who = app.main().querySelector('select[aria-label=Person]');
  who.value = '1';
  who.dispatchEvent(new app.window.Event('change'));
  await app.wait(200);
  assert.ok(app.main().textContent.includes(NO_MATCH), 'activity');
  assert.equal(strayText(document.body), null);
  assert.deepEqual(app.errors, []);
});
