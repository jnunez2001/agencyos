-- Joshua Nunez
-- Phase 5: services, client goals, and the extra client fields. The clients table is rebuilt for the wider status
-- list, so foreign keys are paused while it runs.
-- agencyos:rebuild

CREATE TABLE services (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 60),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, name)
);

CREATE TABLE clients_new (
  id                INTEGER PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 100),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('lead','onboarding','active','paused','at_risk','completed','archived')),
  website           TEXT NOT NULL DEFAULT '' CHECK (length(website) <= 200),
  industry          TEXT NOT NULL DEFAULT '' CHECK (length(industry) <= 80),
  notes             TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  account_owner_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date        TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  UNIQUE (organization_id, name)
);
INSERT INTO clients_new (id, organization_id, name, status, website, industry, notes, created_by, created_at, updated_at)
  SELECT id, organization_id, name, status, website, industry, notes, created_by, created_at, updated_at FROM clients;
DROP TABLE clients;
ALTER TABLE clients_new RENAME TO clients;
CREATE INDEX idx_clients_org ON clients(organization_id, status);

CREATE TABLE client_services (
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, service_id)
);

CREATE TABLE client_goals (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  why              TEXT NOT NULL DEFAULT '' CHECK (length(why) <= 2000),
  target           TEXT NOT NULL DEFAULT '' CHECK (length(target) <= 200),
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  service_id       INTEGER REFERENCES services(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','dropped')),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_goals_client ON client_goals(organization_id, client_id);

ALTER TABLE projects ADD COLUMN service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN goal_id INTEGER REFERENCES client_goals(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN goal_id INTEGER REFERENCES client_goals(id) ON DELETE SET NULL;
CREATE INDEX idx_projects_goal ON projects(organization_id, goal_id);
CREATE INDEX idx_tasks_goal ON tasks(organization_id, goal_id);
