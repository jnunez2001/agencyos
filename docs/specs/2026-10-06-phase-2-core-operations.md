# Phase 2: Core operations

Approved by Josh on 2026-10-06. Clients, projects, tasks, work views and a working dashboard. It builds on Phase 1 (login, roles, team, activity log). It does not build SOPs, QA, calendar, time tracking, reports, AI, API keys, MCP or the client portal.

## Stack and rules

Unchanged from Phase 1: Node, Express, SQLite, plain JavaScript pages, no build step. Every table has `organization_id`. Every service function takes a context (`{ organizationId, actor: { id, role }, ip, source }`), checks permission first, and scopes every query by the organization. Another agency's record is "not found". Every create, change and delete writes one activity row in the same transaction, with only the changed fields.

## Data (migration 002)

- `clients`: name (unique per agency, ignoring case), status (`active`, `paused`, `archived`), website, industry, notes.
- `client_contacts`: client, name, email, phone, role title, primary flag. One primary contact at most per client.
- `projects`: client, name, description, status (`planning`, `active`, `on_hold`, `completed`, `archived`), start date, due date, manager (a team member).
- `tasks`: project, title, description, status (`todo`, `in_progress`, `review`, `done`), priority (`low`, `normal`, `high`, `urgent`), assignee (a team member, optional), due date, estimate in hours, completed time (set when it moves to `done`, cleared when it moves out).
- `task_comments`: task, author, body.

Dates are plain calendar dates (`YYYY-MM-DD`), checked to be real dates. "Today" is worked out in the agency's timezone.

## Rules

- An assignee or project manager must be an active member of the same agency.
- A project needs a client, and a task needs a project, all in the same agency.
- No new projects on an archived client, and no new tasks in an archived project.
- A due date before a start date is refused.
- Deleting a client or project is not offered. They are archived. A task can be deleted, and the activity log keeps what it was.

## Who may do what

| Action | Owner | Admin | Manager | Employee | Contractor |
|---|---|---|---|---|---|
| See clients and projects | yes | yes | yes | yes | no |
| Add, edit and archive clients, contacts, projects | yes | yes | yes | no | no |
| See tasks | all | all | all | all | only tasks assigned to them |
| Add, edit, assign and delete tasks | yes | yes | yes | no | no |
| Change status of a task assigned to them | yes | yes | yes | yes | yes |
| Comment on a task they can see | yes | yes | yes | yes | yes |
| Agency totals on the dashboard | yes | yes | yes | yes | no |
| Team workload on the dashboard | yes | yes | yes | no | no |

A Contractor never learns about a task that is not assigned to them: it is "not found", also in comments and counts.

## API

All under `/api`, same session and CSRF rules.

- `GET /clients?status=`, `POST /clients`, `GET /clients/:id` (with contacts and projects), `PATCH /clients/:id`
- `POST /clients/:id/contacts`, `PATCH /contacts/:id`, `DELETE /contacts/:id`
- `GET /projects?clientId=&status=`, `POST /projects`, `GET /projects/:id` (with task counts), `PATCH /projects/:id`
- `GET /tasks?projectId=&assigneeId=&status=&mine=1&overdue=1&q=`, `POST /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
- `GET /tasks/:id/comments`, `POST /tasks/:id/comments`
- `GET /dashboard` gains `work` (my open, overdue and due-soon tasks), `agency` (totals) and `workload` (per person against weekly capacity).

A person who may only change status (Employee or Contractor on their own task) is refused if the request changes anything else.

## Screens

- Dashboard: my work first (overdue, due in the next 7 days), then agency totals, then team workload for Managers and above.
- Tasks: a list and a board by status, with filters (mine, project, assignee, status, overdue, search). A task opens in a sheet with details, status, assignee, due date and comments.
- Projects: list by client and status. A project page shows its details and its tasks.
- Clients: list with a status filter. A client page shows details, contacts and projects.
- The sidebar shows Tasks, Projects and Clients only to roles that may use them.

## Testing

Test first. Groups: organization isolation for every new record, the permission table above, the Contractor scoping, the validation rules, the activity rows, the HTTP layer, the dashboard numbers (with a fixed "today"), and front-end smoke tests for every new screen and sheet as Owner, Employee and Contractor.

## Out of scope

Recurring tasks, subtasks, task dependencies, attachments, tags, drag and drop on the board (status is changed from the task sheet), time tracking, notifications.
