# Roadmap step 7: Role-specific workspaces

Joshua Nunez. The Dashboard becomes the home of each role, built on what already exists (no migration).

- **My Day (everyone):** today's events, tasks overdue or due today, follow-ups overdue or due today, client requests I handle, unread notifications, and QA waiting if I review.
- **Manager view (Manager and above):** requests to review (New or Reviewing), overdue follow-ups across the team, unassigned open tasks, past meetings with no notes in the last 14 days, QA waiting.
- **Owner overview (Owner and Admin):** clients at risk, overdue tasks across the agency, open requests, meetings with clients in the next 7 days, AI proposals waiting.

One call, `GET /api/workspace`, returns the sections the role may see; each section is only worked out for roles that may see it. MCP read tool `get_workspace` returns the same for the key owner.
