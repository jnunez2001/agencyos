# AgencyOS

An operating system for digital agencies: clients, projects, work, SOPs, QA, time, reports and AI-assisted operations in one controlled system.

The full product plan is in [docs/blueprint.md](docs/blueprint.md). It is the source of truth. Build decisions are in [docs/decisions.md](docs/decisions.md). The current phase is specified in [docs/specs/](docs/specs/).

## Status

Phases 1 and 2 are built. Phase 1: setup, login, organizations, five roles, the team, employee profiles and the activity log. Phase 2: clients with contacts, projects, tasks with comments, list and board views, and a dashboard with my work, agency totals and team workload. SOPs, QA, calendar, time tracking and reports are next.

## Run it on your Mac

```bash
npm install
npm run demo:seed   # a small demo agency (josh, rayne, mark, sarah, cole) with clients, projects and tasks
npm run demo        # http://localhost:3200
```

The demo password is in `scripts/seed-demo.js`. Demo data lives in `data-demo/`, which is not committed.

To reseed the demo from scratch, delete the `data-demo` folder first.

To start with an empty agency instead, run `npm start` and open http://localhost:3200 to create it.

## Tests

```bash
npm test
```

Node's built-in runner. They cover the permission rules, organization isolation, login and sessions, the activity log, the HTTP API, and a front-end smoke test that opens every screen and sheet as different roles.

## How it is built

Plain Node 22 or newer, Express, SQLite and plain JavaScript pages with no build step, so it can run on a small server. All data access is scoped by organization. The server decides what each role may do, and the screens only hide what the server would refuse.

## Rules for this project

- Private repository. Never commit secrets, API keys or data files.
- Separate from Family Money OS and StarkFi. Nothing here touches them.
- Set `SETUP_TOKEN` before the server is reachable from the internet, so a stranger cannot claim a fresh agency.

## Deploying to a small server

`deploy/push.sh root@SERVER` runs the tests, copies the code and installs a systemd service that listens on 127.0.0.1:3200 only, with a 192 MB memory cap. Put it on the web with a Cloudflare Tunnel hostname that points at that port. Run `deploy/set-setup-token.sh` on the server before it is reachable. Nothing here touches other apps on the server.
