// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const sops = require('../server/services/sops');
const sopchanges = require('../server/services/sopchanges');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');
const tasks = require('../server/services/tasks');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

async function setup() {
  const f = await fixture();
  f.sop = sops.createSop(f.db, f.mark, { title: 'Page Optimization', service: 'SEO', status: 'approved', purpose: 'Rank the page', steps: ['Research', 'Write'], checklist: ['Title ok'] });
  f.client = clients.createClient(f.db, f.mark, { name: 'Acme Dental' });
  f.project = projects.createProject(f.db, f.mark, { clientId: f.client.id, name: 'New website' });
  f.task = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Homepage copy', sopId: f.sop.id, assigneeId: f.ids.cole });
  return f;
}
const raise = (f, ctx = f.sarah, over = {}) => sopchanges.createChange(f.db, ctx, { sopId: f.sop.id, title: 'Add a speed check', details: 'Pages are slow and nobody checks', ...over });
const CONTENT = { steps: ['Research', 'Write', 'Check the page speed'] };
const approve = (f, id) => sopchanges.updateChange(f.db, f.mark, id, { status: 'approved' });

test('anyone but a Contractor raises a change request; it starts as identified with normal priority', async () => {
  const f = await setup();
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) {
    const c = raise(f, ctx);
    assert.deepEqual([c.status, c.priority, c.sopTitle, c.hasProposedContent, c.publishedVersion], ['identified', 'normal', 'Page Optimization', false, null]);
  }
  const c = raise(f, f.sarah, { status: 'needs_review', priority: 'high', proposedText: 'Check speed first', proposedContent: CONTENT, sourceType: 'task', sourceId: f.task.id });
  assert.deepEqual([c.status, c.priority, c.sourceType, c.sourceId, c.proposedContent], ['needs_review', 'high', 'task', f.task.id, CONTENT]);
  assert.equal(sopchanges.getChange(f.db, f.mark, c.id).sourceTitle, 'Homepage copy');
  assert.equal(sopchanges.getChange(f.db, f.sarah, c.id).sourceTitle, null); // titles of sources are for managers
});

test('input is checked', async () => {
  const f = await setup();
  assert.throws(() => raise(f, f.sarah, { title: ' ' }), /title/i);
  assert.throws(() => raise(f, f.sarah, { details: '' }), /what should change/i);
  assert.throws(() => raise(f, f.sarah, { priority: 'asap' }), /priority/i);
  assert.throws(() => raise(f, f.sarah, { status: 'approved' }), /identified or needs_review/);
  assert.throws(() => raise(f, f.sarah, { status: 'nope' }), /status/i);
  assert.throws(() => raise(f, f.sarah, { sopId: 99999 }), /not found/i);
  assert.throws(() => raise(f, f.sarah, { sourceType: 'video', sourceId: 1 }), /source/i);
  assert.throws(() => raise(f, f.sarah, { sourceType: 'task', sourceId: 99999 }), /source was not found/i);
  assert.throws(() => raise(f, f.sarah, { sourceType: 'task' }), /source|where/i);
  assert.throws(() => raise(f, f.sarah, { proposedContent: 'text' }), /object/i);
  assert.throws(() => raise(f, f.sarah, { proposedContent: { steps: 'x' } }), /steps/i);
});

