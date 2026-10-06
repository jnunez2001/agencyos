-- Joshua Nunez
-- Client retainers: hours a client has paid for each period. Deactivated, never deleted.

CREATE TABLE client_retainers (
  id               INTEGER PRIMARY KEY,
  organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period           TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly')),
  hours_allocated  REAL NOT NULL CHECK (hours_allocated > 0 AND hours_allocated <= 10000),
  start_date       TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_retainers_org ON client_retainers(organization_id, client_id);
-- One active retainer per client.
CREATE UNIQUE INDEX idx_retainers_one_active ON client_retainers(organization_id, client_id) WHERE is_active = 1;
