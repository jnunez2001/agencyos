-- Joshua Nunez
-- Phase 1: organizations, users, roles, employee profiles, sessions, login throttling, activity log.

CREATE TABLE organizations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  timezone    TEXT NOT NULL DEFAULT 'Asia/Manila',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  username              TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 40),
  display_name          TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  password_hash         TEXT NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A user belongs to one organization in this phase (user_id is unique). A later phase can lift that.
CREATE TABLE organization_members (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('owner','admin','manager','employee','contractor')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);

CREATE TABLE employee_profiles (
  id                    INTEGER PRIMARY KEY,
  organization_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id               INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  job_title             TEXT NOT NULL DEFAULT '' CHECK (length(job_title) <= 60),
  department            TEXT NOT NULL DEFAULT '' CHECK (length(department) <= 60),
  timezone              TEXT NOT NULL DEFAULT 'Asia/Manila',
  work_days             TEXT NOT NULL DEFAULT '1,2,3,4,5',
  work_start            TEXT NOT NULL DEFAULT '09:00',
  work_end              TEXT NOT NULL DEFAULT '17:00',
  weekly_capacity_hours INTEGER NOT NULL DEFAULT 40 CHECK (weekly_capacity_hours BETWEEN 0 AND 168),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_profiles_org ON employee_profiles(organization_id);

CREATE TABLE sessions (
  id               INTEGER PRIMARY KEY,
  token_hash       TEXT NOT NULL UNIQUE,
  csrf_token       TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ip               TEXT,
  user_agent       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at       TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_login_attempts_key ON login_attempts(key, created_at);

-- Who did what, to which record, when, from where. Every important action writes one row in the same transaction as the change.
CREATE TABLE activity_logs (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,
  object_type      TEXT,
  object_id        INTEGER,
  before_json      TEXT,
  after_json       TEXT,
  source           TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','api','ai','system')),
  ip               TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_activity_org ON activity_logs(organization_id, created_at);