test('a Contractor raises one only on an SOP of their own task, and sees only their own', async () => {
  const f = await setup();
  const mine = sopchanges.createChange(f.db, f.cole, { sopId: f.sop.id, title: 'Step is unclear', details: 'Step two confuses me', sourceType: 'task', sourceId: f.task.id });
  assert.equal(mine.status, 'identified');
  assert.throws(() => sopchanges.createChange(f.db, f.cole, { sopId: f.sop.id, title: 'x', details: 'y' }), /task of yours/i);
  const other = sops.createSop(f.db, f.mark, { title: 'Other', status: 'approved' });
  assert.throws(() => sopchanges.createChange(f.db, f.cole, { sopId: other.id, title: 'x', details: 'y' }), /one of your tasks/i);
  const t2 = tasks.createTask(f.db, f.mark, { projectId: f.project.id, title: 'Not cole', sopId: f.sop.id, assigneeId: f.ids.sarah });
  assert.throws(() => sopchanges.createChange(f.db, f.cole, { sopId: f.sop.id, title: 'x', details: 'y', sourceType: 'task', sourceId: t2.id }), /task of yours/i);
  raise(f, f.sarah); // someone else's
  assert.deepEqual(sopchanges.listChanges(f.db, f.cole).map((c) => c.id), [mine.id]);
  assert.throws(() => sopchanges.getChange(f.db, f.cole, 2), /not found/i);
  assert.equal(sopchanges.listChanges(f.db, f.sarah).length, 2);
  assert.deepEqual(sopchanges.listChanges(f.db, f.sarah, { mine: '1' }).map((c) => c.createdByName), ['Sarah']);
  assert.throws(() => sopchanges.updateChange(f.db, f.cole, 2, { title: 'x' }), /not found/i);
  assert.equal(sopchanges.updateChange(f.db, f.cole, mine.id, { title: 'Step two is unclear' }).title, 'Step two is unclear');
  assert.throws(() => sopchanges.publishChange(f.db, f.cole, mine.id), /not allowed/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.cole, mine.id, { status: 'approved' }), /manager/i);
});

test('staff cannot see or raise changes on a draft SOP unless they raised them; managers see everything', async () => {
  const f = await setup();
  const draft = sops.createSop(f.db, f.mark, { title: 'Secret draft' });
  assert.throws(() => sopchanges.createChange(f.db, f.sarah, { sopId: draft.id, title: 'x', details: 'y' }), /not found/i);
  const c = sopchanges.createChange(f.db, f.mark, { sopId: draft.id, title: 'On the draft', details: 'y' });
  assert.equal(sopchanges.listChanges(f.db, f.sarah).length, 0);
  assert.throws(() => sopchanges.getChange(f.db, f.sarah, c.id), /not found/i);
  assert.equal(sopchanges.listChanges(f.db, f.josh).length, 1);
});

test('isolation: another agency never sees, changes or publishes them', async () => {
  const f = await setup();
  const c = raise(f);
  assert.deepEqual(sopchanges.listChanges(f.db, f.zed), []);
  assert.throws(() => sopchanges.getChange(f.db, f.zed, c.id), /not found/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.zed, c.id, { title: 'x' }), /not found/i);
  assert.throws(() => sopchanges.publishChange(f.db, f.zed, c.id, { content: CONTENT }), /not found/i);
  assert.throws(() => sopchanges.createChange(f.db, f.zed, { sopId: f.sop.id, title: 'x', details: 'y' }), /not found/i);
  assert.throws(() => raise(f, f.sarah, { sourceType: 'task', sourceId: tasks.createTask(f.db, f.zed, { projectId: projects.createProject(f.db, f.zed, { clientId: clients.createClient(f.db, f.zed, { name: 'Z' }).id, name: 'ZP' }).id, title: 'Z task' }).id }), /source was not found/i);
});

test('the person who raised it edits it until review ends; a manager moves it through review', async () => {
  const f = await setup();
  const c = raise(f, f.sarah);
  assert.equal(sopchanges.updateChange(f.db, f.sarah, c.id, { details: 'Better words', status: 'needs_review' }).status, 'needs_review');
  assert.throws(() => sopchanges.updateChange(f.db, f.sarah, c.id, { status: 'approved' }), /manager/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.sarah, c.id, { status: 'published' }), /publish/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.sarah, 999, {}), /not found/i);
  const other = raise(f, f.josh);
  assert.throws(() => sopchanges.updateChange(f.db, f.sarah, other.id, { title: 'x' }), /not allowed/i);
  assert.equal(approve(f, c.id).status, 'approved');
  assert.equal(sopchanges.getChange(f.db, f.mark, c.id).reviewedByName, 'Mark');
  assert.throws(() => sopchanges.updateChange(f.db, f.sarah, c.id, { title: 'late' }), /not allowed/i); // approved: only managers
  for (const s of ['in_progress', 'testing', 'approved', 'needs_review']) assert.equal(sopchanges.updateChange(f.db, f.mark, c.id, { status: s }).status, s);
});

