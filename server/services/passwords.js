// Joshua Nunez
const crypto = require('crypto');
const config = require('../config');

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Hash of a random password, used to spend equal time when the username is unknown.
let dummy;
async function verifyAgainstDummy(password) {
  dummy = dummy || (await hashPassword(crypto.randomBytes(12).toString('hex')));
  await verifyPassword(password, dummy);
  return false;
}

function passwordProblem(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < config.minPasswordLength) return `Use at least ${config.minPasswordLength} characters`;
  if (password.length > 200) return 'Password is too long';
  return null;
}

module.exports = { hashPassword, verifyPassword, verifyAgainstDummy, passwordProblem };
