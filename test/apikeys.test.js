// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const keys = require('../server/services/apikeys');
const { updateMember } = require('../server/services/members');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

test('an Owner or Admin creates a key; the token is shown once and only a hash is stored', async () => {
  const f = await fixture();
  const k = keys.createKey(f.db, f.josh, { name: 'Claude on my Mac', access: 'propose' });
  assert.match(k.token, /^aos_[A-Za-z0-9_-]{32,}$/);
  assert.equal(k.access, 'propose');
  assert.equal(k.prefix, k.token.slice(0, 8));
  const stored = f.db.prepare('SELECT token_hash FROM api_keys WHERE id = ?').get(k.id).token_hash;
  assert.notEqual(stored, k.token);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM api_keys').all()).includes(k.token));
  const listed = keys.listKeys(f.db, f.josh);
  assert.equal(listed.length, 1);
  assert.ok(!('token' in listed[0]) && !('tokenHash' in listed[0]));
  assert.deepEqual([listed[0].name, listed[0].ownerName, listed[0].lastUsedAt, listed[0].revoked], ['Claude on my Mac', 'Josh', null, false]);
  assert.ok(keys.createKey(f.db, f.rayne, { name: 'Rayne key', access: 'read' }).token);
});

test('every role can make a personal key; access and name are checked', async () => {
  const f = await fixture();
  for (const ctx of [f.mark, f.sarah, f.cole]) {
    const k = keys.createKey(f.db, ctx, { name: 'mine', access: 'propose' });
    assert.equal(keys.authenticate(f.db, k.token).actor.id, ctx.actor.id);
  }
  assert.throws(() => keys.createKey(f.db, f.josh, { name: ' ', access: 'read' }), /name/i);
  assert.throws(() => keys.createKey(f.db, f.josh, { name: 'x', access: 'god' }), /access/i);
});

test('a person sees and changes only their own keys; Owner and Admin see all', async () => {
  const f = await fixture();
  const mine = keys.createKey(f.db, f.sarah, { name: 'sarah key', access: 'read' });
  const his = keys.createKey(f.db, f.mark, { name: 'mark key', access: 'read' });
  assert.deepEqual(keys.listKeys(f.db, f.sarah).map((k) => k.name), ['sarah key']);
  assert.deepEqual(keys.listKeys(f.db, f.josh).map((k) => k.name).sort(), ['mark key', 'sarah key']);
  assert.deepEqual(keys.listKeys(f.db, f.rayne).length, 2);
  assert.throws(() => keys.updateKey(f.db, f.sarah, his.id, { access: 'direct' }), /not found/i);
  assert.throws(() => keys.revokeKey(f.db, f.sarah, his.id), /not found/i);
  assert.equal(keys.updateKey(f.db, f.sarah, mine.id, { access: 'propose' }).access, 'propose');
  keys.revokeKey(f.db, f.rayne, mine.id); // an Admin may revoke anyone's
  assert.equal(keys.authenticate(f.db, mine.token), null);
  assert.ok(keys.authenticate(f.db, his.token));
});

test('a key authenticates as its person, with the live role, and records last use', async () => {
  const f = await fixture();
  const k = keys.createKey(f.db, f.rayne, { name: 'r', access: 'direct' });
  const a = keys.authenticate(f.db, k.token);
  assert.deepEqual([a.organizationId, a.actor.id, a.actor.role, a.access, a.keyId], [f.orgId, f.ids.rayne, 'admin', 'direct', k.id]);
  assert.ok(keys.listKeys(f.db, f.josh)[0].lastUsedAt);
  updateMember(f.db, f.josh, f.ids.rayne, { role: 'manager' });
  assert.equal(keys.authenticate(f.db, k.token).actor.role, 'manager');
});

test('unknown, malformed, revoked keys and deactivated people do not authenticate', async () => {
  const f = await fixture();
  const k = keys.createKey(f.db, f.rayne, { name: 'r', access: 'read' });
  for (const bad of [undefined, '', 'nope', 'aos_' + 'x'.repeat(40), k.token.slice(0, -1) + (k.token.endsWith('a') ? 'b' : 'a')]) assert.equal(keys.authenticate(f.db, bad), null);
  updateMember(f.db, f.josh, f.ids.rayne, { isActive: false });
  assert.equal(keys.authenticate(f.db, k.token), null);
  updateMember(f.db, f.josh, f.ids.rayne, { isActive: true });
  assert.ok(keys.authenticate(f.db, k.token));
  keys.revokeKey(f.db, f.josh, k.id);
  assert.equal(keys.authenticate(f.db, k.token), null);
  assert.equal(keys.listKeys(f.db, f.josh)[0].revoked, true);
});

test('access can be changed and a key can be revoked, only inside the same agency', async () => {
  const f = await fixture();
  const k = keys.createKey(f.db, f.josh, { name: 'k', access: 'read' });
  assert.equal(keys.updateKey(f.db, f.rayne, k.id, { access: 'propose' }).access, 'propose');
  assert.throws(() => keys.updateKey(f.db, f.mark, k.id, { access: 'direct' }), /not found/i);
  assert.throws(() => keys.updateKey(f.db, f.zed, k.id, { access: 'direct' }), /not found/i);
  assert.throws(() => keys.revokeKey(f.db, f.zed, k.id), /not found/i);
  assert.deepEqual(keys.listKeys(f.db, f.zed), []);
  assert.equal(keys.authenticate(f.db, keys.createKey(f.db, f.zed, { name: 'z', access: 'read' }).token).organizationId, f.otherOrgId);
});

test('key changes are logged and never contain the token', async () => {
  const f = await fixture();
  const k = keys.createKey(f.db, f.josh, { name: 'k', access: 'read' });
  keys.updateKey(f.db, f.josh, k.id, { access: 'direct' });
  keys.revokeKey(f.db, f.josh, k.id);
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'api_key');
  assert.deepEqual(rows.map((r) => r.action), ['apikey.revoke', 'apikey.update', 'apikey.create']);
  assert.ok(!JSON.stringify(rows).includes(k.token));
  assert.deepEqual([rows[1].before, rows[1].after], [{ access: 'read' }, { access: 'direct' }]);
});
