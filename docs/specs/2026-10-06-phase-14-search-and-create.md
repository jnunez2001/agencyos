# Global search and global Create

Joshua Nunez. Two shortcuts in the app shell: find anything from one box, and start anything from one button.

## Search
- `server/services/search.js`: `search(db, ctx, q, { limit })`. API `GET /api/search?q=`. MCP read tool `search_agency` (arguments `q`, optional `limit`).
- The text must be at least 2 characters (after trimming) and is cut at 100. Each group returns at most 8 results. Wildcard characters `%` and `_` are searched as plain text.
- Groups: clients, projects, tasks, SOPs, meeting notes, client requests, decisions, follow-ups, events, team members. A group with no match is left out.
- Each result is `{ type, id, title, subtitle, hash }`. `hash` is the front-end route that opens it: `#/clients/ID`, `#/projects/ID`, `#/tasks/ID`, `#/sops/ID`, `#/meetings/ID`, `#/requests/ID`, `#/decisions/ID`, `#/follow-ups/ID`, `#/calendar/ID`, `#/team`.
- Visibility is exactly the owning service's. Groups use the service's own list function wherever it can search (tasks, SOPs, meeting notes, requests, decisions, follow-ups); clients, projects and team members use the service's list and are filtered here; events apply the calendar's rule (a Contractor sees only events they attend or created).
- A role that may not view a kind gets no group for it. A Contractor therefore sees only their own tasks, events they attend or created, notes they wrote or attend, and follow-ups assigned to them; nothing from clients, projects, SOPs, requests, decisions or the team.
- Every query is scoped by organization, so another agency's records never appear.

## Screen
- A search button in the sidebar head (desktop) and the top bar (phone) opens a Search sheet. The `/` key opens it from anywhere that is not a text field. Results update as the person types; Enter opens the first result, Escape closes.

## Create
- A Create button beside search opens a menu of what this role may create, from the `can` map: event (events.view; Employees and Contractors may only block their own time), meeting notes (notes.view), client request (requests.create), follow-up (followups.create), task (tasks.manage), project (projects.manage), client (clients.manage), decision (decisions.manage).
- It opens the existing forms. Requests, follow-ups and decisions use small forms in `public/js/views/createforms.js`, posting to `/api/requests`, `/api/follow-ups` and `/api/decisions`.
- The server stays the judge: the menu only hides what the server would refuse.
