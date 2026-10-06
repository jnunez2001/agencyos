// Joshua Nunez
const config = require('./config');
const auth = require('./services/auth');
const { ServiceError } = require('./services/errors');

const COOKIE = 'agencyos_sid';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

function setSessionCookie(req, res, token, expires) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`];
  if (config.cookieSecure || req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// A short-lived cookie that holds the Google sign-in state, so a sign-in can only be finished in the browser that started it.
const GSTATE = 'agencyos_gstate';
function setStateCookie(req, res, state) {
  res.append('Set-Cookie', `${GSTATE}=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${config.cookieSecure || req.secure ? '; Secure' : ''}`);
}
function clearStateCookie(req, res) {
  res.append('Set-Cookie', `${GSTATE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure || req.secure ? '; Secure' : ''}`);
}

function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${config.cookieSecure || req.secure ? '; Secure' : ''}`);
}

function sessionLoader(db) {
  return (req, res, next) => {
    req.auth = auth.resolveSession(db, parseCookies(req.headers.cookie)[COOKIE]);
    if (req.auth) auth.touchSession(db, req.auth.sessionId);
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Sign in required' });
  next();
}

// Every state-changing request needs the session's token in a header.
function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.auth || req.get('x-csrf-token') !== req.auth.csrf) return res.status(403).json({ error: 'Session check failed. Reload the page' });
  next();
}

// A person with a temporary password may only change it (or look at their session, or sign out).
const ALLOWED_BEFORE_CHANGE = new Set(['GET /session', 'POST /password', 'POST /logout']);
function requirePasswordChanged(req, res, next) {
  if (req.auth && req.auth.user.mustChangePassword && !ALLOWED_BEFORE_CHANGE.has(`${req.method} ${req.path}`)) {
    return res.status(403).json({ error: 'Change your temporary password first', code: 'must_change_password' });
  }
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, next) {
  if (err instanceof ServiceError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Bad request' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}

module.exports = { parseCookies, GSTATE, setStateCookie, clearStateCookie, securityHeaders, setSessionCookie, clearSessionCookie, sessionLoader, requireAuth, requireCsrf, requirePasswordChanged, wrap, errorHandler, COOKIE };
