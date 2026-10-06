// Joshua Nunez
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setUp } = require('./support/http');

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

function oauth(app) {
  const origin = app.base.replace('/api', '');
  const form = (body) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const register = async (body) => {
    const res = await fetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const newClient = async (redirect = CLAUDE_CALLBACK) => (await register({ client_name: 'Claude', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' })).data;
  const pkce = () => { const verifier = b64(crypto.randomBytes(32)); return { verifier, challenge: b64(crypto.createHash('sha256').update(verifier).digest()) }; };
  const authorizeUrl = (client, p, extra = {}) => {
    const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], code_challenge: p.challenge, code_challenge_method: 'S256', state: 'xyz', ...extra });
    return `${origin}/oauth/authorize?${q}`;
  };
  const authorize = (url) => fetch(url, { redirect: 'manual' });
  const token = async (body) => { const res = await fetch(`${origin}/oauth/token`, form(body)); return { status: res.status, data: await res.json() }; };
  const mcpCall = async (accessToken, method = 'ping') => {
    const res = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) });
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  };
  // The whole sign-in as the Owner: authorize, approve in the app, get the code.
  const connect = async (client, p, { access = 'propose', who = app.owner } = {}) => {
    const res = await authorize(authorizeUrl(client, p));
    assert.equal(res.status, 302);
    const id = new URL(res.headers.get('location'), origin).hash.replace('#/connect/', '');
    const approved = await who.call('POST', `/oauth/requests/${id}/approve`, { access });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const redirect = new URL(approved.data.redirectUrl);
    return { id, redirect, code: redirect.searchParams.get('code') };
  };
  const exchange = (client, code, p, extra = {}) => token({ grant_type: 'authorization_code', code, redirect_uri: client.redirect_uris[0], client_id: client.client_id, code_verifier: p.verifier, ...extra });
  return { origin, register, newClient, pkce, authorizeUrl, authorize, token, mcpCall, connect, exchange };
}

test('a call without a token is answered with a pointer to the discovery documents', async () => {
  const app = await setUp();
  const o = oauth(app);
  const res = await o.mcpCall('aos_' + 'x'.repeat(32));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), `Bearer resource_metadata="${o.origin}/.well-known/oauth-protected-resource"`);
  const none = await fetch(`${o.origin}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate'), /resource_metadata=/);
  await app.close();
});

test('discovery documents describe the resource and the authorization server', async () => {
  const app = await setUp();
  const o = oauth(app);
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const meta = await (await fetch(o.origin + p)).json();
    assert.equal(meta.resource, `${o.origin}/mcp`);
    assert.deepEqual(meta.authorization_servers, [o.origin]);
  }
  const as = await (await fetch(`${o.origin}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, o.origin);
  assert.equal(as.authorization_endpoint, `${o.origin}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${o.origin}/oauth/token`);
  assert.equal(as.registration_endpoint, `${o.origin}/oauth/register`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.ok(as.token_endpoint_auth_methods_supported.includes('none'));
  assert.deepEqual(as.response_types_supported, ['code']);
  assert.ok(as.grant_types_supported.includes('authorization_code') && as.grant_types_supported.includes('refresh_token'));
  await app.close();
});

