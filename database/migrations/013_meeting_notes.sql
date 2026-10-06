-- Joshua Nunez
-- Structured meeting notes. Every table carries organization_id.

CREATE TABLE meeting_notes (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  meeting_date     TEXT NOT NULL CHECK (meeting_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  summary          TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 5000),
  agenda           TEXT NOT NULL DEFAULT '' CHECK (length(agenda) <= 10000),
  discussion       TEXT NOT NULL DEFAULT '' CHECK (length(discussion) <= 20000),
  decisions        TEXT NOT NULL DEFAULT '' CHECK (length(decisions) <= 10000),
  requests         TEXT NOT NULL DEFAULT '' CHECK (length(requests) <= 10000),
  follow_ups       TEXT NOT NULL DEFAULT '' CHECK (length(follow_ups) <= 10000),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  event_id         INTEGER REFERENCES events(id) ON DELETE SET NULL,
  client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finalized_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finalized_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notes_org_date ON meeting_notes(organization_id, meeting_date);
CREATE INDEX idx_notes_client ON meeting_notes(organization_id, client_id);
CREATE UNIQUE INDEX idx_notes_event ON meeting_notes(event_id) WHERE event_id IS NOT NULL;
