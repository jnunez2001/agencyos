# NexusOS guide

What the application actually does today. The exact lists (permissions, API routes, MCP tools, tables, migrations) are in [reference.md](reference.md), which is generated from the code.

## What it is

An operating system for a digital agency. It keeps the agency's clients, work, meetings, decisions, time and results connected, so anyone can trace where work came from and what happened with it. It runs as one small Node server with a SQLite database, and an AI assistant the person already uses (Claude, ChatGPT, Claude Code) can work inside it through MCP, under the same permissions as that person.

## The operating loop and where it lives

| Step | Where |
|---|---|
| Conversation, meeting | Calendar (events, linked to client, project, task) |
| Meeting notes | Meetings: purpose, agenda, discussion, decisions, requests, follow-ups, risks, context, SOP impact, next meeting, transcript |
| Decision, client request, follow-up | Created from a note with "Create records", or directly. Each keeps a link to its note. |
| Task, assignment | A request converts to a task (manager) and keeps the link both ways |
| Employee | Dashboard "Today" (My Day), Tasks, Calendar, Time |
| Time tracking | Timer or manual entry; draft, submitted, approved, rejected, locked; approved billable time counts against the client's retainer |
| QA | Tasks that need QA go to the QA queue; a reviewer approves or sends back with comments |
| Result, report | Results (manual or from Google Search Console and Analytics); reports generated from the data, approved by a person |
| Learning, SOP improvement | SOP change requests; publishing creates a new SOP version, never overwrites |
| Next cycle | Notifications and the dashboards point to what needs attention |

Trace anything: a task shows "Where this came from" (request, meeting note, event, decisions, follow-ups, SOP, time). A client page shows "Recent activity" for 7, 30 or 90 days.

## Roles

Owner, Admin, Manager, Employee, Contractor. The full matrix is in [reference.md](reference.md). In short: Owner and Admin run the agency and its settings; Managers run clients, projects, tasks, QA, time approval, SOPs and requests; Employees do assigned work, log time, write notes for meetings they attend and add requests and follow-ups; Contractors see only what is assigned to them or what they attend and cannot see clients, requests, decisions, retainers or the team's data. There is no client role yet (see limitations).

## Dashboards

Everyone gets "Today" (their events, tasks and follow-ups that are due or overdue, requests they handle). Managers also get "Needs a manager". Owners and Admins get an overview: what needs a decision (time, QA, SOP changes), what is happening, what needs improving (work sent back by QA, people over capacity), recent results and clients at risk.

## Notifications

In the app only (a bell). Only things a person must act on, never about their own action, repeats fold into the unread one, and a daily digest goes out once per person. Triggers: assignments (task, follow-up, request), event invitations, comments on your task, new client requests for your clients, QA requested and sent back, time rejected, retainer at 80 and 100 percent, a meeting starting within the hour, SOP changes needing review, SOP published, decisions on your clients.

## Search

One search box (and the `/` key) over clients, projects, tasks, SOPs, meeting notes (including what was said in them), reports, requests, decisions, follow-ups, events and team members. Each kind follows the same visibility rules as its own screen.

## AI and MCP

An API key (or an OAuth connection from claude.ai or ChatGPT) acts as its owner with the owner's live role. Access is read, propose (default: changes wait in the AI inbox for a person to approve) or direct. All changes go through plans, run in one transaction, through the same services and permission checks as the screens. An AI can search, summarize, draft, extract and prepare work. An AI can never approve or reject anything, finalize notes, publish an SOP change or report, convert or approve a client request, lock or approve time, delete records, or change members, passwords, keys or settings. Meeting intelligence uses the AI you already connect: paste a transcript on a note, press "Copy AI prompt", and the AI reads `get_meeting_brief` and drafts the note for you to review. The tools are listed in [reference.md](reference.md).

## Security model

- Every table has `organization_id` and every query is scoped by it; a signed-in person of one agency can never read or change another agency's records by guessing an id. `test/security-sweep.test.js` attacks every id route and every MCP tool from a second agency and from a Contractor, and enumerates routes from the router so a new route fails until it is covered.
- Passwords are hashed; sessions are HttpOnly cookies with a CSRF token on changes; login is rate limited; Google sign-in is invite-only with PKCE and a nonce; API keys and OAuth tokens are stored hashed; Google refresh tokens are encrypted with a key kept outside the database.
- A strict content security policy (no inline scripts or styles). Errors are returned as plain messages; stack traces and database text never reach a person.
- Every important change is written to the activity log in the same transaction.

## Setup

Requires Node 22 or newer.

```bash
npm install
npm start              # http://localhost:3200, creates the agency on first visit
npm run demo:seed && npm run demo   # a demo agency in data-demo/ (separate from real data)
```

Environment variables (see `server/config.js`): `PORT`, `HOST`, `DATA_DIR` (database and keys), `COOKIE_SECURE`, `PUBLIC_URL` (the public address, used by OAuth), `GOOGLE_KEY_FILE` (optional service account), `GOOGLE_OAUTH_FILE` (Google OAuth client for sign-in and connected accounts), `SETUP_TOKEN` (first-run code), `SESSION_DAYS`.

Migrations in `database/migrations/` run automatically at start, in order, once each. They only add; existing data is never rebuilt without a test proving it survives. Demo data is only created by `scripts/seed-demo.js` into its own folder and never touches real data.

## Testing

`npm test` runs about 450 tests: permission and isolation rules per service, HTTP and MCP flows, front-end smoke tests (a simulated browser opens every screen as each role), the security sweep, the error-handling checks, migration tests against old data, and two end-to-end walks (`test/e2e-roadmap.test.js` and `test/acceptance-26.test.js`, the 26-step workflow). `node scripts/perf-check.js` times the main queries on a scratch database. A test starts real HTTP servers, so every such test must close its server or the run will hang.

## Deployment

Run on one small server behind a TLS proxy (this project uses a Cloudflare Tunnel to a Debian VM, capped at 192 MB for the service). `deploy/push.sh user@host` runs the tests, copies the code and reinstalls with `deploy/install.sh`, keeping the database. Take a backup first (`systemctl start agencyos-backup.service` on the server); a nightly backup timer also runs. `deploy/pull-backups.sh` copies backups to another machine. The Google files are installed with `deploy/set-google-key.sh` and `deploy/set-google-oauth.sh`. Getting the Google consent screen verified is described in [google-verification.md](google-verification.md).

## Known limitations

- No client portal and no client role. Everything is internal.
- No file attachments (notes hold text and a transcript).
- Notifications are in the app only: no email or push. No recurring events, no email invitations, no Google Calendar sync.
- Search is a plain text match, not full text; it returns at most 8 results per kind. Only some lists accept `limit` and `offset`; the rest are capped.
- Calendar days and capacity weeks use UTC dates on the server; the screens show times in the browser's time zone, so an event near midnight can sit on a neighboring day in rare cases.
- One server and one SQLite file. Backups are on the same machine until you pull them elsewhere.
- Reports are copied or printed, not exported as files.
- Google shows an "unverified app" warning until the verification in `google-verification.md` is approved.
- There is no built-in AI model: the AI features use the assistant you connect.
- Slower paths that remain: LIKE search, the overdue counts and the dashboard event scan (milliseconds at thousands of rows; revisit at much larger scale).
