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
