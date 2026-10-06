// Joshua Nunez
// Consistent online backup of the SQLite database, keeping the newest N copies.
// Run directly (node scripts/backup.js) or require it and call backup().
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../server/config');

async function backup({ dataDir = config.dataDir, backupDir = path.join(dataDir, 'backups'), keep = 30, now = new Date() } = {}) {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `agencyos-${stamp}.db`);
  const db = new Database(path.join(dataDir, 'agencyos.db'), { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  fs.chmodSync(target, 0o600);
  const old = fs.readdirSync(backupDir).filter((f) => /^agencyos-.*\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) fs.unlinkSync(path.join(backupDir, f));
  return target;
}

module.exports = { backup };

if (require.main === module) {
  backup({ keep: Number(process.env.BACKUP_KEEP || 30), backupDir: process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : undefined })
    .then((target) => console.log(`Backup written: ${target}`))
    .catch((err) => { console.error(err); process.exit(1); });
}
