// Joshua Nunez
// Small input checks shared by the services. Every message is plain language a person can act on.
const { ServiceError } = require('./errors');

function cleanText(value, label, min, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) throw new ServiceError(400, `${label} must be ${min} to ${max} characters`);
  return text;
}

function cleanUsername(value) {
  const name = cleanText(value, 'Username', 3, 40);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ServiceError(400, 'Username may use letters, numbers, dot, dash and underscore');
  return name;
}

function cleanTimezone(value) {
  const tz = cleanText(value, 'Timezone', 1, 60);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new ServiceError(400, 'Unknown timezone');
  }
  return tz;
}

module.exports = { cleanText, cleanUsername, cleanTimezone };
