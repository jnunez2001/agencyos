// Joshua Nunez
// A small Google client for Search Console and Analytics (GA4), using a service account (a read-only robot
// identity). The sign-in token is built and signed here with Node's own crypto, so no libraries are needed.
// Google is passed in as `fetchImpl` so tests can replace it. The key never leaves this module.
const crypto = require('crypto');
const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly'];

class GoogleError extends Error {}

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

// The API calls, shared by every kind of sign-in. `getToken` returns a fresh access token and `refusedText` is the
// message when Google says this identity may not see something.
function buildApi({ email, getToken, fetchImpl, refusedText }) {
  async function sendRaw(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch {
      throw new GoogleError('Could not reach Google. Check the server\'s internet connection and try again');
    }
  }

  // Plain messages that say what to do.
  function failure(status) {
    if (status === 401 || status === 403) return new GoogleError(refusedText);
    if (status === 404) return new GoogleError('Google could not find that site or property');
    if (status === 429) return new GoogleError('Google asked us to slow down. Try again later');
    return new GoogleError(`Google returned an error (${status})`);
  }

  async function call(method, url, body) {
    const token = await getToken(sendRaw);
    const res = await sendRaw(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw failure(res.status);
    return res.json();
  }

  async function listSites() {
    const data = await call('GET', 'https://www.googleapis.com/webmasters/v3/sites');
    return (data.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
  }

  async function listProperties() {
    const out = [];
    let pageToken = '';
    for (let page = 0; page < 5; page += 1) {
      const data = await call('GET', `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const account of data.accountSummaries || []) {
        for (const p of account.propertySummaries || []) out.push({ id: String(p.property).replace('properties/', ''), name: p.displayName, account: account.displayName });
      }
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return out;
  }

  // Totals for a date range, or null when Google has no data for it.
  async function searchAnalytics(siteUrl, { startDate, endDate }) {
    const data = await call('POST', `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { startDate, endDate });
    const row = data.rows && data.rows[0];
    return row ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } : null;
  }

  async function ga4Totals(propertyId, { startDate, endDate }) {
    if (!/^\d+$/.test(String(propertyId))) throw new GoogleError('The Analytics property id must be a number');
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const dateRanges = [{ startDate, endDate }];
    const totals = await call('POST', url, { dateRanges, metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }] });
    const row = totals.rows && totals.rows[0];
    if (!row) return null;
    const [sessions, users, conversions] = row.metricValues.map((m) => Number(m.value));
    const organic = await call('POST', url, {
      dateRanges, metrics: [{ name: 'sessions' }],
      dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } },
    });
    const organicSessions = organic.rows && organic.rows[0] ? Number(organic.rows[0].metricValues[0].value) : 0;
    return { sessions, users, conversions, organicSessions };
  }

  return { email, listSites, listProperties, searchAnalytics, ga4Totals };
}

// A service account: signs its own token with the key file. No sign-in screen, never expires.
function createGoogle({ key, fetchImpl = fetch, now = () => Date.now() }) {
  const email = key.client_email;
  let cached = null; // { token, expiresAt }
  async function getToken(send) {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope: SCOPES.join(' '), aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    const res = await send(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString() });
    if (!res.ok) throw new GoogleError('Could not sign in to Google. Check that the key file is the right one and that the service account is not disabled');
    const data = await res.json();
    cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
    return cached.token;
  }
  return buildApi({ email, getToken, fetchImpl, refusedText: `Google refused access. Add ${email} as a read-only user (a viewer) for this property` });
}

// A person's Google account, signed in once with Google. It holds only a refresh token. `onInvalid` is called when
// Google says that token has been withdrawn or has expired, so the account can be marked as needing a reconnect.
function createOAuthGoogle({ clientId, clientSecret, refreshToken, email, fetchImpl = fetch, now = () => Date.now(), onInvalid }) {
  let cached = null;
  async function getToken(send) {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const res = await send(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }).toString() });
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch { /* not json */ }
      if (body.error === 'invalid_grant') {
        if (onInvalid) onInvalid();
        throw new GoogleError(`Google access for ${email} was withdrawn or has expired. Reconnect this account in Settings`);
      }
      throw new GoogleError('Could not sign in to Google. Check the Google sign-in settings on the server');
    }
    const data = await res.json();
    cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
    return cached.token;
  }
  return buildApi({ email, getToken, fetchImpl, refusedText: `Google refused access. The account ${email} cannot see that property` });
}

