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
