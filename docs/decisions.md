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

## 2026-10-06: Phase 6 results and reports built

- Results are recorded metrics per client (name, value, unit, date, optional goal). Staff record them. The client page shows each metric's latest value, change and trend.
- Reports belong to a client and a period, with the blueprint's seven sections. "Generate from data" fills the factual sections as a snapshot (work completed, results, goals, risks, priorities). Narrative sections are for a person or an AI.
- Only a person approves a report. Editing an approved report returns it to draft. Only drafts are deleted. Reports are copied as text or printed; sending to clients waits for the client portal.
- An AI can record results and write or draft reports, reading the facts with `get_report_data`, but cannot approve.
- Fixed a bug found by the new tests: a form sheet that navigates to a new page when it closes had the navigation undone by the step back that removes the sheet. Navigation after a sheet now waits for it (`goAfterSheets`). This also affected creating an SOP and starting work from an SOP.
- Spec: `docs/specs/2026-10-06-phase-6-results-and-reports.md`.

## 2026-10-06: Phase 7 Google data, and ChatGPT sign-in

- Google Search Console and Analytics (GA4) numbers are pulled with a Google service account (a read-only robot identity), not "Sign in with Google", so access never expires. Monthly numbers for completed months are recorded as results with a source, first 12 months on connect and the last 2 months refreshed daily. The key is a root-only file on the server, installed with `deploy/set-google-key.sh`. Spec: `docs/specs/2026-10-06-phase-7-google-data.md`.
- Synced results cannot be edited by hand; hand-typed results are never touched.
- ChatGPT can connect as a custom MCP server: its two redirect addresses are accepted, the sign-in answers carry the issuer (RFC 9207), the resource may name the site or the /mcp address, and tools declare their OAuth scheme. Found from OpenAI's documentation after a "settings were rejected" error.

## 2026-10-06: Google accounts (sign in with Google)

- Josh wanted the OpenSEO-style flow: connect his own Google account once and pick from every site and property it can see. Added next to the service account, which stays as an option. Spec: `docs/specs/2026-10-06-phase-7b-google-accounts.md`.
- Needs a Google OAuth client from his own Google Cloud project (id and secret installed with `deploy/set-google-oauth.sh`). Publish the consent screen to production, or Google expires the sign-in every 7 days; the unverified-app warning is clicked through once.
- Refresh tokens are stored encrypted (AES-256-GCM) with a key file beside the database, so a database copy or backup alone cannot reveal them. Only read-only scopes are requested. Owner and Admin add and remove accounts; Managers and above connect clients through them.

## 2026-10-06: Sign in with Google (invite-only)

- Google is also a way to sign in to AgencyOS. Invite-only: a Google account that is not linked and not invited gets nothing, and nothing is created automatically. Spec: `docs/specs/2026-10-06-phase-8-google-sign-in.md`.
- A Google account is tied to a person by Google's permanent account id, not the email. A member is invited by Google email (no password needed) or links their own account from My profile.
- Nobody loses their last way in: password sign-in can be turned off only while Google is linked, and Google can be unlinked only while password sign-in is on. An Owner or Admin resetting the password turns password sign-in back on.
- Uses the same Google OAuth client as the data connection, with one more return address (`/api/auth/google/callback`). Basic identity access only (openid, email, profile), so no unverified-app warning.
- The sign-in state is single use, short lived and held in a cookie as well, with PKCE and a nonce; the ID token's issuer, audience, expiry, nonce and verified email are checked.

## 2026-10-06: Google is the standard way in

- When the server can sign in with Google, the login page leads with **Sign in with Google**, and the username and password form sits under "Use a username and password". New members are added by Google email, with no password unless one is asked for.
- Passwords are not removed. Each person with a linked Google account can turn their password off. Keep one strong password, kept in a password manager, for the Owner as a way back in if Google is unavailable.
- Google sign-in is only as strong as the Google account, so every account that signs in should use 2-Step Verification, ideally a passkey or security key.
