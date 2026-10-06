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

// Text that may be left empty.
function cleanOptional(value, label, max) {
  if (value === undefined || value === null) return '';
  return cleanText(String(value), label, 0, max);
}

function cleanEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new ServiceError(400, `Choose a valid ${label}`);
  return value;
}

// A real calendar date as YYYY-MM-DD. Empty means no date.
function cleanDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (!d || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new ServiceError(400, `${label} must be a real date`);
  }
  return String(value);
}

function cleanEmail(value) {
  const email = cleanOptional(value, 'Email', 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError(400, 'Email does not look right');
  return email;
}

// Which of `fields` differ between two plain objects, as { before, after } with only the changed ones.
function diff(current, next, fields) {
  const before = {};
  const after = {};
  for (const f of fields) {
    if (next[f] !== current[f]) { before[f] = current[f]; after[f] = next[f]; }
  }
  return { before, after, changed: Object.keys(after).length > 0 };
}

// The person must be an active member of this agency. Empty means nobody.
function cleanTeamMember(db, organizationId, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  const row = Number.isInteger(id) && db.prepare('SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.id = ? AND u.is_active = 1').get(organizationId, id);
  if (!row) throw new ServiceError(400, 'Choose a team member from this agency');
  return id;
}

module.exports = { cleanText, cleanUsername, cleanTimezone, cleanOptional, cleanEnum, cleanDate, cleanEmail, cleanTeamMember, diff };
