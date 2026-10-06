// Joshua Nunez
// OAuth sign-in for claude.ai connectors (authorization code with PKCE, dynamic client registration, rotating
// refresh tokens). An approved connection becomes an ordinary API key (kind 'oauth'), so it is listed, limited
// and revoked like any key. Codes and tokens are stored only as hashes.
const crypto = require('crypto');
const { logActivity } = require('./audit');
const { ServiceError } = require('./errors');
const { ACCESS, sha256 } = require('./apikeys');
const perms = require('./permissions');

const MINUTE = 60 * 1000;
const REQUEST_TTL = 10 * MINUTE;
const CODE_TTL = 5 * MINUTE;
const ACCESS_TTL = 60 * MINUTE;
const REFRESH_TTL = 30 * 24 * 60 * MINUTE;
const MAX_CLIENTS = 1000;

// Where Claude's apps send people back to. Nothing else may register.
const CLAUDE_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];

// An OAuth error: sent to the app as { error, error_description }. `redirectTo` is set when it should go back to
// the app's redirect address instead of being shown.
class OAuthError extends Error {
  constructor(error, description, { status = 400, redirectTo = null } = {}) {
    super(description);
    this.error = error;
    this.status = status;
    this.redirectTo = redirectTo;
  }
}

const iso = (ms) => new Date(ms).toISOString();
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

const isLoopback = (u) => u && u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname) && !u.username && !u.password && !u.hash;

function redirectAllowed(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  if (CLAUDE_CALLBACKS.includes(value)) return true;
  return isLoopback(parseUrl(value));
}

// An address matches a registered one exactly, or, for a loopback address, with any port (RFC 8252).
function redirectMatches(registered, given) {
  if (registered.includes(given)) return true;
  const g = parseUrl(given);
  if (!isLoopback(g)) return false;
  return registered.some((r) => { const u = parseUrl(r); return isLoopback(u) && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search; });
}

// ---- registration ----

function registerClient(db, body) {
  const uris = body && body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every(redirectAllowed)) {
    throw new OAuthError('invalid_redirect_uri', 'Only Claude redirect addresses can be registered');
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get().n >= MAX_CLIENTS) throw new OAuthError('temporarily_unavailable', 'Too many registered apps', { status: 503 });
  const rawName = body && typeof body.client_name === 'string' ? body.client_name : '';
  const name = rawName.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'Claude';
  const clientId = random(18);
  db.prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)').run(clientId, name, JSON.stringify(uris));
  return { client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: Math.floor(Date.now() / 1000) };
}

const findClient = (db, clientId) => {
  const row = typeof clientId === 'string' && db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
  return row ? { clientId: row.client_id, name: row.client_name, redirectUris: JSON.parse(row.redirect_uris) } : null;
};

// ---- authorization ----

function errorRedirect(redirectUri, state, error, description) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

// Checks an authorization request and stores it until a person approves. Returns the id of the stored request.
// A bad client or redirect address is never redirected (that would send the person to an attacker's page).
function startAuthorization(db, q, resourceUrl) {
  const client = findClient(db, q.client_id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown app');
  if (typeof q.redirect_uri !== 'string' || !redirectMatches(client.redirectUris, q.redirect_uri)) throw new OAuthError('invalid_request', 'That redirect address is not registered for this app');
  const state = typeof q.state === 'string' ? q.state.slice(0, 500) : '';
  const bad = (error, description) => new OAuthError(error, description, { redirectTo: errorRedirect(q.redirect_uri, state, error, description) });
  if (q.response_type !== 'code') throw bad('unsupported_response_type', 'Only response_type=code is supported');
  if (typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge) || q.code_challenge_method !== 'S256') throw bad('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  if (q.resource !== undefined && String(q.resource).replace(/\/+$/, '') !== resourceUrl) throw bad('invalid_target', 'Unknown resource');
  const id = random(24);
  db.prepare('INSERT INTO oauth_requests (id, client_id, redirect_uri, code_challenge, state, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, client.clientId, q.redirect_uri, q.code_challenge, state, iso(Date.now() + REQUEST_TTL));
  return id;
}

const need = (ctx) => { if (!perms.can(ctx.actor.role, 'ai.manage')) throw new ServiceError(403, 'Only an Owner or Admin can connect an AI'); };

function findRequest(db, id) {
  const row = typeof id === 'string' && db.prepare('SELECT r.*, c.client_name AS clientName FROM oauth_requests r JOIN oauth_clients c ON c.client_id = r.client_id WHERE r.id = ? AND r.expires_at > ?').get(id, new Date().toISOString());
  if (!row) throw new ServiceError(404, 'This connection request has expired. Start again from the AI app');
  return row;
}

function getRequest(db, ctx, id) {
  need(ctx);
  const r = findRequest(db, id);
  return { id: r.id, clientName: r.clientName, redirectHost: new URL(r.redirect_uri).host, defaultAccess: 'propose' };
}

// Approving or cancelling. Returns the address to send the browser to.
function decideRequest(db, ctx, id, { approve, access }) {
  need(ctx);
  const r = findRequest(db, id);
  if (!approve) {
    db.prepare('DELETE FROM oauth_requests WHERE id = ?').run(r.id);
    return { redirectUrl: errorRedirect(r.redirect_uri, r.state, 'access_denied', 'The person cancelled') };
  }
  if (!ACCESS.includes(access)) throw new ServiceError(400, 'Choose an access level');
  const code = `aoc_${random(32)}`;
  db.transaction(() => {
    db.prepare('DELETE FROM oauth_requests WHERE id = ?').run(r.id);
    db.prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, user_id, organization_id, access, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(code), r.client_id, r.redirect_uri, r.code_challenge, ctx.actor.id, ctx.organizationId, access, iso(Date.now() + CODE_TTL));
  })();
  const u = new URL(r.redirect_uri);
  u.searchParams.set('code', code);
  if (r.state) u.searchParams.set('state', r.state);
  return { redirectUrl: u.toString() };
}

// ---- tokens ----

const tokenResponse = (access, refresh) => ({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: 'mcp' });

function newTokens() {
  const access = `aot_${random(32)}`;
  const refresh = `aor_${random(32)}`;
  return { access, refresh, accessHash: sha256(access), refreshHash: sha256(refresh), accessExpires: iso(Date.now() + ACCESS_TTL), refreshExpires: iso(Date.now() + REFRESH_TTL) };
}

const pkceMatches = (verifier, challenge) => {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  return expected.length === challenge.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(challenge));
};

