-- Joshua Nunez
-- Phase 7: Google Search Console and Analytics data. A client links one Search Console site and one Analytics
-- property. Synced numbers are results with a source, and a unique index keeps a synced number from duplicating.

CREATE TABLE client_google (
  client_id         INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  organization_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gsc_site_url      TEXT CHECK (gsc_site_url IS NULL OR length(gsc_site_url) BETWEEN 1 AND 300),
  ga4_property_id   TEXT CHECK (ga4_property_id IS NULL OR ga4_property_id GLOB '[0-9]*'),
  connected_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  connected_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sync_at      TEXT,
  last_sync_status  TEXT CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok','partial','failed')),
  last_sync_error   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_client_google_org ON client_google(organization_id);

ALTER TABLE client_results ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gsc','ga4'));
CREATE UNIQUE INDEX idx_results_synced ON client_results(client_id, metric, recorded_on) WHERE source != 'manual';
