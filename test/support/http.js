// Joshua Nunez
const assert = require('node:assert/strict');
const { openDb } = require('../../server/db');
const { createApp } = require('../../server/app');

const PASSWORD = 'correct horse battery';

// A running app on a free port, with a tiny client that keeps the session cookie and the CSRF token.
async function boot(options = {}) {
  const db = openDb(':memory:');
  const google = typeof options.google === 'function' ? options.google(db) : options.google; // a function gets the database
  const server = await new Promise((resolve) => { const s = createApp(db, { ...options, google }).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const client = () => {
    let cookie = '';
    let csrf = '';
    const call = async (method, path, body, { csrfToken = csrf, raw = false } = {}) => {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set && set.startsWith('agencyos_sid=')) cookie = set.split(';')[0];
      const data = await res.json().catch(() => null);
      return raw ? { res, data } : { status: res.status, data };
    };
    // A plain request with this session's cookie, without following redirects (for the Google callback).
    const raw = (method, path, extraCookie = '') => fetch(base + path, { method, redirect: 'manual', headers: cookie || extraCookie ? { cookie: [cookie, extraCookie].filter(Boolean).join('; ') } : {} });
    return {
      call, raw,
      async signIn(username, password = PASSWORD) { const r = await call('POST', '/login', { username, password }); const s = await call('GET', '/session'); csrf = s.data && s.data.csrf; return r; },
    };
  };
  return { db, base, client, close: () => new Promise((r) => server.close(r)) };
}

async function setUp(options = {}) {
  const app = await boot(options);
  const owner = app.client();
  assert.equal((await owner.call('POST', '/setup', { organizationName: 'Whalls Agency', displayName: 'Josh', username: 'josh', password: PASSWORD })).status, 200);
  await owner.signIn('josh');
  for (const [username, displayName, role] of [['rayne', 'Rayne', 'admin'], ['mark', 'Mark', 'manager'], ['sarah', 'Sarah', 'employee'], ['cole', 'Cole', 'contractor']]) {
    const r = await owner.call('POST', '/members', { username, displayName, role, password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  // team members have already changed their temporary password in these tests
  app.db.prepare('UPDATE users SET must_change_password = 0').run();
  return { ...app, owner };
}

module.exports = { boot, setUp, PASSWORD };
