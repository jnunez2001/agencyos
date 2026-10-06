// Joshua Nunez
// The small, shared part of Google sign-in storage: checking an email and keeping one invitation per person.
// It depends on nothing else, so members and identities can both use it.
const { ServiceError } = require('./errors');

function cleanGoogleEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new ServiceError(400, 'Enter a valid Google email address');
  return email;
}

// An email is taken when it is invited for, or linked to, someone other than `exceptUserId`.
function emailTaken(db, email, exceptUserId = null) {
  return !!db.prepare('SELECT 1 FROM user_identities WHERE email = ? AND user_id IS NOT ?').get(email, exceptUserId);
}

// Sets (or replaces) the invitation of a person who is not linked yet.
function upsertInvite(db, { organizationId, userId, email }) {
  const existing = db.prepare('SELECT id, subject FROM user_identities WHERE user_id = ?').get(userId);
  if (existing && existing.subject) throw new ServiceError(400, 'This person already linked a Google account. They unlink it themselves');
  if (emailTaken(db, email, userId)) throw new ServiceError(409, 'That Google email is already used for another member');
  if (existing) db.prepare('UPDATE user_identities SET email = ? WHERE id = ?').run(email, existing.id);
  else db.prepare("INSERT INTO user_identities (user_id, organization_id, provider, email) VALUES (?, ?, 'google', ?)").run(userId, organizationId, email);
}

module.exports = { cleanGoogleEmail, emailTaken, upsertInvite };
