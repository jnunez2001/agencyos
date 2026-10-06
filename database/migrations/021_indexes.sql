-- Joshua Nunez
-- Indexes for the main lists and dashboards, found with scripts/perf-check.js (EXPLAIN QUERY PLAN on a few thousand
-- rows). Each one removes a full scan of a big table or the sort that follows it. Only CREATE INDEX IF NOT EXISTS, so
-- it is safe to run twice and changes no data.

-- Tasks due in a window or overdue (dashboard, workspace, capacity, calendar deadlines).
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(organization_id, due_date);

-- Time entries for a date range across the team, already in the order the list shows them.
CREATE INDEX IF NOT EXISTS idx_time_org_date ON time_entries(organization_id, entry_date, id);

-- Client requests newest first, the requests a person handles, the request behind a task, and the records made from a note.
CREATE INDEX IF NOT EXISTS idx_requests_org_id ON client_requests(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_requests_owner ON client_requests(organization_id, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_task ON client_requests(organization_id, task_id);
CREATE INDEX IF NOT EXISTS idx_requests_note ON client_requests(organization_id, source_note_id);
CREATE INDEX IF NOT EXISTS idx_decisions_note ON decisions(organization_id, source_note_id);
CREATE INDEX IF NOT EXISTS idx_followups_note ON follow_ups(organization_id, source_note_id);

-- Decisions and follow-ups of one client.
CREATE INDEX IF NOT EXISTS idx_decisions_client ON decisions(organization_id, client_id, decided_on);
CREATE INDEX IF NOT EXISTS idx_followups_client ON follow_ups(organization_id, client_id);

-- The activity log newest first, by action, by person and by the record it is about.
CREATE INDEX IF NOT EXISTS idx_activity_org_id ON activity_logs(organization_id, id);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs(organization_id, action, id);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(organization_id, actor_user_id, id);
CREATE INDEX IF NOT EXISTS idx_activity_object ON activity_logs(organization_id, object_type, object_id);

-- The calendar and the workspace look events up by the day they start and end (the first ten characters of the time).
CREATE INDEX IF NOT EXISTS idx_events_org_start_day ON events(organization_id, substr(starts_at, 1, 10));
CREATE INDEX IF NOT EXISTS idx_events_org_end_day ON events(organization_id, substr(ends_at, 1, 10));

-- What a Contractor may see is what they created or attend.
CREATE INDEX IF NOT EXISTS idx_events_creator ON events(organization_id, created_by);
CREATE INDEX IF NOT EXISTS idx_notes_creator ON meeting_notes(organization_id, created_by);
