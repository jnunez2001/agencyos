# Roadmap steps 3 to 6: Meeting records (decisions, client requests, follow-ups)

Joshua Nunez. Step 3 (meeting to records) needs the records themselves, so the three first-class records of steps 4, 5 and 6 are built with it, kept lean.

## Records (migration 014)
- `client_requests`: title, description, status (new, reviewing, approved, in_progress, waiting, completed, rejected), client (required), project, requested_by (text), due date, owner, source note, linked task.
- `decisions`: title, details, decided_on, status (active, reversed), client, project, source note.
- `follow_ups`: title, details, due date, assignee, status (open, done, cancelled), client, project, source note.

## From a meeting note
"Create records" on a note turns each line of its Decisions, Requests and Follow-ups sections into a record linked to the note. Lines already turned into a record (same note and title) are skipped, so it is safe to press twice. Requests need the note to have a client. Managers and above only; AI may do it through plans.

## Convert to Task
A Manager turns a request into a task in a project (the request's project or one chosen). The request keeps `task_id`, moves to In progress, and shows the task's status. Nothing is copied back: the task stays a normal task.

## Permissions
- Requests: Owner to Employee view and add; Employees edit their own while New or Reviewing and may only use New or Reviewing; Managers set any status, convert, delete.
- Decisions: Owner to Employee view; Managers write and delete.
- Follow-ups: Owner to Employee view and add; the assignee, creator and Managers change them; a Contractor sees only follow-ups assigned to them. Managers delete.
- Open follow-ups with a due date show on the calendar as deadlines.
- Everything logs. AI creates and edits through plans; it never deletes, never approves or rejects a request, never converts a request.
