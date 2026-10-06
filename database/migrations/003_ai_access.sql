-- Joshua Nunez
-- Phase 3: API keys for AI access and the AI inbox (proposed changes waiting for a person).

CREATE TABLE api_keys (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  access           TEXT NOT NULL CHECK (access IN ('read','propose','direct')),
  token_hash       TEXT NOT NULL UNIQUE,
  prefix           TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at     TEXT,
  revoked_at       TEXT
);
CREATE INDEX idx_api_keys_org ON api_keys(organization_id);

CREATE TABLE ai_proposals (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id       INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary          TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 300),
  steps_json       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','failed')),
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at       TEXT
);
CREATE INDEX idx_proposals_org ON ai_proposals(organization_id, status);
