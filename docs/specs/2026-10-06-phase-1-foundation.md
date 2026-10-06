# Phase 1: Foundation

Approved by Josh on 2026-10-06. This phase builds login, organizations, roles, the team, the audit log and the app shell. It does not build clients, projects, tasks or anything after them.

## Scope

You and a few team members, in one agency. Every record still belongs to an organization, so more agencies stay possible later.

## Stack

Plain Node 22 or newer, Express, SQLite (better-sqlite3), plain JavaScript web pages with no build step, and Node's built-in test runner. The same patterns as Family Money OS. It must run on a small server with 1 GB of memory.

## Organizations and isolation

- Every table that belongs to an organization has an `organization_id`.
- All service functions take the organization id explicitly and filter every query by it.
- A user belongs to one organization in this phase (`organization_members.user_id` is unique). A later phase can lift this.
- Tests prove that a second organization cannot read, change or list the first organization's members, profiles or activity.

## Accounts and login

- First run: one-time setup creates the organization and the Owner. A setup code (`SETUP_TOKEN`) is required when the server sets one.
- Team members are created by an Owner or Admin with a username and a temporary password. They must change it at first login (`must_change_password`). No email is sent.
- Passwords: scrypt, 10 characters minimum.
- Sessions: server-side, random token stored only as a hash, HttpOnly and SameSite cookie, per-session CSRF header on every state-changing request.
- Login throttling by username and by IP. Wrong username and wrong password give the same message and take the same time.
- Deactivating a member ends all of their sessions at once. Role changes apply at once (the role is read on every request).

## Roles

Owner, Admin, Manager, Employee, Contractor. Rank: Owner 5, Admin 4, Manager 3, Employee 2, Contractor 1. The Client role comes with the client portal in a later phase.

One function, `can(role, action)`, decides what each role may do, and the server checks it on every request. The screens only hide what the server would refuse.

| Action | Owner | Admin | Manager | Employee | Contractor |
|---|---|---|---|---|---|
| View organization | yes | yes | yes | yes | yes |
| Change organization name and timezone | yes | yes | no | no | no |
| See the team list | yes | yes | yes | yes | no |
| Add a member | yes | yes | no | no | no |
| Change a member's role, deactivate, reset password | yes | yes | no | no | no |
| Edit another member's profile | yes | yes | no | no | no |
| Edit own profile and password | yes | yes | yes | yes | yes |
| See the activity log | yes | yes | no | no | no |
| See the dashboard team summary | yes | yes | yes | no | no |

Management rules for roles, deactivating and password resets:
- An actor can act on a member only if the actor's rank is higher than the member's rank, or the actor is an Owner.
- An actor can assign only roles below their own rank, except an Owner, who can assign any role.
- Nobody can deactivate themselves. The organization always keeps at least one active Owner.

## Data (migration 001)

`organizations`, `users`, `organization_members` (role), `employee_profiles` (job title, department, timezone, working days and hours, weekly capacity in hours), `sessions`, `login_attempts`, `activity_logs`.

`activity_logs` records: organization, actor, action, object type and id, before and after (JSON), source (`web`, `api`, `ai` or `system`), IP and time. Every important action writes one row in the same transaction as the change.

## API

All under `/api`, JSON, session cookie and CSRF header.

- `GET /status`, `POST /setup`, `POST /login`, `POST /logout`, `GET /session`, `POST /password`
- `GET /org`, `PATCH /org`
- `GET /members`, `POST /members`, `PATCH /members/:id`, `POST /members/:id/reset-password`, `PATCH /members/:id/profile`
- `GET /profile`, `PATCH /profile`
- `GET /activity`
- `GET /dashboard`

Errors are plain messages. A cross-organization id gets the same "not found" as a missing one.

## Screens

Setup, login, forced password change, Dashboard (greeting and team summary), Team (list, add, change role, deactivate, reset password), My profile (password, working hours), Settings (organization), Activity (filters). The sidebar shows only the modules that exist.

## Look and feel

Clean and minimal: lots of white space, ink and white with one calm indigo accent, light and dark modes, desktop first and usable on a phone. No walls of cards.

## Testing

Test first. Required test groups: organization isolation, the permission matrix, the management rules, login and sessions, the audit log, and a front-end smoke test that loads every screen and sheet with a stub server and fails on any error or on stray text such as `false` or `undefined`.

## Out of scope

Clients, projects, tasks, SOPs, calendar, time tracking, reports, AI, API keys, MCP, integrations, email, client portal.

## Hosting

Decided later. Build and test on the Mac. See `docs/decisions.md`.
