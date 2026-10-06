// Joshua Nunez
const path = require('path');
const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const auth = require('./services/auth');
const oauth = require('./services/oauth');
const googlesync = require('./services/googlesync');
const { loadGoogle } = require('./google');

const db = openDb(path.join(config.dataDir, 'agencyos.db'));
const google = loadGoogle(config.googleKeyFile);
const app = createApp(db, { google });

function housekeeping() {
  auth.pruneSessions(db);
  auth.pruneAttempts(db);
  oauth.prune(db);
}
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

// Google numbers are refreshed in the background: a first look shortly after start, then every half hour (a link
// is only synced when it has not been for most of a day).
if (google) {
  const tick = () => googlesync.syncDue(db, google).catch((err) => console.error('Google sync failed', err.message));
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 30 * 60 * 1000).unref();
  console.log(`Google is set up (${google.email})`);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`AgencyOS listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
