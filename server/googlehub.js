// Joshua Nunez
// Every Google credential the server can use: the service account (a key file) and the Google accounts people have
// signed in with. Account refresh tokens are stored encrypted (AES-256-GCM). The key lives in its own file beside
// the database, so a copy of the database or a backup alone cannot reveal them. Google is passed in as
// `fetchImpl` so tests can replace it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createOAuthGoogle, authUrl, exchangeCode, revokeToken, identityUrl, exchangeIdentity, GoogleError } = require('./google');
const { ServiceError } = require('./services/errors');

const STATE_TTL_MS = 10 * 60 * 1000;
const RETURN_TARGETS = /^(settings|clients-\d{1,9})$/;

// Reads the OAuth client file ({ client_id, client_secret }). Missing or broken means sign in with Google is not set up.
function loadOAuthApp(file) {
  if (!file) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const app = j.web || j.installed || j; // Google's own download wraps it in "web"
    return typeof app.client_id === 'string' && typeof app.client_secret === 'string' ? { clientId: app.client_id, clientSecret: app.client_secret } : null;
  } catch {
    return null;
  }
}

function createHub({ db, serviceClient = null, oauthApp = null, keyFile, fetchImpl = fetch, now = () => Date.now() }) {
  let tokenKey = null;
  const states = new Map(); // state -> { userId, organizationId, returnTo, expires }
  const clients = new Map(); // account id -> { client, token }
  const idStates = new Map(); // sign-in to AgencyOS: state -> { purpose, userId, organizationId, nonce, verifier, expires }

  function key() {
    if (tokenKey) return tokenKey;
    if (!keyFile) throw new Error('No place to keep the token encryption key');
    try {
      tokenKey = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
    } catch {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
      tokenKey = crypto.randomBytes(32);
      fs.writeFileSync(keyFile, tokenKey.toString('hex'), { mode: 0o600 });
    }
    if (tokenKey.length !== 32) throw new Error('The token encryption key file is damaged');
    return tokenKey;
  }

  function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join(':');
  }

  function decrypt(blob) {
    const [version, iv, tag, body] = String(blob).split(':');
    if (version !== 'v1') throw new Error('Unknown token format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }

  const redirectUri = (origin) => `${origin}/api/integrations/google/callback`;

  // The address to send the person to, with a random single-use state tied to them and their agency.
  function startSignIn({ origin, userId, organizationId, returnTo }) {
    if (!oauthApp) throw new ServiceError(400, 'Signing in with Google is not set up on this server');
    for (const [s, v] of states) if (v.expires < now()) states.delete(s);
    if (states.size > 200) states.clear();
    const state = crypto.randomBytes(24).toString('base64url');
    states.set(state, { userId, organizationId, returnTo: RETURN_TARGETS.test(returnTo || '') ? returnTo : 'settings', expires: now() + STATE_TTL_MS });
    return authUrl({ clientId: oauthApp.clientId, redirectUri: redirectUri(origin), state });
  }

  // Google sent the person back. Only the same signed-in person who started it can finish it.
  async function finishSignIn({ origin, code, state, userId, organizationId }) {
    const found = typeof state === 'string' ? states.get(state) : null;
    // Someone else presenting the link must not use it up; the right person uses it once.
    const s = found && found.userId === userId && found.organizationId === organizationId ? found : null;
    if (s) states.delete(state);
    if (!s || s.expires < now()) throw new ServiceError(400, 'That sign-in link expired or does not belong to you. Try adding the account again');
    if (typeof code !== 'string' || !code) throw new ServiceError(400, 'Google did not send a sign-in code');
    const { refreshToken, email } = await exchangeCode({ ...oauthApp, redirectUri: redirectUri(origin), code, fetchImpl });
    const enc = encrypt(refreshToken);
    const existing = db.prepare('SELECT id FROM google_accounts WHERE organization_id = ? AND email = ?').get(organizationId, email);
    let id;
    if (existing) {
      id = existing.id;
      db.prepare("UPDATE google_accounts SET refresh_token_enc = ?, status = 'ok', connected_by = ?, connected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(enc, userId, id);
      clients.delete(id);
    } else {
      id = Number(db.prepare('INSERT INTO google_accounts (organization_id, email, refresh_token_enc, connected_by) VALUES (?, ?, ?, ?)').run(organizationId, email, enc, userId).lastInsertRowid);
    }
    return { accountId: id, email, returnTo: s.returnTo, reconnected: !!existing };
  }

  // ---- signing in to AgencyOS itself (who the person is, nothing more) ----

  const identityRedirect = (origin) => `${origin}/api/auth/google/callback`;
  const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');

  // `purpose` is 'login' (nobody is signed in) or 'link' (a signed-in person adds their Google account).
  function startIdentity({ origin, purpose, userId = null, organizationId = null }) {
    if (!oauthApp) throw new ServiceError(400, 'Signing in with Google is not set up on this server');
    for (const [k, v] of idStates) if (v.expires < now()) idStates.delete(k);
    if (idStates.size > 500) idStates.clear();
    const state = random(24);
    const nonce = random(16);
    const verifier = random(32);
    idStates.set(state, { purpose, userId, organizationId, nonce, verifier, expires: now() + STATE_TTL_MS });
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { state, url: identityUrl({ clientId: oauthApp.clientId, redirectUri: identityRedirect(origin), state, nonce, challenge }) };
  }

  async function finishIdentity({ origin, code, state }) {
    const s = typeof state === 'string' ? idStates.get(state) : null;
    if (s) idStates.delete(state); // single use
    if (!s || s.expires < now()) throw new ServiceError(400, 'That sign-in link expired. Try again');
    if (typeof code !== 'string' || !code) throw new ServiceError(400, 'Google did not send a sign-in code');
    try {
      const claims = await exchangeIdentity({ ...oauthApp, redirectUri: identityRedirect(origin), code, verifier: s.verifier, nonce: s.nonce, fetchImpl, now });
      return { purpose: s.purpose, userId: s.userId, organizationId: s.organizationId, claims };
    } catch (err) {
      if (err instanceof GoogleError) throw new ServiceError(502, err.message);
      throw err;
    }
  }

  function listAccounts(organizationId) {
    return db.prepare(
      `SELECT a.id, a.email, a.status, a.connected_at AS connectedAt, u.display_name AS connectedByName,
              (SELECT COUNT(*) FROM client_google g WHERE g.google_account_id = a.id) AS clients
         FROM google_accounts a LEFT JOIN users u ON u.id = a.connected_by WHERE a.organization_id = ? ORDER BY a.email COLLATE NOCASE`
    ).all(organizationId);
  }

  // Revokes the token at Google (best effort) and forgets the account. Clients using it lose their link.
  async function removeAccount(organizationId, accountId) {
    const row = db.prepare('SELECT * FROM google_accounts WHERE organization_id = ? AND id = ?').get(organizationId, Number(accountId));
    if (!row) throw new ServiceError(404, 'Google account not found');
    const disconnected = db.prepare('SELECT COUNT(*) AS n FROM client_google WHERE google_account_id = ?').get(row.id).n;
    let token = null;
    try { token = decrypt(row.refresh_token_enc); } catch { /* an unreadable token cannot be revoked */ }
    db.prepare('DELETE FROM google_accounts WHERE id = ?').run(row.id);
    clients.delete(row.id);
    if (token) await revokeToken(token, fetchImpl);
    return { email: row.email, disconnected };
  }

  // The client for a source: 'service' or an account id of this agency. Null when there is nothing to use.
  function get(source, organizationId) {
    if (source === 'service' || source === null || source === undefined) return serviceClient;
    const id = Number(source);
    const row = Number.isInteger(id) && db.prepare('SELECT * FROM google_accounts WHERE organization_id = ? AND id = ?').get(organizationId, id);
    if (!row || !oauthApp) return null;
    const cached = clients.get(row.id);
    if (cached && cached.enc === row.refresh_token_enc) return cached.client;
    let refreshToken;
    try { refreshToken = decrypt(row.refresh_token_enc); } catch { return null; }
    const client = createOAuthGoogle({
      ...oauthApp, refreshToken, email: row.email, fetchImpl, now,
      onInvalid: () => db.prepare("UPDATE google_accounts SET status = 'needs_reconnect' WHERE id = ?").run(row.id),
    });
    clients.set(row.id, { client, enc: row.refresh_token_enc });
    return client;
  }

  return {
    serviceEmail: serviceClient ? serviceClient.email : null,
    serviceConfigured: !!serviceClient,
    oauthConfigured: !!oauthApp,
    startSignIn, finishSignIn, startIdentity, finishIdentity, listAccounts, removeAccount, get,
    _encrypt: encrypt, _decrypt: decrypt, // for tests
  };
}

module.exports = { createHub, loadOAuthApp };