test('registration accepts only Claude redirect addresses', async () => {
  const app = await setUp();
  const o = oauth(app);
  const ok = await o.register({ client_name: 'Claude', redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'none' });
  assert.equal(ok.status, 201);
  assert.match(ok.data.client_id, /^[A-Za-z0-9_-]{20,}$/);
  assert.deepEqual(ok.data.redirect_uris, [CLAUDE_CALLBACK]);
  assert.equal(ok.data.token_endpoint_auth_method, 'none');
  assert.equal((await o.register({ redirect_uris: ['https://claude.com/api/mcp/auth_callback'] })).status, 201);
  assert.equal((await o.register({ redirect_uris: ['http://localhost:3118/callback'] })).status, 201);
  assert.equal((await o.register({ redirect_uris: ['http://127.0.0.1:5555/callback'] })).status, 201);
  for (const bad of [['https://evil.example/cb'], ['https://claude.ai.evil.example/api/mcp/auth_callback'], ['http://claude.ai/api/mcp/auth_callback'], ['https://claude.ai/other'], [CLAUDE_CALLBACK, 'https://evil.example/cb'], [], 'x', undefined, ['http://localhost.evil.example/cb']]) {
    const r = await o.register({ client_name: 'x', redirect_uris: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.data.error, 'invalid_redirect_uri');
  }
  await app.close();
});

test('the whole sign-in: authorize, approve as the Owner, exchange, use the token, refresh', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const p = o.pkce();
  const c = await o.connect(client, p);
  assert.equal(c.redirect.origin + c.redirect.pathname, CLAUDE_CALLBACK);
  assert.equal(c.redirect.searchParams.get('state'), 'xyz');
  const t = await o.exchange(client, c.code, p);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.match(t.data.access_token, /^aot_/);
  assert.match(t.data.refresh_token, /^aor_/);
  assert.deepEqual([t.data.token_type, t.data.expires_in], ['Bearer', 3600]);

  const init = await o.mcpCall(t.data.access_token, 'initialize');
  assert.equal(init.status, 200);
  const tools = (await o.mcpCall(t.data.access_token, 'tools/list')).data.result.tools.map((x) => x.name);
  assert.ok(tools.includes('apply_changes'));

  // it is a key in the list, acting as the Owner, at the chosen access level
  const keys = (await app.owner.call('GET', '/api-keys')).data;
  assert.equal(keys.length, 1);
  assert.deepEqual([keys[0].name, keys[0].access, keys[0].ownerName, keys[0].kind], ['Claude', 'propose', 'Josh', 'oauth']);
  assert.ok(keys[0].lastUsedAt);
  const log = (await app.owner.call('GET', '/activity')).data;
  assert.ok(log.some((a) => a.action === 'oauth.connect'));

  const r = await o.token({ grant_type: 'refresh_token', refresh_token: t.data.refresh_token, client_id: client.client_id });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.refresh_token, t.data.refresh_token);
  assert.equal((await o.mcpCall(r.data.access_token)).status, 200);
  assert.equal((await app.owner.call('GET', '/api-keys')).data.length, 1);
  await app.close();
});

test('the code is bound to the client, the redirect address and the PKCE verifier, and works once', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const other = await o.newClient('http://localhost:4000/callback');
  const p = o.pkce();
  const fresh = async () => (await o.connect(client, p)).code;

  assert.equal((await o.exchange(client, await fresh(), o.pkce())).data.error, 'invalid_grant'); // wrong verifier
  assert.equal((await o.exchange(client, await fresh(), p, { redirect_uri: 'https://claude.ai/api/mcp/other' })).data.error, 'invalid_grant');
  assert.equal((await o.exchange(client, await fresh(), p, { client_id: other.client_id })).data.error, 'invalid_grant');
  assert.equal((await o.exchange(client, await fresh(), p, { client_id: 'nobody' })).data.error, 'invalid_client');
  assert.equal((await o.exchange(client, 'aoc_not-a-code', p)).data.error, 'invalid_grant');
  assert.equal((await o.token({ grant_type: 'password', client_id: client.client_id })).data.error, 'unsupported_grant_type');
  const code = await fresh();
  assert.equal((await o.exchange(client, code, p)).status, 200);
  assert.equal((await o.exchange(client, code, p)).data.error, 'invalid_grant'); // used
  // an old code is dead
  const stale = await fresh();
  app.db.prepare("UPDATE oauth_codes SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await o.exchange(client, stale, p)).data.error, 'invalid_grant');
  await app.close();
});

