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

function createGoogle({ key, fetchImpl = fetch, now = () => Date.now() }) {
  const email = key.client_email;
  let cached = null; // { token, expiresAt }

  async function sendRaw(url, init) {
    try {
      return await fetchImpl(url, init);
    } catch {
      throw new GoogleError('Could not reach Google. Check the server\'s internet connection and try again');
    }
  }

  async function accessToken() {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope: SCOPES.join(' '), aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    const res = await sendRaw(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString() });
    if (!res.ok) throw new GoogleError('Could not sign in to Google. Check that the key file is the right one and that the service account is not disabled');
    const data = await res.json();
    cached = { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
    return cached.token;
  }

  // Plain messages that say what to do.
  function failure(status) {
    if (status === 401 || status === 403) return new GoogleError(`Google refused access. Add ${email} as a read-only user (a viewer) for this property`);
    if (status === 404) return new GoogleError('Google could not find that site or property');
    if (status === 429) return new GoogleError('Google asked us to slow down. Try again later');
    return new GoogleError(`Google returned an error (${status})`);
  }

  async function call(method, url, body) {
    const token = await accessToken();
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

module.exports = { createGoogle, loadGoogle, GoogleError };
