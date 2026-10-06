-- Joshua Nunez
-- SOP change requests: a reviewed way to change an SOP. Publishing one adds a new SOP version, it never edits an old one.
-- Every table carries organization_id.

CREATE TABLE sop_change_requests (
  id                    INTEGER PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sop_id                INTEGER NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details               TEXT NOT NULL CHECK (length(details) BETWEEN 1 AND 10000),
  proposed_text         TEXT NOT NULL DEFAULT '' CHECK (length(proposed_text) <= 10000),
  proposed_content_json TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status                TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified','needs_review','approved','in_progress','testing','published','rejected')),
  source_type           TEXT CHECK (source_type IS NULL OR source_type IN ('task','qa_review','meeting_note','follow_up')),
  source_id             INTEGER,
  rejected_reason       TEXT NOT NULL DEFAULT '' CHECK (length(rejected_reason) <= 2000),
  reviewed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           TEXT,
  published_version_id  INTEGER REFERENCES sop_versions(id) ON DELETE SET NULL,
  published_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at          TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((source_type IS NULL) = (source_id IS NULL))
);
CREATE INDEX idx_sopchange_org ON sop_change_requests(organization_id, status);
CREATE INDEX idx_sopchange_sop ON sop_change_requests(organization_id, sop_id);
CREATE INDEX idx_sopchange_creator ON sop_change_requests(organization_id, created_by);
