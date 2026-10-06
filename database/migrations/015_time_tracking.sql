-- Joshua Nunez
-- Time tracking: one row per logged piece of time. A timer is a draft entry whose timer_state is running or paused.
-- Every table carries organization_id.

CREATE TABLE time_entries (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date       TEXT NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  minutes          INTEGER NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  started_at       TEXT CHECK (started_at IS NULL OR length(started_at) = 20),
  ended_at         TEXT CHECK (ended_at IS NULL OR length(ended_at) = 20),
  client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  time_type        TEXT NOT NULL DEFAULT 'billable' CHECK (time_type IN ('billable','non_billable','internal','meeting','training','admin')),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','locked')),
  reviewer_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TEXT,
  review_note      TEXT NOT NULL DEFAULT '' CHECK (length(review_note) <= 1000),
  locked_at        TEXT,
  timer_state      TEXT NOT NULL DEFAULT 'none' CHECK (timer_state IN ('none','running','paused')),
  timer_started_at TEXT,
  elapsed_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_time_user_date ON time_entries(organization_id, user_id, entry_date);
CREATE INDEX idx_time_status ON time_entries(organization_id, status);
CREATE INDEX idx_time_client ON time_entries(organization_id, client_id, entry_date);
CREATE INDEX idx_time_task ON time_entries(organization_id, task_id);
-- One timer per person at a time (running or paused).
CREATE UNIQUE INDEX idx_time_one_timer ON time_entries(organization_id, user_id) WHERE timer_state != 'none';
