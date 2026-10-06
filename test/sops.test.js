// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const sops = require('../server/services/sops');
const { updateMember } = require('../server/services/members');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

const CONTENT = {
  title: 'Service Page Optimization', service: 'SEO', requiresQa: true,
  purpose: 'Make a service page rank', whenToUse: 'A page is live but not ranking', inputs: 'URL, target keyword',
  steps: ['Check the keyword', 'Rewrite the title', 'Add internal links'],
  checklist: ['Title under 60 characters', 'One H1', 'Internal links added'],
  expectedOutput: 'An updated page', commonMistakes: 'Keyword stuffing', examples: 'See Acme Dental',
};
const make = (f, ctx = f.mark, over = {}) => sops.createSop(f.db, ctx, { ...CONTENT, ...over });

test('a Manager writes an SOP; it starts as a draft with version 1.0 and every field kept', async () => {
  const f = await fixture();
  const s = make(f);
  assert.deepEqual([s.title, s.service, s.status, s.requiresQa, s.version], ['Service Page Optimization', 'SEO', 'draft', true, '1.0']);
  const full = sops.getSop(f.db, f.mark, s.id);
  assert.deepEqual(full.content.steps, CONTENT.steps);
  assert.deepEqual(full.content.checklist, CONTENT.checklist);
  assert.deepEqual([full.content.purpose, full.content.whenToUse, full.content.inputs, full.content.expectedOutput, full.content.commonMistakes, full.content.examples], [CONTENT.purpose, CONTENT.whenToUse, CONTENT.inputs, CONTENT.expectedOutput, CONTENT.commonMistakes, CONTENT.examples]);
  assert.equal(full.versions.length, 1);
  assert.equal(full.versions[0].label, '1.0');
});

test('input is checked', async () => {
  const f = await fixture();
  assert.throws(() => make(f, f.mark, { title: ' ' }), /title/i);
  assert.throws(() => make(f, f.mark, { status: 'live' }), /status/i);
  assert.throws(() => make(f, f.mark, { steps: 'not a list' }), /steps/i);
  assert.throws(() => make(f, f.mark, { steps: [''] }), /step/i);
  assert.throws(() => make(f, f.mark, { steps: Array(51).fill('x') }), /50/);
  assert.throws(() => make(f, f.mark, { checklist: Array(31).fill('x') }), /30/);
  assert.throws(() => make(f, f.mark, { steps: ['x'.repeat(501)] }), /500/);
  assert.throws(() => make(f, f.mark, { ownerId: f.ids.zed }), /team member/i);
  assert.equal(make(f, f.mark, { steps: [], checklist: [] }).version, '1.0');
});

test('who may see and change SOPs', async () => {
  const f = await fixture();
  const draft = make(f, f.mark);
  const live = make(f, f.mark, { title: 'Live one', status: 'approved' });
  for (const ctx of [f.josh, f.rayne, f.mark]) assert.equal(sops.listSops(f.db, ctx).length, 2);
  assert.deepEqual(sops.listSops(f.db, f.sarah).map((s) => s.title), ['Live one']); // no drafts for staff
  assert.throws(() => sops.getSop(f.db, f.sarah, draft.id), /not found/i);
  assert.equal(sops.getSop(f.db, f.sarah, live.id).title, 'Live one');
  assert.throws(() => sops.listSops(f.db, f.cole), /not allowed/i);
  assert.throws(() => sops.getSop(f.db, f.cole, live.id), /not allowed/i);
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => make(f, ctx), /not allowed/i);
    assert.throws(() => sops.updateSop(f.db, ctx, live.id, { title: 'x' }), /not allowed/i);
    assert.throws(() => sops.addVersion(f.db, ctx, live.id, { purpose: 'x' }), /not allowed/i);
  }
});

test('editing adds a version and never overwrites; old versions stay readable', async () => {
  const f = await fixture();
  const s = make(f);
  const v11 = sops.addVersion(f.db, f.mark, s.id, { steps: ['Check the keyword', 'Rewrite the title', 'Add internal links', 'Check the page speed'], changeNote: 'Added a speed step' });
  assert.equal(v11.version, '1.1');
  const major = sops.addVersion(f.db, f.mark, s.id, { purpose: 'A new purpose', major: true, changeNote: 'Rewrite' });
  assert.equal(major.version, '2.0');
  assert.equal(sops.addVersion(f.db, f.mark, s.id, { examples: 'More examples' }).version, '2.1');
  const full = sops.getSop(f.db, f.mark, s.id);
  assert.deepEqual(full.versions.map((v) => v.label), ['2.1', '2.0', '1.1', '1.0']);
  assert.equal(full.content.purpose, 'A new purpose');
  assert.equal(full.content.steps.length, 4); // fields not sent carry over
  assert.deepEqual(full.versions.map((v) => v.changeNote), ['', 'Rewrite', 'Added a speed step', 'First version']);
  const old = sops.getVersion(f.db, f.mark, s.id, full.versions[3].id);
  assert.deepEqual([old.label, old.content.steps.length, old.content.purpose], ['1.0', 3, CONTENT.purpose]);
  assert.throws(() => sops.addVersion(f.db, f.mark, s.id, { purpose: 'A new purpose' }), /nothing changed/i);
  assert.throws(() => sops.addVersion(f.db, f.mark, s.id, {}), /nothing changed/i);
  assert.throws(() => sops.getVersion(f.db, f.mark, s.id, 99999), /not found/i);
  const other = make(f, f.mark, { title: 'Other' });
  assert.throws(() => sops.getVersion(f.db, f.mark, other.id, full.versions[3].id), /not found/i);
});

