// Joshua Nunez
// Migration 006 rebuilds the clients table. This proves real data from the previous schema survives it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('../server/db');

test('migration 006 keeps every client, contact, project and task from the previous schema', () => {
  const dir = path.resolve(__dirname, '..', 'database', 'migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().filter((x) => x < '006')) {
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  db.exec(`
    INSERT INTO organizations (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'josh', 'Josh', 'x');
    INSERT INTO clients (id, organization_id, name, status, website, industry, notes, created_by)
      VALUES (1, 1, 'Acme', 'active', 'https://acme.example', 'Dental', 'Prefers email', 1), (2, 1, 'Beta', 'paused', '', '', '', NULL), (3, 2, 'Acme', 'archived', '', '', '', NULL);
    INSERT INTO client_contacts (organization_id, client_id, name, email, is_primary) VALUES (1, 1, 'Dr. Lee', 'lee@acme.example', 1);
    INSERT INTO projects (id, organization_id, client_id, name, status) VALUES (1, 1, 1, 'Site', 'active'), (2, 2, 3, 'Z', 'planning');
    INSERT INTO tasks (id, organization_id, project_id, title) VALUES (1, 1, 1, 'One'), (2, 2, 2, 'Two');
  `);
  migrate(db);

  const clients = db.prepare('SELECT id, organization_id AS org, name, status, website, industry, notes, created_by AS by, account_owner_id AS owner, start_date AS start FROM clients ORDER BY id').all();
  assert.deepEqual(clients, [
    { id: 1, org: 1, name: 'Acme', status: 'active', website: 'https://acme.example', industry: 'Dental', notes: 'Prefers email', by: 1, owner: null, start: null },
    { id: 2, org: 1, name: 'Beta', status: 'paused', website: '', industry: '', notes: '', by: null, owner: null, start: null },
    { id: 3, org: 2, name: 'Acme', status: 'archived', website: '', industry: '', notes: '', by: null, owner: null, start: null },
  ]);
  assert.equal(db.prepare('SELECT name FROM client_contacts WHERE client_id = 1').get().name, 'Dr. Lee');
  assert.deepEqual(db.prepare('SELECT id, client_id, service_id, goal_id FROM projects ORDER BY id').all(), [{ id: 1, client_id: 1, service_id: null, goal_id: null }, { id: 2, client_id: 3, service_id: null, goal_id: null }]);
  assert.deepEqual(db.prepare('SELECT id, goal_id FROM tasks ORDER BY id').all(), [{ id: 1, goal_id: null }, { id: 2, goal_id: null }]);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  // the new statuses work, a made-up one does not, and names stay unique per agency ignoring case
  for (const s of ['lead', 'onboarding', 'at_risk', 'completed']) db.prepare('UPDATE clients SET status = ? WHERE id = 2').run(s);
  assert.throws(() => db.prepare("UPDATE clients SET status = 'bogus' WHERE id = 2").run());
  assert.throws(() => db.prepare("INSERT INTO clients (organization_id, name) VALUES (1, 'ACME')").run());
  db.prepare("INSERT INTO clients (organization_id, name) VALUES (2, 'Other')").run();
  // deleting a client still removes its contacts and projects
  db.prepare('DELETE FROM clients WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM client_contacts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects WHERE organization_id = 1').get().n, 0);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_clients_org'").get());
});
