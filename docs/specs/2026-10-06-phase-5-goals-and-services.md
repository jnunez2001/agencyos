# Phase 5: Client goals and services

Approved by Josh on 2026-10-06 ("yes, goals and services"). Blueprint sections 7, 8 and 10. A goal is why the agency does the work. A task is what it does. Services are configurable, never hard-coded.

## Services

- A list the agency controls: name (unique, ignoring case) and active or not. Nothing is deleted; an inactive service stops appearing in pickers but stays on what already has it.
- Owner and Admin add, rename and deactivate services, from Settings, with a button to add the common ones (SEO, Content Marketing, Web Development, Web Design, Social Media, Paid Ads, Email Marketing, Branding, Graphic Design, Video).
- Everyone except Contractors can read the list.
- A client has any number of services. A project has one optional service. A goal has one optional service. SOP service stays free text in this phase; its form suggests the service names.

## Goals

- A goal belongs to a client: the statement ("Increase qualified organic leads", up to 200 characters), the reason why (optional), a target ("50 qualified leads a month", optional), a target date (optional), a service (optional), and a status: `active`, `achieved` or `dropped`.
- A project can say which goal it supports. A task can too, or inherits its project's goal. The goal must belong to the same client as the project (and the task's project). Only an active goal can be newly linked.
- A goal shows progress: how many of its tasks are done, and how many projects support it. A task counts for a goal when its own goal, or else its project's goal, is that goal.
- Who: Owner, Admin and Manager add and change goals. Everyone who can see clients sees them. Goals are not deleted; they are dropped.

## Client fields

- New statuses (blueprint): `lead`, `onboarding`, `active`, `paused`, `at_risk`, `completed`, `archived`. "Current" means lead, onboarding, active or at risk.
- New fields: account owner (a team member) and start date.
- No new project on an archived client (unchanged).

## Screens

- Client page: Goals (with progress, target, date, status, service), services as labels, account owner, start date. The client form gets status, services, account owner and start date. A goal sheet adds and edits goals.
- Project form: service and goal (the goals of the project's client). Task form: goal.
- Clients list: filters Current, Paused, Past (completed or archived), All.
- Settings: Services for Owner and Admin.

## AI and MCP

Read tools `list_services` and `list_goals`; `get_client` includes goals. Plan actions `create_goal` and `update_goal`, and `serviceIds`, `accountOwnerId`, `startDate` on clients, `serviceId` and `goalId` on projects, `goalId` on tasks. Adding or changing services themselves stays with Owner and Admin in Settings, not the AI.

## Data (migration 006)

`services`, `client_services`, `client_goals`; `service_id` and `goal_id` on projects; `goal_id` on tasks; the clients table rebuilt for the wider status list and the new columns. Tested against data from the previous schema.

## Testing

Test first: the migration with existing data, service rules and permissions, goal rules (same client, status, progress, isolation), the client extras and statuses, project and task links, the HTTP routes, the AI actions and tools, and smoke tests for every new screen and sheet.

## Out of scope

Results and KPIs per goal, reports, templates per service, client health scoring, files.
