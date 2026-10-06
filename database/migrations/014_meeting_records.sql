-- Joshua Nunez
-- Client requests, decisions and follow-ups, each able to point back at the meeting note it came from.

CREATE TABLE client_requests (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','approved','in_progress','waiting','completed','rejected')),
  requested_by     TEXT NOT NULL DEFAULT '' CHECK (length(requested_by) <= 120),
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source_note_id   INTEGER REFERENCES meeting_notes(id) ON DELETE SET NULL,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_requests_org ON client_requests(organization_id, status);
CREATE INDEX idx_requests_client ON client_requests(organization_id, client_id);

CREATE TABLE decisions (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details          TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 10000),
  decided_on       TEXT NOT NULL CHECK (decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
  source_note_id   INTEGER REFERENCES meeting_notes(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_decisions_org ON decisions(organization_id, decided_on);

CREATE TABLE follow_ups (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details          TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 10000),
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  assignee_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  completed_at     TEXT,
  source_note_id   INTEGER REFERENCES meeting_notes(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_followups_org ON follow_ups(organization_id, status, due_date);
CREATE INDEX idx_followups_assignee ON follow_ups(organization_id, assignee_id);
