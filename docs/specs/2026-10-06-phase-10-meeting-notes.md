# Roadmap step 2: Structured meeting notes

Joshua Nunez. Goes with the calendar: a note belongs to an event (optional) and keeps the event's `meeting_note_id` in step.

## Data (migration 013)
`meeting_notes`: title, meeting_date, summary, agenda, discussion, decisions, requests, follow_ups (plain text sections that steps 3 to 6 turn into records), status (draft, final), event_id, client_id, project_id, created_by, finalized_by, finalized_at.
One note per event. A note made from an event takes its title, date, client and project unless given.

## Rules
- View: Owner to Employee see all notes. A Contractor sees notes of events they attend and notes they wrote.
- Write: Managers and above any note. Anyone who attends the linked event, or wrote the note, may write it while it is a draft.
- Final: only Managers and above set a note to final; a final note can only be changed by them. Reopening to draft is also theirs.
- Delete: Managers and above, person only. AI never deletes and never sets final.
- Everything logs to the activity log.

## Surfaces
API `/api/meeting-notes`, a Meetings screen (list, filters, note page, form), an "Add meeting notes" button on an event, MCP tools `list_meeting_notes`, `get_meeting_note`, plans `create_meeting_note`, `update_meeting_note`.
