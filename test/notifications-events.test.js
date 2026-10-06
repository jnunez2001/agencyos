// Joshua Nunez
// Notifications for QA, rejected time, retainer limits, meeting reminders, SOP changes and decisions.
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const qa = require('../server/services/qa');
const time = require('../server/services/timeentries');
const retainers = require('../server/services/retainers');
const events = require('../server/services/events');
const sops = require('../server/services/sops');
const sopchanges = require('../server/services/sopchanges');
const decisions = require('../server/services/decisions');
const notifications = require('../server/services/notifications');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  for (const k of ['josh', 'rayne', 'mark', 'sarah', 'cole', 'zed']) f[k] = { ...f[k], today: '2026-10-20' };
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental', accountOwnerId: f.ids.rayne });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'Website', status: 'active' });
  return f;
}
const mine = (f, ctx, type) => notifications.listNotifications(f.db, ctx).filter((n) => !type || n.type === type);
const who = (f, type) => ['josh', 'rayne', 'mark', 'sarah', 'cole'].filter((k) => mine(f, f[k], type).length);

test('QA requested tells everyone who may review except the person who submitted, and folds', async () => {
  const f = await setup();
  const t = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Homepage', assigneeId: f.ids.sarah });
  tasks.updateTask(f.db, f.sarah, t.id, { status: 'review' });
  assert.deepEqual(who(f, 'qa_requested'), ['josh', 'rayne', 'mark']);
  const n = mine(f, f.mark, 'qa_requested')[0];
  assert.deepEqual([n.title, n.link], ['Waiting for QA: Homepage', '#/qa']);
  // a manager submitting does not tell themselves
  const t2 = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Footer', assigneeId: f.ids.mark });
  tasks.updateTask(f.db, f.mark, t2.id, { status: 'review' });
  assert.equal(mine(f, f.mark, 'qa_requested').length, 1);
  assert.equal(mine(f, f.josh, 'qa_requested').length, 2);
  // sent back and submitted again while the first is unread: folded
  qa.reviewTask(f.db, f.mark, t.id, { result: 'changes_requested', comments: 'Fix the title' });
  tasks.updateTask(f.db, f.sarah, t.id, { status: 'review' });
  assert.equal(mine(f, f.josh, 'qa_requested').filter((x) => x.title.includes('Homepage')).length, 1);
});

test('changes requested tells the assignee, with the comment, and never the reviewer', async () => {
  const f = await setup();
  const t = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Homepage', assigneeId: f.ids.sarah });
  tasks.updateTask(f.db, f.sarah, t.id, { status: 'review' });
  qa.reviewTask(f.db, f.mark, t.id, { result: 'changes_requested', comments: 'Fix the title' });
  const n = mine(f, f.sarah, 'qa_changes');
  assert.deepEqual(n.map((x) => [x.title, x.body, x.link]), [['Changes requested on Homepage', 'Fix the title', `#/projects/${f.project.id}`]]);
  assert.equal(mine(f, f.mark, 'qa_changes').length, 0);
  // approving is good news, not something to act on
  tasks.updateTask(f.db, f.sarah, t.id, { status: 'review' });
  qa.reviewTask(f.db, f.mark, t.id, { result: 'approved', checklist: [] });
  assert.equal(mine(f, f.sarah, 'qa_changes').length, 1);
});

test('rejected time tells the owner of the entry with the reason', async () => {
  const f = await setup();
  const e = time.createEntry(f.db, f.sarah, { clientId: f.client.id, minutes: 60, date: '2026-10-19', description: 'Work' });
  time.submitEntries(f.db, f.sarah, { ids: [e.id] });
  time.rejectEntry(f.db, f.mark, e.id, { note: 'Add detail' });
  const n = mine(f, f.sarah, 'time_rejected');
  assert.deepEqual(n.map((x) => [x.title, x.body, x.link]), [['Time rejected: 2026-10-19', 'Add detail', '#/time']]);
  assert.equal(mine(f, f.mark, 'time_rejected').length, 0);
  // approving does not notify
  time.submitEntries(f.db, f.sarah, { ids: [e.id] });
  time.approveEntry(f.db, f.mark, e.id);
  assert.equal(mine(f, f.sarah, 'time_rejected').length, 1);
});