test('authorize refuses bad requests', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const p = o.pkce();
  // problems with the client or redirect are shown, never redirected
  assert.equal((await o.authorize(o.authorizeUrl({ client_id: 'nobody', redirect_uris: [CLAUDE_CALLBACK] }, p))).status, 400);
  assert.equal((await o.authorize(o.authorizeUrl(client, p, { redirect_uri: 'https://evil.example/cb' }))).status, 400);
  // other problems go back to the client as an error
  for (const extra of [{ code_challenge_method: 'plain' }, { code_challenge: '' }, { response_type: 'token' }, { resource: 'https://other.example/mcp' }]) {
    const res = await o.authorize(o.authorizeUrl(client, p, extra));
    assert.equal(res.status, 302, JSON.stringify(extra));
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, CLAUDE_CALLBACK);
    assert.ok(loc.searchParams.get('error'), JSON.stringify(extra));
    assert.equal(loc.searchParams.get('state'), 'xyz');
  }
  assert.equal((await o.authorize(o.authorizeUrl(client, p, { resource: `${o.origin}/mcp` }))).status, 302);
  assert.equal((await o.authorize(o.authorizeUrl(client, p, { resource: `${o.origin}/mcp/` }))).status, 302);
  await app.close();
});

test('any signed-in person can approve a sign-in for themselves; cancel and expiry work', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const p = o.pkce();
  const res = await o.authorize(o.authorizeUrl(client, p));
  const id = new URL(res.headers.get('location'), o.origin).hash.replace('#/connect/', '');
  assert.equal((await app.client().call('GET', `/oauth/requests/${id}`)).status, 401);
  const view = (await app.owner.call('GET', `/oauth/requests/${id}`)).data;
  assert.deepEqual([view.clientName, view.redirectHost, view.defaultAccess], ['Claude', 'claude.ai', 'propose']);
  assert.equal((await app.owner.call('POST', `/oauth/requests/${id}/approve`, { access: 'god' })).status, 400);
  const denied = (await app.owner.call('POST', `/oauth/requests/${id}/deny`, {})).data;
  const loc = new URL(denied.redirectUrl);
  assert.deepEqual([loc.searchParams.get('error'), loc.searchParams.get('state')], ['access_denied', 'xyz']);
  assert.equal((await app.owner.call('GET', `/oauth/requests/${id}`)).status, 404); // used up
  // an old request is gone
  const id2 = new URL((await o.authorize(o.authorizeUrl(client, p))).headers.get('location'), o.origin).hash.replace('#/connect/', '');
  app.db.prepare("UPDATE oauth_requests SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await app.owner.call('GET', `/oauth/requests/${id2}`)).status, 404);
  assert.equal((await app.owner.call('POST', `/oauth/requests/${id2}/approve`, { access: 'read' })).status, 404);
  await app.close();
});

test('a team member connects their own AI; it acts as them and only they (or an Admin) can see or revoke it', async () => {
  const app = await setUp();
  const o = oauth(app);
  const sarah = app.client();
  await sarah.signIn('sarah');
  const client = await o.newClient();
  const p = o.pkce();
  const t = (await o.exchange(client, (await o.connect(client, p, { who: sarah, access: 'direct' })).code, p)).data;
  assert.equal((await o.mcpCall(t.access_token)).status, 200);
  const mine = (await sarah.call('GET', '/api-keys')).data;
  assert.deepEqual([mine.length, mine[0].ownerName, mine[0].kind], [1, 'Sarah', 'oauth']);
  const other = app.client();
  await other.signIn('mark');
  assert.deepEqual((await other.call('GET', '/api-keys')).data, []);
  assert.equal((await other.call('DELETE', `/api-keys/${mine[0].id}`)).status, 404);
  assert.equal((await app.owner.call('GET', '/api-keys')).data.length, 1);
  assert.equal((await sarah.call('DELETE', `/api-keys/${mine[0].id}`)).status, 200);
  assert.equal((await o.mcpCall(t.access_token)).status, 401);
  await app.close();
});