test('status, owner and the QA flag change without a new version', async () => {
  const f = await fixture();
  const s = make(f);
  const u = sops.updateSop(f.db, f.mark, s.id, { status: 'testing', ownerId: f.ids.rayne, requiresQa: false, service: 'Local SEO' });
  assert.deepEqual([u.status, u.ownerName, u.requiresQa, u.service, u.version], ['testing', 'Rayne', false, 'Local SEO', '1.0']);
  assert.equal(sops.updateSop(f.db, f.mark, s.id, { status: 'approved' }).status, 'approved');
  assert.equal(sops.updateSop(f.db, f.mark, s.id, { status: 'deprecated' }).status, 'deprecated');
  assert.throws(() => sops.updateSop(f.db, f.mark, s.id, { status: 'x' }), /status/i);
  assert.throws(() => sops.updateSop(f.db, f.mark, s.id, { ownerId: f.ids.zed }), /team member/i);
  assert.throws(() => sops.updateSop(f.db, f.mark, s.id, { title: '' }), /title/i);
});

test('only a person can approve an SOP: an AI may draft and test but never approve', async () => {
  const f = await fixture();
  const ai = { ...f.josh, source: 'ai' };
  const s = sops.createSop(f.db, ai, { ...CONTENT, status: 'testing' });
  assert.equal(s.status, 'testing');
  assert.throws(() => sops.createSop(f.db, ai, { ...CONTENT, title: 'B', status: 'approved' }), /person/i);
  assert.throws(() => sops.updateSop(f.db, ai, s.id, { status: 'approved' }), /person/i);
  assert.equal(sops.updateSop(f.db, f.josh, s.id, { status: 'approved' }).status, 'approved');
  assert.equal(sops.addVersion(f.db, ai, s.id, { purpose: 'AI edit' }).version, '1.1');
});

test('listing filters by status, service and text', async () => {
  const f = await fixture();
  make(f, f.mark, { title: 'Alpha', service: 'SEO', status: 'approved', purpose: 'rank pages' });
  make(f, f.mark, { title: 'Beta', service: 'Web', status: 'testing', purpose: 'build forms' });
  make(f, f.mark, { title: 'Gamma', service: 'SEO' });
  const names = (q) => sops.listSops(f.db, f.mark, q).map((s) => s.title).sort();
  assert.deepEqual(names({ status: 'approved' }), ['Alpha']);
  assert.deepEqual(names({ service: 'SEO' }), ['Alpha', 'Gamma']);
  assert.deepEqual(names({ q: 'forms' }), ['Beta']);
  assert.deepEqual(names({ q: 'ALPHA' }), ['Alpha']);
  assert.deepEqual(names({ q: '%' }), []);
  assert.throws(() => sops.listSops(f.db, f.mark, { status: 'x' }), /status/i);
});

test('another agency sees nothing of it and cannot change it', async () => {
  const f = await fixture();
  const s = make(f);
  const v = sops.getSop(f.db, f.mark, s.id).versions[0];
  assert.deepEqual(sops.listSops(f.db, f.zed), []);
  assert.throws(() => sops.getSop(f.db, f.zed, s.id), /not found/i);
  assert.throws(() => sops.updateSop(f.db, f.zed, s.id, { title: 'hack' }), /not found/i);
  assert.throws(() => sops.addVersion(f.db, f.zed, s.id, { purpose: 'hack' }), /not found/i);
  assert.throws(() => sops.getVersion(f.db, f.zed, s.id, v.id), /not found/i);
  assert.equal(sops.createSop(f.db, f.zed, { ...CONTENT }).version, '1.0'); // same title is fine elsewhere
});

test('the activity log records create, changes and new versions', async () => {
  const f = await fixture();
  const s = make(f);
  sops.updateSop(f.db, f.mark, s.id, { status: 'testing', title: CONTENT.title });
  sops.addVersion(f.db, f.mark, s.id, { purpose: 'New', changeNote: 'Reworded' });
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'sop');
  assert.deepEqual(rows.map((r) => r.action), ['sop.version', 'sop.update', 'sop.create']);
  assert.deepEqual([rows[1].before, rows[1].after], [{ status: 'draft' }, { status: 'testing' }]);
  assert.deepEqual(rows[0].after, { version: '1.1', changeNote: 'Reworded' });
});

test('a deactivated owner can still be shown on an old SOP, but cannot be chosen again', async () => {
  const f = await fixture();
  const s = make(f, f.mark, { ownerId: f.ids.sarah });
  updateMember(f.db, f.josh, f.ids.sarah, { isActive: false });
  assert.equal(sops.getSop(f.db, f.mark, s.id).ownerName, 'Sarah');
  assert.throws(() => make(f, f.mark, { title: 'N', ownerId: f.ids.sarah }), /team member/i);
});
