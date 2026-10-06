// Joshua Nunez
// The public OAuth endpoints and discovery documents. Not behind a session: Claude calls them directly.
const express = require('express');
const config = require('./config');
const oauth = require('./services/oauth');

// The address people use to reach this server. The PUBLIC_URL setting wins, so nothing here trusts a header
// when the server is online. Without it (local use) it is worked out from the request.
const originOf = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

function limiter(max, windowMs = 60 * 1000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start >= windowMs) { hits.set(key, { start: now, count: 1 }); return true; }
    h.count += 1;
    if (hits.size > 5000) hits.clear();
    return h.count <= max;
  };
}

function oauthRouter(db) {
  const r = express.Router();
  const registerLimit = limiter(60);
  const tokenLimit = limiter(60);
  r.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const resourceMeta = (req, res) => res.json({ resource: `${originOf(req)}/mcp`, authorization_servers: [originOf(req)], bearer_methods_supported: ['header'], scopes_supported: ['mcp'] });
  r.get('/.well-known/oauth-protected-resource', resourceMeta);
  r.get('/.well-known/oauth-protected-resource/mcp', resourceMeta);

  r.get('/.well-known/oauth-authorization-server', (req, res) => {
    const o = originOf(req);
    res.json({
      issuer: o,
      authorization_endpoint: `${o}/oauth/authorize`,
      token_endpoint: `${o}/oauth/token`,
      registration_endpoint: `${o}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  const fail = (res, err) => {
    if (!(err instanceof oauth.OAuthError)) { console.error(err); return res.status(500).json({ error: 'server_error' }); }
    return res.status(err.status).json({ error: err.error, error_description: err.message });
  };

  r.post('/oauth/register', (req, res) => {
    if (!registerLimit(req.ip)) return res.status(429).json({ error: 'temporarily_unavailable', error_description: 'Too many requests' });
    try { res.status(201).json(oauth.registerClient(db, req.body)); } catch (err) { fail(res, err); }
  });

  r.get('/oauth/authorize', (req, res) => {
    try {
      const id = oauth.startAuthorization(db, req.query, { resourceUrls: [originOf(req), `${originOf(req)}/mcp`], issuer: originOf(req) });
      res.redirect(302, `/#/connect/${id}`);
    } catch (err) {
      if (err instanceof oauth.OAuthError && err.redirectTo) return res.redirect(302, err.redirectTo);
      fail(res, err);
    }
  });

  r.post('/oauth/token', express.urlencoded({ extended: false, limit: '20kb' }), (req, res) => {
    if (!tokenLimit(req.ip)) return res.status(429).json({ error: 'temporarily_unavailable', error_description: 'Too many requests' });
    try { res.json(oauth.token(db, req.body || {})); } catch (err) { fail(res, err); }
  });
  return r;
}

module.exports = { oauthRouter, originOf };
