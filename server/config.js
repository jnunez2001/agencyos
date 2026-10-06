// Joshua Nunez
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  root,
  port: Number(process.env.PORT || 3200),
  host: process.env.HOST || '127.0.0.1',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  // Force the Secure cookie flag. Otherwise it follows the request (behind a TLS proxy).
  cookieSecure: process.env.COOKIE_SECURE === '1',
  // The address people use to reach this server, such as https://agency.example.com. Used for the OAuth discovery
  // documents so they never depend on a request header. Empty means: work it out from the request (local use).
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // The Google service account key file (see deploy/set-google-key.sh). Empty means Google is not set up.
  googleKeyFile: process.env.GOOGLE_KEY_FILE || '',
  // The Google OAuth client (id and secret) for "Add Google account" (see deploy/set-google-oauth.sh).
  googleOAuthFile: process.env.GOOGLE_OAUTH_FILE || '',
  // When set, first-run setup also needs this code. Protects a fresh server that is already reachable online.
  setupToken: process.env.SETUP_TOKEN || '',
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  minPasswordLength: 10,
  login: {
    windowMinutes: 15,
    maxPerUsername: 5,
    maxPerIp: 30,
  },
};