test('retainer limits: once at 80 percent and once at 100 per period, to managers and the account owner, not the approver', async () => {
  const f = await setup();
  retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 10, startDate: '2026-10-01' });
  const approve = (minutes, date) => {
    const e = time.createEntry(f.db, f.sarah, { clientId: f.client.id, minutes, date });
    time.submitEntries(f.db, f.sarah, { ids: [e.id] });
    time.approveEntry(f.db, f.mark, e.id);
  };
  approve(420, '2026-10-05');
  assert.deepEqual(who(f, 'retainer_limit'), []);
  approve(60, '2026-10-06');
  assert.deepEqual(who(f, 'retainer_limit'), ['josh', 'rayne']);
  const n = mine(f, f.rayne, 'retainer_limit')[0];
  assert.deepEqual([n.title, n.link], ['Acme Dental has used 80 percent of its retainer', `#/clients/${f.client.id}`]);
  // read it, push a bit further: still the same level, so nothing new even after reading
  notifications.markAllRead(f.db, f.rayne);
  approve(30, '2026-10-07');
  assert.equal(mine(f, f.rayne, 'retainer_limit').length, 1);
  approve(120, '2026-10-08');
  assert.equal(mine(f, f.rayne, 'retainer_limit').length, 2);
  assert.match(mine(f, f.rayne, 'retainer_limit')[0].title, /all of its retainer/);
  assert.equal(mine(f, f.mark, 'retainer_limit').length, 0);
  assert.equal(mine(f, f.sarah, 'retainer_limit').length, 0);
});

test('retainer limits ignore non-billable time, old periods and clients without a retainer', async () => {
  const f = await setup();
  const approve = (extra) => {
    const e = time.createEntry(f.db, f.sarah, { clientId: f.client.id, minutes: 600, date: '2026-10-05', ...extra });
    time.submitEntries(f.db, f.sarah, { ids: [e.id] });
    time.approveEntry(f.db, f.mark, e.id);
  };
  approve({});
  retainers.saveRetainer(f.db, f.mark, f.client.id, { hoursAllocated: 10, startDate: '2026-10-01' });
  approve({ timeType: 'non_billable' });
  approve({ date: '2026-09-20' });
  assert.deepEqual(who(f, 'retainer_limit'), []);
});

test('meeting reminders: attendees of events in the next hour, once each', async () => {
  const f = await setup();
  const mk = (title, startsAt, extra = {}) => events.createEvent(f.db, f.mark, { title, startsAt, endsAt: startsAt.replace(/\d\d:00Z$/, (m) => `${String(Number(m.slice(0, 2)) + 1).padStart(2, '0')}:00Z`), type: 'client_meeting', attendees: [f.ids.sarah, f.ids.rayne], ...extra });
  const soon = mk('Kickoff', '2026-10-21T14:30:00Z');
  mk('Later', '2026-10-21T17:00:00Z');
  const cancelled = mk('Cancelled', '2026-10-21T14:45:00Z');
  events.updateEvent(f.db, f.mark, cancelled.id, { status: 'cancelled' });
  mk('Nobody', '2026-10-21T14:40:00Z', { attendees: [] });
  const now = new Date('2026-10-21T14:00:00Z');
  assert.equal(notifications.runReminders(f.db, now), 2);
  assert.deepEqual(who(f, 'event_soon'), ['rayne', 'sarah']);
  const n = mine(f, f.sarah, 'event_soon')[0];
  assert.deepEqual([n.title, n.body, n.link], ['Starting soon: Kickoff', 'Starts in 30 minutes', '#/calendar']);
  // running again, even after reading, adds nothing
  notifications.markAllRead(f.db, f.sarah);
  assert.equal(notifications.runReminders(f.db, new Date('2026-10-21T14:10:00Z')), 0);
  assert.equal(mine(f, f.sarah, 'event_soon').length, 1);
  // later, the next event comes into the hour
  assert.equal(notifications.runReminders(f.db, new Date('2026-10-21T16:30:00Z')), 2);
  assert.equal(mine(f, f.sarah, 'event_soon').length, 2);
  assert.ok(soon.id);
});

