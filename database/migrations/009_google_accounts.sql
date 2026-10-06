-- Joshua Nunez
-- Phase 7b: connected Google accounts (sign in with Google). Only a refresh token is kept, encrypted with a key that
-- lives outside the database. A client's Google link names the account it uses (NULL means the service account).

CREATE TABLE google_accounts (
  id                 INTEGER PRIMARY KEY,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email              TEXT NOT NULL COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 200),
  refresh_token_enc  TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','needs_reconnect')),
  connected_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  connected_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, email)
);

ALTER TABLE client_google ADD COLUMN google_account_id INTEGER REFERENCES google_accounts(id) ON DELETE CASCADE;
