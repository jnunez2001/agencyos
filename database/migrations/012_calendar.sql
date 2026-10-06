-- Joshua Nunez
-- Calendar: events and who attends them. Every table carries organization_id.

CREATE TABLE events (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  type             TEXT NOT NULL CHECK (type IN ('client_meeting','internal_meeting','team_meeting','deadline','follow_up','review','sop_review','training','blocked_time')),
  starts_at        TEXT NOT NULL CHECK (length(starts_at) IN (10, 20)),
  ends_at          TEXT NOT NULL CHECK (length(ends_at) IN (10, 20)),
  all_day          INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
  location         TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 300),
  notes            TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 10000),
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  meeting_note_id  INTEGER,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_org_start ON events(organization_id, starts_at);
CREATE INDEX idx_events_client ON events(organization_id, client_id);

CREATE TABLE event_attendees (
  event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_event_attendees_user ON event_attendees(user_id);
