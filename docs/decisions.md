# Decisions

Dated record of choices that change the blueprint or the plan. Newest last.

## 2026-10-06: personal use first, almost free

AgencyOS starts as a personal tool. No paid plans.

- The blueprint's stack (Next.js, PostgreSQL, Supabase, Vercel) is not used for now. Next.js on the free Cloudflare Workers plan does not fit its 10 millisecond CPU limit, Vercel's free plan is for non-commercial use only, and Supabase's free plan pauses after a week and has no backups.
- Build lean, the same way Family Money OS is built: plain Node, SQLite and plain web pages, so it runs almost anywhere.
- Every principle in the blueprint stays: organization isolation, roles, audit log, SOPs, QA, time tracking, human approval for AI, API, MCP. Organization isolation is enforced in the application code and covered by tests.

## 2026-10-06: where it runs

- Build and test on the Mac first.
- Hosting is decided later. Candidates: the existing DietPi VM at 1 GB (only if memory allows), Cloudflare's free plan, or a VM at 2 GB after the Windows PC is upgraded to 8 GB.
- The Windows PC has a Celeron N4100 and 4 GB of memory and already runs StarkFi, F-Tech Server and Family Money OS, so it must not be overloaded.

## 2026-10-06: first milestone

Phases 1 and 2: foundation (login, organization, roles) and core operations (clients, projects, tasks, work views, dashboard). Then use it with real work and improve.

## 2026-10-06: Phase 1 built

- Phase 1 (foundation) is complete and tested: 58 tests, including the permission matrix, organization isolation, the HTTP API and a front-end smoke test as different roles.
- Team members get a temporary password from an Owner or Admin and must change it at first sign-in. No email is sent.
- The sidebar shows only the modules that exist. The Client role waits for the client portal.
- Not reachable from the internet yet. Hosting is still undecided. Before it is, set `SETUP_TOKEN`.

## 2026-10-06: Phase 2 built

- Clients, contacts, projects, tasks and comments, with list and board views and a working dashboard. 98 tests.
- Employees and Contractors change only the status of their own tasks. A Contractor sees only tasks assigned to them, and everything else is "not found".
- Clients and projects are archived, never deleted. A task can be deleted and the activity log keeps what it was.
- "Today" and "overdue" use the agency's timezone.
- Spec: `docs/specs/2026-10-06-phase-2-core-operations.md`.

## 2026-10-06: Phase 3 AI access built

- MCP server at `/mcp` with API keys. Keys act as their person with the live role, and have three levels: read only, ask first (default), apply directly.
- Writes go through all-or-nothing plans. In ask-first mode they wait in the AI inbox and are approved by an Owner or Admin.
- AI never touches members, roles, passwords, keys or settings, and never deletes.
- AgencyOS does not call any AI itself, so there is no AI cost.
- The claude.ai web connector needs OAuth, which is not built. Claude Code works with a header key.

## 2026-10-06: OAuth for claude.ai and personal AI connections

- OAuth sign-in so the claude.ai web and phone apps can connect with just the address. A connection shows up as a revocable key.
- Every role can connect their own AI (`ai.use`). It acts as that person with their role. Owner and Admin see and decide everyone's connections and proposals. Specs: `docs/specs/2026-10-06-phase-3b-oauth.md` and `phase-3c-agent-setup.md`.
- One MCP address for everyone. Identity comes from the key or the sign-in, not from the address.

## 2026-10-06: Phase 4 SOPs and QA built

- SOPs with versions (never overwritten), status (draft, testing, approved, deprecated) and a "needs QA" flag. Tasks pin the SOP version they follow. Work can be started from an SOP, as one task or one task per step.
- QA: a task submitted for QA gets a record with the SOP checklist. Owner, Admin and Manager review; approval needs every item ticked, requesting changes needs a comment. Nobody reviews their own work except the Owner.
- Work that needs QA reaches Done only by approval. Changes requested is set only by a review.
- An AI can draft SOPs and start work from them, but cannot approve an SOP or review work: those are human decisions.
- Migration 005 rebuilds the tasks table (new status, SOP link). Tested against data from the previous schema. Spec: `docs/specs/2026-10-06-phase-4-sops-and-qa.md`.

## 2026-10-06: Phase 5 goals and services built

- Services are a configurable list (Owner and Admin, in Settings), assigned to clients, projects and goals. Never deleted, only deactivated. SOP service stays free text with suggestions from the list.
- Goals belong to a client and are achieved or dropped, never deleted. Projects and tasks link to a goal of their own client, and a task inherits its project's goal. Progress is the share of linked tasks that are done.
- Clients gain the blueprint statuses, an account owner and a start date. Migration 006 rebuilds the clients table, tested against data from the previous schema.
- An AI can add and change goals and set client fields, but services stay with Owner and Admin. Spec: `docs/specs/2026-10-06-phase-5-goals-and-services.md`.