test('rejecting needs a reason, records it, and reopening clears it', async () => {
  const f = await setup();
  const c = raise(f);
  assert.throws(() => sopchanges.updateChange(f.db, f.mark, c.id, { status: 'rejected' }), /why/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.mark, c.id, { status: 'rejected', rejectedReason: '  ' }), /why/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.mark, c.id, { rejectedReason: 'because' }), /only for a rejected/i);
  const r = sopchanges.updateChange(f.db, f.mark, c.id, { status: 'rejected', rejectedReason: 'Already covered by step 2' });
  assert.deepEqual([r.status, r.rejectedReason, r.reviewedByName], ['rejected', 'Already covered by step 2', 'Mark']);
  assert.throws(() => sopchanges.publishChange(f.db, f.mark, c.id, { content: CONTENT }), /approve/i);
  assert.equal(sopchanges.updateChange(f.db, f.mark, c.id, { status: 'needs_review' }).rejectedReason, '');
});

test('publishing adds a NEW SOP version, leaves the old one intact and records which version it made', async () => {
  const f = await setup();
  const c = raise(f, f.sarah, { proposedContent: CONTENT });
  assert.throws(() => sopchanges.publishChange(f.db, f.mark, c.id), /approve/i); // not approved yet
  approve(f, c.id);
  assert.equal(sopchanges.getChange(f.db, f.mark, c.id).canPublish, true);
  const before = sops.getSop(f.db, f.mark, f.sop.id);
  assert.equal(before.version, '1.0');
  const p = sopchanges.publishChange(f.db, f.mark, c.id, { changeNote: 'Speed check added' });
  assert.deepEqual([p.status, p.publishedVersion, p.publishedByName, p.canPublish], ['published', '1.1', 'Mark', false]);
  const after = sops.getSop(f.db, f.mark, f.sop.id);
  assert.deepEqual(after.versions.map((v) => [v.label, v.changeNote]), [['1.1', 'Speed check added'], ['1.0', 'First version']]);
  assert.deepEqual(after.content.steps, CONTENT.steps);
  assert.equal(after.content.purpose, 'Rank the page'); // what was not sent carries over
  const old = sops.getVersion(f.db, f.mark, f.sop.id, before.versions[0].id);
  assert.deepEqual(old.content.steps, ['Research', 'Write']); // the old version is untouched
  assert.equal(p.publishedVersionId, after.versions[0].id);
  assert.throws(() => sopchanges.publishChange(f.db, f.mark, c.id), /already published/i);
  assert.throws(() => sopchanges.updateChange(f.db, f.mark, c.id, { title: 'x' }), /published/i);
  const log = listActivity(f.db, f.josh).filter((r) => r.action === 'sopchange.publish');
  assert.deepEqual(log[0].after, { status: 'published', sopId: f.sop.id, version: '1.1' });
});

test('tasks pinned to the old version are unaffected by a publish', async () => {
  const f = await setup();
  const c = raise(f, f.sarah, { proposedContent: CONTENT });
  approve(f, c.id);
  sopchanges.publishChange(f.db, f.mark, c.id, { major: true });
  const t = tasks.getTask(f.db, f.mark, f.task.id);
  assert.equal(t.sop.version, '1.0');
  assert.deepEqual([t.sop.latestVersion, t.sop.isLatest, t.sop.content.steps], ['2.0', false, ['Research', 'Write']]);
});

test('content can be added at publish time, and with none there is nothing to publish', async () => {
  const f = await setup();
  const c = raise(f);
  approve(f, c.id);
  assert.throws(() => sopchanges.publishChange(f.db, f.mark, c.id), /new version content/i);
  assert.equal(sopchanges.getChange(f.db, f.mark, c.id).status, 'approved'); // nothing changed
  assert.equal(sops.getSop(f.db, f.mark, f.sop.id).versions.length, 1);
  assert.throws(() => sopchanges.publishChange(f.db, f.mark, c.id, { content: { steps: ['Research', 'Write'] } }), /nothing changed/i);
  assert.equal(sopchanges.getChange(f.db, f.mark, c.id).status, 'approved'); // the failed publish rolled back
  const p = sopchanges.publishChange(f.db, f.mark, c.id, { content: { examples: 'See Acme' } });
  assert.deepEqual([p.status, p.publishedVersion], ['published', '1.1']);
  assert.equal(sops.getSop(f.db, f.mark, f.sop.id).versions[0].changeNote, `Change request #${c.id}: Add a speed check`);
});

