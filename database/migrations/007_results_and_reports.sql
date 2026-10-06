-- Joshua Nunez
-- Phase 6: recorded results (metrics per client) and reports.

CREATE TABLE client_results (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goal_id          INTEGER REFERENCES client_goals(id) ON DELETE SET NULL,
  metric           TEXT NOT NULL COLLATE NOCASE CHECK (length(metric) BETWEEN 1 AND 80),
  value            REAL NOT NULL,
  unit             TEXT NOT NULL DEFAULT '' CHECK (length(unit) <= 20),
  recorded_on      TEXT NOT NULL CHECK (recorded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note             TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_results_client ON client_results(organization_id, client_id, metric, recorded_on);

CREATE TABLE reports (
  id                 INTEGER PRIMARY KEY,
  organization_id    INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id          INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  period_start       TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end         TEXT NOT NULL CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  executive_summary  TEXT NOT NULL DEFAULT '' CHECK (length(executive_summary) <= 10000),
  work_completed     TEXT NOT NULL DEFAULT '' CHECK (length(work_completed) <= 10000),
  key_results        TEXT NOT NULL DEFAULT '' CHECK (length(key_results) <= 10000),
  important_changes  TEXT NOT NULL DEFAULT '' CHECK (length(important_changes) <= 10000),
  problems_risks     TEXT NOT NULL DEFAULT '' CHECK (length(problems_risks) <= 10000),
  next_priorities    TEXT NOT NULL DEFAULT '' CHECK (length(next_priorities) <= 10000),
  recommendations    TEXT NOT NULL DEFAULT '' CHECK (length(recommendations) <= 10000),
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reports_org ON reports(organization_id, status);
CREATE INDEX idx_reports_client ON reports(organization_id, client_id);
