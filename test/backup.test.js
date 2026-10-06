// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDb } = require('../server/db');
const orgs = require('../server/services/organizations');
const { backup } = require('../scripts/backup');

async function makeData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-backup-'));
  const db = openDb(path.join(dir, 'agencyos.db'));
  await orgs.createOrganization(db, { organizationName: 'Whalls Agency', displayName: 'Josh', username: 'josh', password: 'correct horse battery' });
  return { dir, db };
}

test('a backup is a complete, private copy that opens and holds the data', async () => {
  const { dir, db } = await makeData();
  const file = await backup({ dataDir: dir });
  db.close();
  assert.match(path.basename(file), /^agencyos-.*\.db$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const copy = new Database(file, { readonly: true });
  assert.equal(copy.prepare('SELECT name FROM organizations').get().name, 'Whalls Agency');
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  copy.close();
});

test('only the newest copies are kept', async () => {
  const { dir, db } = await makeData();
  for (let i = 1; i <= 5; i++) await backup({ dataDir: dir, keep: 3, now: new Date(Date.UTC(2026, 9, i)) });
  db.close();
  const files = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.equal(files.length, 3);
  assert.match(files[0], /2026-10-03/);
  assert.match(files[2], /2026-10-05/);
});

test('a missing database is an error, not an empty backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-nodb-'));
  await assert.rejects(() => backup({ dataDir: dir }));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'backups')), []);
});
