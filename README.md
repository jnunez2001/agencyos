# NexusOS

An operating system for digital agencies: clients, projects, tasks, meetings and notes, decisions, client requests, follow-ups, time and retainers, SOPs and QA, results and reports, with AI assistants working inside it under the same permissions as the person using them.

- What it does and how it works: [docs/guide.md](docs/guide.md)
- Every permission, API route, AI tool and table (generated from the code): [docs/reference.md](docs/reference.md)
- Why things were decided: [docs/decisions.md](docs/decisions.md). Specs per phase: [docs/specs/](docs/specs/). The original plan: [docs/blueprint.md](docs/blueprint.md).
- Getting the Google consent screen verified: [docs/google-verification.md](docs/google-verification.md)

## Run it

```bash
npm install
npm start           # http://localhost:3200, creates your agency on first visit
npm run demo:seed   # a demo agency in data-demo/ (josh, rayne, mark, sarah, cole); password in scripts/seed-demo.js
npm run demo        # http://localhost:3200 with the demo data
npm test            # about 450 tests
node scripts/gen-docs.js   # refresh docs/reference.md after changing routes, tools or permissions
```

Plain Node 22 or newer, Express, SQLite and plain JavaScript pages with no build step. All data access is scoped by organization, and the server decides what each role may do.

## Rules for this project

- Private repository. Never commit secrets, API keys or data files.
- Separate from Family Money OS and StarkFi. Nothing here touches them.
