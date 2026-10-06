// Joshua Nunez
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'database', 'migrations');

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // A migration that rebuilds a table marks itself, so foreign keys are paused while it runs
    // (SQLite's documented procedure) and checked again afterwards.
    const rebuild = /^--\s*agencyos:rebuild/m.test(sql);
    if (rebuild) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        if (rebuild && db.pragma('foreign_key_check').length > 0) throw new Error(`Migration ${file} left broken references`);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      })();
    } finally {
      if (rebuild) db.pragma('foreign_keys = ON');
    }
  }
}

// filename ':memory:' is used by tests.
function openDb(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

module.exports = { openDb, migrate };
