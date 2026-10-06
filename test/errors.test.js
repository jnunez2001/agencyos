// Joshua Nunez
// What a person sees when something breaks on the server: a plain message and a 500, never a stack trace, a file
// path, SQL or database error text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setUp } = require('./support/http');
const clients = require('../server/services/clients');
const projects = require('../server/services/projects');

const LEAKS = /SQLITE|no such table|SqliteError|TypeError|Cannot read|at \w+.*\(.*\.js|node_modules|\/server\/|\.js:\d+|SELECT |FROM |secret-internal/i;

// Silences the expected log lines of these tests, and gives them back to check what was logged.
function quietLog() {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(' '));
  return { lines, restore: () => { console.error = original; } };
}

test('a database error reaches the person as a plain message with status 500', async () => {
  const app = await setUp();
  const log = quietLog();
  const prepare = app.db.prepare.bind(app.db);
  try {
    // fail any query on the projects table, the way a broken or locked database would
    app.db.prepare = (sql) => {
      if (/FROM projects p/.test(sql)) throw Object.assign(new Error('SQLITE_ERROR: no such table: main.projects (secret-internal)'), { code: 'SQLITE_ERROR', name: 'SqliteError' });
      return prepare(sql);
    };
    const res = await app.owner.call('GET', '/projects', undefined, { raw: true });
    assert.equal(res.res.status, 500);
    assert.deepEqual(res.data, { error: 'Something went wrong' });
    assert.doesNotMatch(JSON.stringify(res.data), LEAKS);
    // the same for a write that fails half way
    const write = await app.owner.call('POST', '/projects', { clientId: 1, name: 'X' });
    assert.ok([404, 500].includes(write.status));
    assert.doesNotMatch(JSON.stringify(write.data), LEAKS);
    assert.ok(log.lines.some((l) => /no such table/.test(l)), 'the detail is logged on the server for the owner of the machine');
  } finally { log.restore(); app.db.prepare = prepare; }
  assert.equal((await app.owner.call('GET', '/projects')).status, 200, 'and it works again once the database does');
  await app.close();
});

test('an unexpected exception reaches the person as a plain message with status 500', async () => {
  const app = await setUp();
  const log = quietLog();
  const original = clients.listClients;
  try {
    clients.listClients = () => { throw new TypeError("Cannot read properties of undefined (reading 'secret-internal')"); };
    const res = await app.owner.call('GET', '/clients', undefined, { raw: true });
    assert.equal(res.res.status, 500);
    assert.deepEqual(res.data, { error: 'Something went wrong' });
    assert.doesNotMatch(JSON.stringify(res.data), LEAKS);
    assert.equal(res.res.headers.get('content-type').startsWith('application/json'), true);
    // an exception inside an async handler (a rejected promise) is handled the same way
    const original2 = projects.createProject;
    projects.createProject = () => { throw new RangeError('secret-internal overflow at /server/services/projects.js:10:3'); };
    const post = await app.owner.call('POST', '/projects', { clientId: 1, name: 'X' });
    projects.createProject = original2;
    assert.equal(post.status, 500);
    assert.deepEqual(post.data, { error: 'Something went wrong' });
  } finally { clients.listClients = original; log.restore(); }
  await app.close();
});

test('a failure before the router runs, a bad body, a bad cookie and an unknown route are all plain too', async () => {
  const app = await setUp();
  const log = quietLog();
  try {
    const url = `${app.base}/clients`;
    const bad = await fetch(url.replace('/clients', '/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'Bad request' });
    const big = await fetch(url.replace('/clients', '/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'y'.repeat(30000) }) });
    assert.equal(big.status, 400);
    const cookie = await fetch(url, { headers: { cookie: 'agencyos_sid=%E0%A4%A' } });
    assert.equal(cookie.status, 401, 'a malformed cookie is just not signed in');
    assert.deepEqual(await cookie.json(), { error: 'Sign in required' });
    const unknown = await fetch(url.replace('/clients', '/nothing-here'), { headers: { cookie: 'x=1' } });
    assert.equal(unknown.status, 401);
    // a database failure while the session is looked up
    const prepare = app.db.prepare.bind(app.db);
    app.db.prepare = (sql) => { if (/FROM sessions/.test(sql)) throw new Error('SQLITE_BUSY: database is locked (secret-internal)'); return prepare(sql); };
    const res = await fetch(url, { headers: { cookie: 'agencyos_sid=abc' } });
    app.db.prepare = prepare;
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'Something went wrong' });
    assert.doesNotMatch(text, LEAKS);
  } finally { log.restore(); }
  await app.close();
});

test('the AI endpoint hides internals too: a failing tool says only that something went wrong', async () => {
  const app = await setUp();
  const log = quietLog();
  const key = (await app.owner.call('POST', '/api-keys', { name: 'k', access: 'read' })).data;
  const prepare = app.db.prepare.bind(app.db);
  try {
    app.db.prepare = (sql) => { if (/FROM clients c/.test(sql)) throw new Error('SQLITE_ERROR: no such column secret-internal'); return prepare(sql); };
    const res = await fetch(app.base.replace('/api', '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_clients', arguments: {} } }) });
    app.db.prepare = prepare;
    const body = await res.json();
    assert.equal(body.result.isError, true);
    assert.equal(body.result.content[0].text, 'Something went wrong');
    assert.doesNotMatch(JSON.stringify(body), LEAKS);
  } finally { app.db.prepare = prepare; log.restore(); }
  await app.close();
});
