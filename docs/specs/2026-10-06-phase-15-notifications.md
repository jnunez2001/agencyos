# Roadmap step 12: Actionable notifications without spam

Joshua Nunez.

## What
A bell with an unread count and a list. Each notification says what happened, who it is for, and opens the thing it is about. Nobody is notified of their own action.

## Triggers (only what a person must act on)
- A task, follow-up or client request is assigned to you.
- You are added to a calendar event.
- Someone comments on a task assigned to you.
- A new client request arrives for a client you are the account owner of.
- A daily digest, once per person per day, only when something is overdue or due today.
(Steps 8 and 11 add their own: time sent for approval, rejected time, retainer at 80 percent, SOP change request waiting.)

## No spam
- While a notification about the same thing is still unread, a repeat is folded into it instead of adding another (`dedupe_key`). The digest is sent once a day (`once`).
- Read notifications older than 90 days are removed.
- Only your own notifications are ever visible, scoped by agency and person.

## Data (migration 018)
`notifications`: user, type, title, body, link (a front-end hash), object type and id, dedupe key, read_at.

## Surfaces
API `GET /api/notifications` (`?unread=1`), `GET /api/notifications/count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`. MCP read tool `list_notifications` (the key owner's own). A bell in the app shell.
