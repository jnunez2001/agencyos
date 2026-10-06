// Joshua Nunez
const path = require('path');
const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const auth = require('./services/auth');
const oauth = require('./services/oauth');
const googlesync = require('./services/googlesync');
const notifications = require('./services/notifications');
const { loadGoogle } = require('./google');
const { createHub, loadOAuthApp } = require('./googlehub');

const db = openDb(path.join(config.dataDir, 'agencyos.db'));
// Every Google credential: the service account key file, and the accounts people have signed in with.
const google = createHub({ db, serviceClient: loadGoogle(config.googleKeyFile), oauthApp: loadOAuthApp(config.googleOAuthFile), keyFile: path.join(config.dataDir, 'google-token.key') });
const app = createApp(db, { google });

function housekeeping() {
  auth.pruneSessions(db);
  auth.pruneAttempts(db);
  oauth.prune(db);
  notifications.prune(db);
}

// The daily digest: checked every half hour, sent once per person per day (the notification itself remembers).
const digest = () => { try { notifications.runDigests(db); } catch (err) { console.error('Digest failed', err.message); } };
setTimeout(digest, 60 * 1000).unref();
setInterval(digest, 30 * 60 * 1000).unref();
housekeeping();
setInterval(housekeeping, 60 * 60 * 1000).unref();

// Google numbers are refreshed in the background: a first look shortly after start, then every half hour (a link
// is only synced when it has not been for most of a day).
if (google.serviceConfigured || google.oauthConfigured) {
  const tick = () => googlesync.syncDue(db, google).catch((err) => console.error('Google sync failed', err.message));
  setTimeout(tick, 2 * 60 * 1000).unref();
  setInterval(tick, 30 * 60 * 1000).unref();
  console.log(`Google is set up (${google.serviceConfigured ? `service account ${google.serviceEmail}` : 'sign in with Google'})`);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`Nexus listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
