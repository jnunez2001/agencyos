// Joshua Nunez
const path = require('path');
const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const auth = require('./services/auth');

const db = openDb(path.join(config.dataDir, 'agencyos.db'));
const app = createApp(db);

function housekeeping() {
  auth.pruneSessions(db);
  auth.pruneAttempts(db);
}
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

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