test('only a manager can publish', async () => {
  const f = await setup();
  const c = raise(f, f.sarah, { proposedContent: CONTENT });
  approve(f, c.id);
  assert.throws(() => sopchanges.publishChange(f.db, f.sarah, c.id), /not allowed/i);
  assert.throws(() => sopchanges.publishChange(f.db, f.cole, c.id), /not allowed/i);
  assert.equal(sopchanges.publishChange(f.db, f.josh, c.id).status, 'published');
});

test('an AI can raise and edit drafts but never decide, start, test or publish', async () => {
  const f = await setup();
  const ai = { ...f.mark, source: 'ai' };
  const c = sopchanges.createChange(f.db, ai, { sopId: f.sop.id, title: 'AI idea', details: 'Seen in the QA notes', proposedContent: CONTENT });
  assert.equal(c.status, 'identified');
  assert.equal(sopchanges.updateChange(f.db, ai, c.id, { status: 'needs_review', priority: 'urgent' }).status, 'needs_review');
  for (const status of ['approved', 'rejected', 'in_progress', 'testing', 'published']) {
    assert.throws(() => sopchanges.updateChange(f.db, ai, c.id, { status, rejectedReason: 'x' }), /only a person/i);
    assert.throws(() => sopchanges.createChange(f.db, ai, { sopId: f.sop.id, title: 'x', details: 'y', status }), /only a person/i);
  }
  approve(f, c.id);
  assert.throws(() => sopchanges.publishChange(f.db, ai, c.id), /only a person/i);
  assert.throws(() => sopchanges.updateChange(f.db, ai, c.id, { title: 'sneaky' }), /only a person/i);
  assert.equal(sopchanges.getChange(f.db, f.mark, c.id).status, 'approved');
  assert.equal(sops.getSop(f.db, f.mark, f.sop.id).versions.length, 1);
});

test('the activity log records only what changed, in the same step as the change', async () => {
  const f = await setup();
  const c = raise(f, f.sarah, { sourceType: 'task', sourceId: f.task.id });
  sopchanges.updateChange(f.db, f.mark, c.id, { status: 'needs_review', priority: 'high' });
  sopchanges.updateChange(f.db, f.mark, c.id, { priority: 'high' }); // no change, no row
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'sop_change_request').reverse();
  assert.deepEqual(rows.map((r) => r.action), ['sopchange.create', 'sopchange.update']);
  assert.deepEqual(rows[0].after, { title: 'Add a speed check', sopId: f.sop.id, status: 'identified', priority: 'normal', source: `task ${f.task.id}` });
  assert.deepEqual([rows[1].before, rows[1].after], [{ status: 'identified', priority: 'normal' }, { status: 'needs_review', priority: 'high' }]);
});

test('lists filter by status, SOP, priority and text, with open and urgent first', async () => {
  const f = await setup();
  const a = raise(f, f.sarah, { title: 'Alpha', priority: 'low' });
  const b = raise(f, f.sarah, { title: 'Bravo', priority: 'urgent' });
  const c = raise(f, f.sarah, { title: 'Charlie' });
  sopchanges.updateChange(f.db, f.mark, a.id, { status: 'rejected', rejectedReason: 'no' });
  assert.deepEqual(sopchanges.listChanges(f.db, f.mark).map((x) => x.title), ['Bravo', 'Charlie', 'Alpha']);
  assert.deepEqual(sopchanges.listChanges(f.db, f.mark, { status: 'rejected' }).map((x) => x.title), ['Alpha']);
  assert.deepEqual(sopchanges.listChanges(f.db, f.mark, { priority: 'urgent' }).map((x) => x.id), [b.id]);
  assert.deepEqual(sopchanges.listChanges(f.db, f.mark, { q: 'harl' }).map((x) => x.id), [c.id]);
  assert.equal(sopchanges.listChanges(f.db, f.mark, { sopId: f.sop.id }).length, 3);
  assert.equal(sopchanges.listChanges(f.db, f.mark, { sopId: 99999 }).length, 0);
  assert.throws(() => sopchanges.listChanges(f.db, f.mark, { status: 'bogus' }), /status/i);
});
