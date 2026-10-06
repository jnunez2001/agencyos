-- Joshua Nunez
-- Notifications: what a person must act on. Every row belongs to one person of one agency.

CREATE TABLE notifications (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 60),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body             TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  link             TEXT CHECK (link IS NULL OR length(link) <= 200),
  object_type      TEXT,
  object_id        INTEGER,
  dedupe_key       TEXT,
  read_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_user ON notifications(organization_id, user_id, read_at, id);
CREATE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key);
