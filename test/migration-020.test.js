// Joshua Nunez
// Migration 020 only adds columns. This proves rows from the previous schema survive it with sensible defaults.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('../server/db');

test('migration 020 keeps notes, decisions, requests and follow-ups and fills the new fields', () => {
  const dir = path.resolve(__dirname, '..', 'database', 'migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().filter((x) => x < '020')) {
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  db.exec(`
    INSERT INTO organizations (id, name) VALUES (1, 'A');
    INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'josh', 'Josh', 'x');
    INSERT INTO clients (id, organization_id, name) VALUES (1, 1, 'Acme');
    INSERT INTO meeting_notes (id, organization_id, title, meeting_date, summary) VALUES (1, 1, 'Kickoff', '2026-10-01', 'Good call');
    INSERT INTO decisions (id, organization_id, client_id, title, decided_on) VALUES (1, 1, 1, 'Use WordPress', '2026-10-01');
    INSERT INTO client_requests (id, organization_id, client_id, title, created_at) VALUES (1, 1, 1, 'Add booking', '2026-10-03T10:00:00.000Z');
    INSERT INTO follow_ups (id, organization_id, client_id, title) VALUES (1, 1, 1, 'Send quote');
  `);
  migrate(db);
  assert.deepEqual(db.prepare('SELECT title, summary, purpose, risks, important_context AS ic, sop_impact AS si, next_meeting AS nm FROM meeting_notes').get(), { title: 'Kickoff', summary: 'Good call', purpose: '', risks: '', ic: '', si: '', nm: '' });
  assert.deepEqual(db.prepare('SELECT title, people_involved AS p FROM decisions').get(), { title: 'Use WordPress', p: '' });
  assert.deepEqual(db.prepare('SELECT title, priority, source, received_on AS r FROM client_requests').get(), { title: 'Add booking', priority: 'normal', source: '', r: '2026-10-03' });
  assert.deepEqual(db.prepare('SELECT title, priority, request_id AS r, task_id AS t FROM follow_ups').get(), { title: 'Send quote', priority: 'normal', r: null, t: null });
  assert.throws(() => db.prepare("UPDATE client_requests SET priority = 'bogus'").run());
  assert.throws(() => db.prepare("UPDATE follow_ups SET request_id = 99").run());
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
