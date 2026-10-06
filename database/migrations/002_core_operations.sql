-- Joshua Nunez
-- Phase 2: clients, contacts, projects, tasks, task comments. Every table carries organization_id.

CREATE TABLE clients (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 1 AND 100),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  website          TEXT NOT NULL DEFAULT '' CHECK (length(website) <= 200),
  industry         TEXT NOT NULL DEFAULT '' CHECK (length(industry) <= 80),
  notes            TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (organization_id, name)
);
CREATE INDEX idx_clients_org ON clients(organization_id, status);

CREATE TABLE client_contacts (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email            TEXT NOT NULL DEFAULT '' CHECK (length(email) <= 120),
  phone            TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  role_title       TEXT NOT NULL DEFAULT '' CHECK (length(role_title) <= 80),
  is_primary       INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_contacts_client ON client_contacts(organization_id, client_id);

CREATE TABLE projects (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  status           TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','on_hold','completed','archived')),
  start_date       TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  manager_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_projects_org ON projects(organization_id, status);
CREATE INDEX idx_projects_client ON projects(organization_id, client_id);

CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description      TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status           TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  estimate_hours   REAL CHECK (estimate_hours IS NULL OR (estimate_hours >= 0 AND estimate_hours <= 1000)),
  completed_at     TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tasks_org ON tasks(organization_id, status);
CREATE INDEX idx_tasks_project ON tasks(organization_id, project_id);
CREATE INDEX idx_tasks_assignee ON tasks(organization_id, assignee_id, status);

CREATE TABLE task_comments (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_comments_task ON task_comments(organization_id, task_id);
