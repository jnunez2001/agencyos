-- Joshua Nunez
-- Phase 8: sign in with Google. An identity ties a person to a Google account by Google's permanent account id.
-- An invitation is an identity with an email and no subject yet; the first sign-in with that email fills it in.

ALTER TABLE users ADD COLUMN password_login INTEGER NOT NULL DEFAULT 1 CHECK (password_login IN (0,1));

CREATE TABLE user_identities (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  subject          TEXT UNIQUE,
  email            TEXT NOT NULL COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 200),
  linked_at        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((subject IS NULL AND linked_at IS NULL) OR (subject IS NOT NULL AND linked_at IS NOT NULL))
);
CREATE UNIQUE INDEX idx_identity_invited_email ON user_identities(email) WHERE subject IS NULL;
CREATE INDEX idx_identity_org ON user_identities(organization_id);