// ---- signing in with Google (the one-time consent) ----

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SIGN_IN_SCOPES = [...SCOPES, 'openid', 'email'];

// Where to send the person. `access_type=offline` and `prompt=consent` make Google return a refresh token.
function authUrl({ clientId, redirectUri, state }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SIGN_IN_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', state);
  return u.toString();
}

async function postForm(fetchImpl, url, form) {
  try {
    return await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  } catch {
    throw new GoogleError('Could not reach Google. Check the server\'s internet connection and try again');
  }
}

// The code Google sent back, for a refresh token and the account's email address.
async function exchangeCode({ clientId, clientSecret, redirectUri, code, fetchImpl = fetch }) {
  const res = await postForm(fetchImpl, TOKEN_URL, { grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
  if (!res.ok) throw new GoogleError('Google did not accept the sign-in. Try adding the account again');
  const data = await res.json();
  if (!data.refresh_token) throw new GoogleError('Google did not give long-lasting access. Remove AgencyOS from your Google account permissions and try again');
  const granted = String(data.scope || '');
  if (!granted.includes('webmasters.readonly') && !granted.includes('analytics.readonly')) throw new GoogleError('Access to Search Console or Analytics was not approved');
  let email = '';
  try {
    const info = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${data.access_token}` } });
    if (info.ok) email = String((await info.json()).email || '');
  } catch { /* handled below */ }
  if (!email) throw new GoogleError('Google did not say which account signed in');
  return { refreshToken: data.refresh_token, email };
}

// ---- signing in to AgencyOS with Google (identity only: openid, email, profile) ----

const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

function identityUrl({ clientId, redirectUri, state, nonce, challenge }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', IDENTITY_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

// The code for the person's identity. The ID token comes straight from Google's token endpoint over TLS, so its
// signature need not be checked again, but who it is for, who issued it, when it expires and its nonce are.
async function exchangeIdentity({ clientId, clientSecret, redirectUri, code, verifier, nonce, fetchImpl = fetch, now = () => Date.now() }) {
  const res = await postForm(fetchImpl, TOKEN_URL, { grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code_verifier: verifier });
  if (!res.ok) throw new GoogleError('Google did not accept the sign-in. Try again');
  const data = await res.json();
  let claims;
  try { claims = JSON.parse(Buffer.from(String(data.id_token).split('.')[1], 'base64url').toString('utf8')); } catch { throw new GoogleError('Google did not say who signed in. Try again'); }
  const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issuerOk || claims.aud !== clientId || !(Number(claims.exp) * 1000 > now()) || claims.nonce !== nonce || !claims.sub) throw new GoogleError('Google\'s answer did not check out. Try again');
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email) throw new GoogleError('Google has not verified that email address');
  return { sub: String(claims.sub), email: claims.email, name: typeof claims.name === 'string' ? claims.name : '' };
}

// Best effort: tell Google the token is no longer wanted.
async function revokeToken(token, fetchImpl = fetch) {
  try { await postForm(fetchImpl, 'https://oauth2.googleapis.com/revoke', { token }); } catch { /* the token is dropped here either way */ }
}

// Reads the key file. A missing or broken file means Google is not set up, which is not an error.
function loadGoogle(file, options = {}) {
  if (!file) return null;
  try {
    const key = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') return null;
    return createGoogle({ key, ...options });
  } catch {
    return null;
  }
}

module.exports = { createGoogle, createOAuthGoogle, loadGoogle, authUrl, exchangeCode, revokeToken, identityUrl, exchangeIdentity, GoogleError };