function exchangeCode(db, p) {
  const client = findClient(db, p.client_id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown app');
  const codeHash = typeof p.code === 'string' ? sha256(p.code) : '';
  const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(codeHash);
  const grant = () => new OAuthError('invalid_grant', 'The code is not valid');
  if (!row) throw grant();
  // A code gets one attempt, whatever the outcome.
  db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(codeHash);
  if (row.expires_at <= new Date().toISOString() || row.client_id !== client.clientId || row.redirect_uri !== p.redirect_uri || !pkceMatches(p.code_verifier, row.code_challenge)) throw grant();
  const person = db.prepare('SELECT 1 FROM users u JOIN organization_members m ON m.user_id = u.id WHERE u.id = ? AND m.organization_id = ? AND u.is_active = 1').get(row.user_id, row.organization_id);
  if (!person) throw grant();
  const t = newTokens();
  db.transaction(() => {
    const keyId = Number(db.prepare("INSERT INTO api_keys (organization_id, user_id, name, access, token_hash, prefix, kind) VALUES (?, ?, ?, ?, ?, 'OAuth', 'oauth')").run(row.organization_id, row.user_id, client.name, row.access, sha256(random(32))).lastInsertRowid);
    db.prepare('INSERT INTO oauth_tokens (key_id, client_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(keyId, client.clientId, t.accessHash, t.accessExpires, t.refreshHash, t.refreshExpires);
    logActivity(db, { organizationId: row.organization_id, actorUserId: row.user_id, action: 'oauth.connect', objectType: 'api_key', objectId: keyId, after: { name: client.name, access: row.access } });
  })();
  return tokenResponse(t.access, t.refresh);
}

function refresh(db, p) {
  const client = findClient(db, p.client_id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown app');
  const hash = typeof p.refresh_token === 'string' ? sha256(p.refresh_token) : '';
  const grant = () => new OAuthError('invalid_grant', 'The refresh token is not valid');
  const row = db.prepare(
    `SELECT t.id, t.key_id, t.client_id, t.refresh_expires_at, k.revoked_at, k.organization_id, k.user_id
       FROM oauth_tokens t JOIN api_keys k ON k.id = t.key_id WHERE t.refresh_hash = ?`
  ).get(hash);
  if (!row) {
    // An old refresh token used again means a copy leaked: end the connection.
    const reused = hash && db.prepare('SELECT t.id, t.key_id, k.organization_id, k.user_id FROM oauth_tokens t JOIN api_keys k ON k.id = t.key_id WHERE t.previous_refresh_hash = ?').get(hash);
    if (reused) {
      db.transaction(() => {
        db.prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND revoked_at IS NULL").run(reused.key_id);
        db.prepare('DELETE FROM oauth_tokens WHERE id = ?').run(reused.id);
        logActivity(db, { organizationId: reused.organization_id, actorUserId: null, action: 'oauth.refresh_reuse', objectType: 'api_key', objectId: reused.key_id, source: 'system' });
      })();
    }
    throw grant();
  }
  const person = db.prepare('SELECT 1 FROM users u JOIN organization_members m ON m.user_id = u.id WHERE u.id = ? AND m.organization_id = ? AND u.is_active = 1').get(row.user_id, row.organization_id);
  if (row.client_id !== client.clientId || row.revoked_at || row.refresh_expires_at <= new Date().toISOString() || !person) throw grant();
  const t = newTokens();
  db.prepare('UPDATE oauth_tokens SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ?, previous_refresh_hash = ? WHERE id = ?').run(t.accessHash, t.accessExpires, t.refreshHash, t.refreshExpires, hash, row.id);
  return tokenResponse(t.access, t.refresh);
}

function token(db, p) {
  if (p.grant_type === 'authorization_code') return exchangeCode(db, p);
  if (p.grant_type === 'refresh_token') return refresh(db, p);
  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
}

function prune(db) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(now);
}

module.exports = { OAuthError, CLAUDE_CALLBACKS, registerClient, startAuthorization, getRequest, decideRequest, token, prune };
