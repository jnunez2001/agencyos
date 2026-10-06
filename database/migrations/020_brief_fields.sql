-- Joshua Nunez
-- Fields the brief asked for: more meeting note sections, who was involved in a decision, priority and source on client
-- requests, priority and links to a request and a task on follow-ups. Columns are only added; nothing is rebuilt.
ALTER TABLE meeting_notes ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (length(purpose) <= 5000);
ALTER TABLE meeting_notes ADD COLUMN risks TEXT NOT NULL DEFAULT '' CHECK (length(risks) <= 10000);
ALTER TABLE meeting_notes ADD COLUMN important_context TEXT NOT NULL DEFAULT '' CHECK (length(important_context) <= 10000);
ALTER TABLE meeting_notes ADD COLUMN sop_impact TEXT NOT NULL DEFAULT '' CHECK (length(sop_impact) <= 10000);
ALTER TABLE meeting_notes ADD COLUMN next_meeting TEXT NOT NULL DEFAULT '' CHECK (length(next_meeting) <= 5000);

ALTER TABLE decisions ADD COLUMN people_involved TEXT NOT NULL DEFAULT '' CHECK (length(people_involved) <= 500);

ALTER TABLE client_requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE client_requests ADD COLUMN source TEXT NOT NULL DEFAULT '' CHECK (length(source) <= 200);
ALTER TABLE client_requests ADD COLUMN received_on TEXT CHECK (received_on IS NULL OR received_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
UPDATE client_requests SET received_on = substr(created_at, 1, 10) WHERE received_on IS NULL;

ALTER TABLE follow_ups ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent'));
ALTER TABLE follow_ups ADD COLUMN request_id INTEGER REFERENCES client_requests(id) ON DELETE SET NULL;
ALTER TABLE follow_ups ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