test('SOP changes: review needed tells managers, published tells people with open tasks on the SOP and the owner', async () => {
  const f = await setup();
  const sop = sops.createSop(f.db, f.mark, { title: 'Page Optimization', service: 'SEO', status: 'approved', ownerId: f.ids.rayne, steps: ['Research', 'Write'] });
  tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Open one', assigneeId: f.ids.sarah, sopId: sop.id });
  const done = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Closed one', assigneeId: f.ids.cole, sopId: sop.id });
  tasks.updateTask(f.db, f.mark, done.id, { status: 'done' });
  const c = sopchanges.createChange(f.db, f.sarah, { sopId: sop.id, title: 'Add a check', details: 'Needs a final check', status: 'needs_review' });
  assert.deepEqual(who(f, 'sopchange_review'), ['josh', 'rayne', 'mark']);
  assert.deepEqual(mine(f, f.mark, 'sopchange_review').map((n) => [n.title, n.link]), [['SOP change to review: Add a check', '#/sops/changes']]);
  // moving an identified one into review tells them too; moving it again while unread folds
  const d = sopchanges.createChange(f.db, f.sarah, { sopId: sop.id, title: 'Second', details: 'Another' });
  assert.equal(mine(f, f.josh, 'sopchange_review').length, 1);
  sopchanges.updateChange(f.db, f.sarah, d.id, { status: 'needs_review' });
  assert.equal(mine(f, f.josh, 'sopchange_review').length, 2);
  sopchanges.updateChange(f.db, f.mark, c.id, { status: 'approved' });
  sopchanges.publishChange(f.db, f.mark, c.id, { content: { steps: ['Research', 'Write', 'Check'] } });
  assert.deepEqual(who(f, 'sop_published'), ['rayne', 'sarah']);
  const n = mine(f, f.sarah, 'sop_published')[0];
  assert.deepEqual([n.title, n.link], ['SOP updated: Page Optimization', `#/sops/${sop.id}`]);
  assert.equal(mine(f, f.cole, 'sop_published').length, 0);
});

test('decisions tell the client account owner when made or reversed, never the actor', async () => {
  const f = await setup();
  const d = decisions.createDecision(f.db, f.mark, { title: 'Use WordPress', decidedOn: '2026-10-20', clientId: f.client.id });
  assert.deepEqual(mine(f, f.rayne, 'decision_made').map((n) => [n.title, n.link]), [['Decision made: Use WordPress', '#/meetings/decisions']]);
  decisions.updateDecision(f.db, f.mark, d.id, { status: 'reversed' });
  assert.equal(mine(f, f.rayne, 'decision_reversed').length, 1);
  decisions.updateDecision(f.db, f.mark, d.id, { status: 'active' });
  decisions.updateDecision(f.db, f.mark, d.id, { status: 'reversed' });
  assert.equal(mine(f, f.rayne, 'decision_reversed').length, 1, 'folds while unread');
  // the account owner deciding does not tell themselves; no client means nobody to tell
  decisions.createDecision(f.db, f.rayne, { title: 'Own call', decidedOn: '2026-10-20', clientId: f.client.id });
  decisions.createDecision(f.db, f.mark, { title: 'Internal', decidedOn: '2026-10-20' });
  assert.equal(mine(f, f.rayne).filter((n) => n.title.includes('Own call') || n.title.includes('Internal')).length, 0);
  assert.equal(who(f, 'decision_made').join(), 'rayne');
});
