-- Joshua Nunez
-- Phase 3b: OAuth sign-in for claude.ai connectors. A connected app is an ordinary api_keys row (kind 'oauth'),
-- so it is listed, limited and revoked like any key. Codes and tokens are stored only as hashes.

ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'key' CHECK (kind IN ('key','oauth'));

CREATE TABLE oauth_clients (
  client_id      TEXT PRIMARY KEY,
  client_name    TEXT NOT NULL,
  redirect_uris  TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A sign-in waiting for the person to approve it in the app.
CREATE TABLE oauth_requests (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  state           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at      TEXT NOT NULL
);

-- An approved sign-in waiting for the app to exchange it for tokens.
CREATE TABLE oauth_codes (
  code_hash        TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri     TEXT NOT NULL,
  code_challenge   TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  access           TEXT NOT NULL CHECK (access IN ('read','propose','direct')),
  expires_at       TEXT NOT NULL
);

-- One row per connection. The previous refresh token is kept so that using it again can be spotted.
CREATE TABLE oauth_tokens (
  id                     INTEGER PRIMARY KEY,
  key_id                 INTEGER NOT NULL UNIQUE REFERENCES api_keys(id) ON DELETE CASCADE,
  client_id              TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  access_hash            TEXT NOT NULL UNIQUE,
  access_expires_at      TEXT NOT NULL,
  refresh_hash           TEXT NOT NULL UNIQUE,
  refresh_expires_at     TEXT NOT NULL,
  previous_refresh_hash  TEXT
);
CREATE INDEX idx_oauth_previous ON oauth_tokens(previous_refresh_hash);
