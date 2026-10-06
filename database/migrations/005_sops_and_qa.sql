-- Joshua Nunez
-- Phase 4: SOPs with versions, QA records, and the tasks table widened for the new status and the SOP link.
-- The tasks table is rebuilt (SQLite cannot change a CHECK in place), so foreign keys are paused while it runs.
-- agencyos:rebuild

CREATE TABLE sops (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  service          TEXT NOT NULL DEFAULT '' CHECK (length(service) <= 80),
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','testing','approved','deprecated')),
  requires_qa      INTEGER NOT NULL DEFAULT 0 CHECK (requires_qa IN (0,1)),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sops_org ON sops(organization_id, status);

-- Every version is kept. Content is never overwritten.
CREATE TABLE sop_versions (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sop_id           INTEGER NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
  major            INTEGER NOT NULL CHECK (major >= 1),
  minor            INTEGER NOT NULL CHECK (minor >= 0),
  purpose          TEXT NOT NULL DEFAULT '' CHECK (length(purpose) <= 5000),
  when_to_use      TEXT NOT NULL DEFAULT '' CHECK (length(when_to_use) <= 5000),
  inputs           TEXT NOT NULL DEFAULT '' CHECK (length(inputs) <= 5000),
  steps_json       TEXT NOT NULL DEFAULT '[]',
  checklist_json   TEXT NOT NULL DEFAULT '[]',
  expected_output  TEXT NOT NULL DEFAULT '' CHECK (length(expected_output) <= 5000),
  common_mistakes  TEXT NOT NULL DEFAULT '' CHECK (length(common_mistakes) <= 5000),
  examples         TEXT NOT NULL DEFAULT '' CHECK (length(examples) <= 5000),
  change_note      TEXT NOT NULL DEFAULT '' CHECK (length(change_note) <= 500),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (sop_id, major, minor)
);
CREATE INDEX idx_sop_versions_sop ON sop_versions(organization_id, sop_id);

CREATE TABLE tasks_new (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status           TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','changes','done')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  estimate_hours   REAL CHECK (estimate_hours IS NULL OR (estimate_hours >= 0 AND estimate_hours <= 1000)),
  completed_at     TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sop_id           INTEGER REFERENCES sops(id) ON DELETE SET NULL,
  sop_version_id   INTEGER REFERENCES sop_versions(id) ON DELETE SET NULL,
  qa_required      INTEGER NOT NULL DEFAULT 0 CHECK (qa_required IN (0,1))
);
INSERT INTO tasks_new (id, organization_id, project_id, title, description, status, priority, assignee_id, due_date, estimate_hours, completed_at, created_by, created_at, updated_at)
  SELECT id, organization_id, project_id, title, description, status, priority, assignee_id, due_date, estimate_hours, completed_at, created_by, created_at, updated_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX idx_tasks_org ON tasks(organization_id, status);
CREATE INDEX idx_tasks_project ON tasks(organization_id, project_id);
CREATE INDEX idx_tasks_assignee ON tasks(organization_id, assignee_id, status);
CREATE INDEX idx_tasks_sop ON tasks(organization_id, sop_id);

-- One record per submission for QA. The checklist is a snapshot of the SOP's quality checklist at that moment.
CREATE TABLE qa_reviews (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','changes_requested','withdrawn')),
  checklist_json   TEXT NOT NULL DEFAULT '[]',
  comments         TEXT NOT NULL DEFAULT '' CHECK (length(comments) <= 5000),
  reviewed_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TEXT
);
CREATE INDEX idx_qa_org ON qa_reviews(organization_id, status);
CREATE INDEX idx_qa_task ON qa_reviews(organization_id, task_id);
