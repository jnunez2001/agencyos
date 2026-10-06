# Roadmap step 1: Calendar

Joshua Nunez. Approved in chat 2026-10-06 (UTC storage, shown in each browser's time zone; no recurring events yet).

## What it is
One agency calendar: Day, Week, Month and Agenda views, filtered to My (events I attend, tasks assigned to me), Team (everything) or one Client.

## Data (migration 012)
- `events`: title, type, starts_at, ends_at, all_day, location, notes, status (scheduled, completed, cancelled), client_id, project_id, task_id, meeting_note_id (reserved for step 2), created_by.
- `event_attendees`: event_id, user_id.
- Types: client_meeting, internal_meeting, team_meeting, deadline, follow_up, review, sop_review, training, blocked_time.
- Timed events are stored as UTC (`YYYY-MM-DDTHH:MM:SSZ`). All-day events store dates (`YYYY-MM-DD`, end inclusive).
- Task and project due dates appear on the calendar as read-only deadline items. They are not copied.

## Links
A task sets its project and client. A project sets its client. Links must belong to the same agency and agree with each other.

## Permissions
- `events.view`: everyone. Owner, Admin, Manager and Employee see the whole agency calendar. A Contractor sees only events they attend or created, and deadlines of their own tasks.
- `events.manage`: Manager and above create, change, cancel and delete any event.
- `events.own`: everyone may create Blocked Time for themselves, and change or delete the events they created that way.
- Link names (client, project) are hidden from people who cannot see clients.

## API
`GET /api/calendar?from&to&clientId&userId` (dates, the browser pads one day for its time zone), `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/:id`.

## AI
Read: `list_events`, `get_event`. Write through plans (ask first): `create_event`, `update_event`. AI never deletes.

## Not in this step
Recurring events, email invites, Google Calendar sync, meeting notes (step 2).
