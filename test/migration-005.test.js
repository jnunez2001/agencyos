// Joshua Nunez
// The tasks table is rebuilt in migration 005. This proves real data from the previous schema survives it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('../server/db');

test('migration 005 keeps every task, comment and link from the previous schema', () => {
  const dir = path.resolve(__dirname, '..', 'database', 'migrations');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // bring the database to the state of migration 004, exactly as the runner would have
  db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().filter((x) => x < '005')) {
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(f);
  }
  db.exec(`
    INSERT INTO organizations (id, name) VALUES (1, 'A'), (2, 'B');
    INSERT INTO users (id, username, display_name, password_hash) VALUES (1, 'josh', 'Josh', 'x');
    INSERT INTO clients (id, organization_id, name) VALUES (1, 1, 'Acme'), (2, 2, 'Other');
    INSERT INTO projects (id, organization_id, client_id, name) VALUES (1, 1, 1, 'Site'), (2, 2, 2, 'Z');
    INSERT INTO tasks (id, organization_id, project_id, title, status, priority, assignee_id, due_date, estimate_hours, completed_at, description)
      VALUES (1, 1, 1, 'One', 'todo', 'high', 1, '2026-10-12', 3.5, NULL, 'desc'),
             (2, 1, 1, 'Two', 'done', 'low', NULL, NULL, NULL, '2026-10-01T00:00:00.000Z', ''),
             (3, 2, 2, 'Three', 'review', 'normal', NULL, NULL, NULL, NULL, '');
    INSERT INTO task_comments (organization_id, task_id, author_id, body) VALUES (1, 1, 1, 'hello');
  `);
  migrate(db);

  const tasks = db.prepare('SELECT id, organization_id AS org, title, status, priority, assignee_id AS assignee, due_date AS due, estimate_hours AS hours, completed_at AS done, description, sop_id, sop_version_id, qa_required FROM tasks ORDER BY id').all();
  assert.deepEqual(tasks, [
    { id: 1, org: 1, title: 'One', status: 'todo', priority: 'high', assignee: 1, due: '2026-10-12', hours: 3.5, done: null, description: 'desc', sop_id: null, sop_version_id: null, qa_required: 0 },
    { id: 2, org: 1, title: 'Two', status: 'done', priority: 'low', assignee: null, due: null, hours: null, done: '2026-10-01T00:00:00.000Z', description: '', sop_id: null, sop_version_id: null, qa_required: 0 },
    { id: 3, org: 2, title: 'Three', status: 'review', priority: 'normal', assignee: null, due: null, hours: null, done: null, description: '', sop_id: null, sop_version_id: null, qa_required: 0 },
  ]);
  assert.equal(db.prepare('SELECT body FROM task_comments WHERE task_id = 1').get().body, 'hello');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  // the new status is allowed, a made-up one is not
  db.prepare("UPDATE tasks SET status = 'changes' WHERE id = 1").run();
  assert.throws(() => db.prepare("UPDATE tasks SET status = 'bogus' WHERE id = 1").run());
  // deleting a project still removes its tasks and their comments
  db.prepare('DELETE FROM projects WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE organization_id = 1').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM task_comments').get().n, 0);
  // the indexes came back
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'").all().map((r) => r.name);
  for (const n of ['idx_tasks_org', 'idx_tasks_project', 'idx_tasks_assignee', 'idx_tasks_sop']) assert.ok(idx.includes(n), n);
});