test('refresh tokens rotate, and reusing an old one ends the connection', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const p = o.pkce();
  const first = (await o.exchange(client, (await o.connect(client, p)).code, p)).data;
  const second = (await o.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id })).data;
  assert.equal((await o.mcpCall(second.access_token)).status, 200);
  // the first access token was replaced
  assert.equal((await o.mcpCall(first.access_token)).status, 401);
  // someone replays the first refresh token: everything dies
  const replay = await o.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id });
  assert.equal(replay.data.error, 'invalid_grant');
  assert.equal((await o.mcpCall(second.access_token)).status, 401);
  assert.equal((await o.token({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: client.client_id })).data.error, 'invalid_grant');
  assert.equal((await app.owner.call('GET', '/api-keys')).data[0].revoked, true);
  await app.close();
});

test('an expired access token is answered with 401 and refreshing works; an expired refresh token does not', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const p = o.pkce();
  const t = (await o.exchange(client, (await o.connect(client, p)).code, p)).data;
  app.db.prepare("UPDATE oauth_tokens SET access_expires_at = '2000-01-01T00:00:00.000Z'").run();
  const res = await o.mcpCall(t.access_token);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /resource_metadata=/);
  const r = await o.token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id });
  assert.equal(r.status, 200);
  assert.equal((await o.mcpCall(r.data.access_token)).status, 200);
  app.db.prepare("UPDATE oauth_tokens SET refresh_expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await o.token({ grant_type: 'refresh_token', refresh_token: r.data.refresh_token, client_id: client.client_id })).data.error, 'invalid_grant');
  await app.close();
});

test('revoking the connection in Keys ends the access token and the refresh token at once', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const p = o.pkce();
  const t = (await o.exchange(client, (await o.connect(client, p, { access: 'direct' })).code, p)).data;
  assert.equal((await o.mcpCall(t.access_token)).status, 200);
  const key = (await app.owner.call('GET', '/api-keys')).data[0];
  assert.equal(key.access, 'direct');
  assert.equal((await app.owner.call('DELETE', `/api-keys/${key.id}`)).status, 200);
  assert.equal((await o.mcpCall(t.access_token)).status, 401);
  assert.equal((await o.token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id })).data.error, 'invalid_grant');
  await app.close();
});

test('an OAuth connection follows the same plan rules: read cannot write, ask-first waits in the inbox', async () => {
  const app = await setUp();
  const o = oauth(app);
  const client = await o.newClient();
  const call = async (token, name, args) => (await (await fetch(`${o.origin}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
  const p1 = o.pkce();
  const readTok = (await o.exchange(client, (await o.connect(client, p1, { access: 'read' })).code, p1)).data.access_token;
  assert.equal((await call(readTok, 'create_client', { name: 'X' })).isError, true);
  const p2 = o.pkce();
  const askTok = (await o.exchange(client, (await o.connect(client, p2, { access: 'propose' })).code, p2)).data.access_token;
  const r = await call(askTok, 'create_client', { name: 'Acme' });
  assert.equal(JSON.parse(r.content[0].text).status, 'pending');
  assert.equal((await app.owner.call('GET', '/ai/proposals?status=pending')).data.length, 1);
  await app.close();
});

test('a person who is deactivated loses the connection', async () => {
  const app = await setUp();
  const o = oauth(app);
  const rayne = app.client();
  await rayne.signIn('rayne');
  const client = await o.newClient();
  const p = o.pkce();
  const t = (await o.exchange(client, (await o.connect(client, p, { who: rayne })).code, p)).data;
  assert.equal((await o.mcpCall(t.access_token)).status, 200);
  assert.equal((await app.owner.call('PATCH', '/members/2', { isActive: false })).status, 200);
  assert.equal((await o.mcpCall(t.access_token)).status, 401);
  await app.close();
});
