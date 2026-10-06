// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const clients = require('../server/services/clients');
const { listActivity } = require('../server/services/activity');
const { fixture } = require('./fixture');

const make = (f, ctx = f.mark, over = {}) => clients.createClient(f.db, ctx, { name: 'Acme Dental', website: 'https://acme.example', industry: 'Dental', ...over });

test('a Manager can add a client, and it starts active', async () => {
  const f = await fixture();
  const c = make(f);
  assert.deepEqual([c.name, c.status, c.website, c.industry], ['Acme Dental', 'active', 'https://acme.example', 'Dental']);
  assert.deepEqual(clients.listClients(f.db, f.mark).map((x) => x.name), ['Acme Dental']);
});

test('who may see and manage clients', async () => {
  const f = await fixture();
  const c = make(f, f.josh);
  for (const ctx of [f.josh, f.rayne, f.mark, f.sarah]) assert.equal(clients.listClients(f.db, ctx).length, 1);
  assert.throws(() => clients.listClients(f.db, f.cole), /not allowed/i);
  assert.throws(() => clients.getClient(f.db, f.cole, c.id), /not allowed/i);
  for (const ctx of [f.sarah, f.cole]) {
    assert.throws(() => make(f, ctx, { name: 'Nope' }), /not allowed/i);
    assert.throws(() => clients.updateClient(f.db, ctx, c.id, { notes: 'x' }), /not allowed/i);
    assert.throws(() => clients.addContact(f.db, ctx, c.id, { name: 'X' }), /not allowed/i);
  }
});

test('a client name must be given and is unique within the agency, ignoring case', async () => {
  const f = await fixture();
  assert.throws(() => make(f, f.mark, { name: '   ' }), /name/i);
  make(f);
  assert.throws(() => make(f, f.mark, { name: 'acme dental' }), /already/i);
  // another agency may use the same name
  assert.equal(clients.createClient(f.db, f.zed, { name: 'Acme Dental' }).name, 'Acme Dental');
});

test('status and website are checked', async () => {
  const f = await fixture();
  assert.throws(() => make(f, f.mark, { status: 'gone' }), /status/i);
  const c = make(f);
  assert.throws(() => clients.updateClient(f.db, f.mark, c.id, { status: 'nope' }), /status/i);
  assert.equal(clients.updateClient(f.db, f.mark, c.id, { status: 'paused' }).status, 'paused');
});

test('another agency cannot see, change or list a client, and gets not found', async () => {
  const f = await fixture();
  const c = make(f);
  assert.deepEqual(clients.listClients(f.db, f.zed), []);
  assert.throws(() => clients.getClient(f.db, f.zed, c.id), /not found/i);
  assert.throws(() => clients.updateClient(f.db, f.zed, c.id, { notes: 'hack' }), /not found/i);
  assert.throws(() => clients.addContact(f.db, f.zed, c.id, { name: 'Spy' }), /not found/i);
  assert.equal(clients.getClient(f.db, f.mark, c.id).notes, '');
});

test('listing filters by status and hides nothing the viewer may see', async () => {
  const f = await fixture();
  make(f, f.mark, { name: 'A' });
  const b = make(f, f.mark, { name: 'B' });
  clients.updateClient(f.db, f.mark, b.id, { status: 'archived' });
  assert.deepEqual(clients.listClients(f.db, f.mark, { status: 'active' }).map((x) => x.name), ['A']);
  assert.deepEqual(clients.listClients(f.db, f.mark, { status: 'archived' }).map((x) => x.name), ['B']);
  assert.equal(clients.listClients(f.db, f.mark).length, 2);
  assert.throws(() => clients.listClients(f.db, f.mark, { status: 'x' }), /status/i);
});

test('contacts: add, change, delete, and only one primary', async () => {
  const f = await fixture();
  const c = make(f);
  const a = clients.addContact(f.db, f.mark, c.id, { name: 'Dr. Lee', email: 'lee@acme.example', isPrimary: true });
  const b = clients.addContact(f.db, f.mark, c.id, { name: 'Front desk', phone: '555 0100' });
  assert.equal(a.isPrimary, true);
  assert.equal(b.isPrimary, false);
  clients.updateContact(f.db, f.mark, b.id, { isPrimary: true });
  const detail = clients.getClient(f.db, f.sarah, c.id);
  assert.deepEqual(detail.contacts.map((x) => [x.name, x.isPrimary]), [['Dr. Lee', false], ['Front desk', true]]);
  assert.throws(() => clients.addContact(f.db, f.mark, c.id, { name: 'X', email: 'not an email' }), /email/i);
  clients.deleteContact(f.db, f.mark, a.id);
  assert.equal(clients.getClient(f.db, f.mark, c.id).contacts.length, 1);
  assert.throws(() => clients.deleteContact(f.db, f.zed, b.id), /not found/i);
  assert.throws(() => clients.updateContact(f.db, f.zed, b.id, { name: 'x' }), /not found/i);
});

test('changes write activity rows with only the changed fields', async () => {
  const f = await fixture();
  const c = make(f);
  clients.updateClient(f.db, f.mark, c.id, { status: 'paused', industry: 'Dental' });
  clients.updateClient(f.db, f.mark, c.id, { status: 'paused' }); // nothing changed, nothing logged
  const rows = listActivity(f.db, f.josh).filter((r) => r.objectType === 'client');
  assert.deepEqual(rows.map((r) => r.action), ['client.update', 'client.create']);
  assert.deepEqual(rows[0].before, { status: 'active' });
  assert.deepEqual(rows[0].after, { status: 'paused' });
  assert.equal(rows[1].actorName, 'Mark');
  assert.equal(listActivity(f.db, f.zed).filter((r) => r.objectType === 'client').length, 0);
});
