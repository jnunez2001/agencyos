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
