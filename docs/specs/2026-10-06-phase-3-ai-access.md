# Phase 3: AI access (API keys, MCP, AI inbox)

Approved by Josh on 2026-10-06. Lets an AI such as Claude read and set up the agency's work by talking to AgencyOS, under the same rules as a person, with human approval by default. It follows blueprint sections 19 to 26 and 39.

## What it is

- AgencyOS exposes an MCP server at `/mcp` (JSON-RPC over HTTPS, Bearer key). It costs nothing extra: the AI is the one Josh already uses. AgencyOS does not call any AI itself.
- A key belongs to the Owner or Admin who made it and acts as that person, with that person's role read live on every call. A key can never do more than its person could, and never reaches another agency.
- Every AI action is recorded in the activity log with source `ai`.

## Keys

- Only an Owner or Admin may create, change or revoke keys.
- A key has a name and an access level:
  - `read`: reads only.
  - `propose` (default for new keys): reads, and writes wait in the AI inbox for a person to approve.
  - `direct`: reads, and writes apply at once.
- The key looks like `aos_` plus 32 random characters. It is shown once, when created. Only a hash is stored. The list shows the first 8 characters, who made it, when it was last used, and whether it is revoked.
- A revoked key, or a key whose person is deactivated, stops working at once.
- Creating, changing and revoking a key is logged (the key itself is never logged).

## What the AI can do

Read tools: `list_clients`, `get_client`, `list_projects`, `get_project`, `list_tasks`, `get_task` (with comments), `list_team`, `get_workload`.

Write tools (not offered to a `read` key): `apply_changes`, and the one-step shortcuts `create_client`, `create_project`, `create_task`, `update_task`, `add_comment`.

`apply_changes` takes a `summary` and up to 50 ordered `steps`. A step has an `action` (`create_client`, `update_client`, `create_contact`, `create_project`, `update_project`, `create_task`, `update_task`, `add_comment`), `args`, and an optional `as` name. Later steps refer to earlier results as `$name` in `clientId`, `projectId`, `taskId` or `id`. So "a client, a project and eight tasks" is one plan.

Never available to AI: members, roles, passwords, API keys, organization settings, deleting anything.

## Plans

- A plan runs inside one database transaction. If any step fails, nothing is applied and the AI gets the failing step and a plain message.
- Each step is checked with the existing service rules and the key person's role (the same checks as the screens).
- In `direct` mode the plan applies at once. In `propose` mode the plan is first run as a dry run (rolled back) so mistakes are reported to the AI immediately, then stored as a pending proposal with a readable list of steps. Nothing else changes until a person approves it.
- Approving runs the plan for real, in the key person's context, with source `ai`, and logs who approved. If the data changed in the meantime and a step now fails, the proposal is marked failed with the message and nothing is applied. Rejecting changes nothing.
- Only an Owner or Admin may approve or reject, and only proposals of their own agency.

## MCP details

`initialize`, `ping`, `tools/list` and `tools/call` over POST `/mcp` with `Authorization: Bearer <key>`. Notifications get 202. GET gives 405. Tool results are text (JSON). A failure is a tool result with `isError`, not a broken connection. 120 calls per minute per key, then 429. Body limit 200 KB.

Works with Claude Code and any client that lets you set a header. The claude.ai web connector needs OAuth, which is not built.

## Screens

A new **AI** page for Owner and Admin, with two tabs: **Inbox** (pending proposals, each with its steps, who asked and which key, Approve and Reject, plus decided ones below) and **Keys** (list, create, change access, revoke). Creating a key shows it once, with a copy button and the ready command for Claude Code. The Dashboard shows a short "waiting for approval" panel when there is something pending. The Activity page marks AI actions.

## Testing

Test first. Groups: key creation, hashing, one-time token, revoke, deactivation; permissions (who may manage keys, approve); isolation (another agency's key, proposals and data); the plan executor (references, rollback on a failing step, role cap, step limits); propose, approve, reject, double approve; direct mode and the `ai` source in the log; the MCP protocol over HTTP; rate limit; front-end smoke test of the AI page.

## Out of scope

OAuth for claude.ai web connectors, a REST API for keys, AI creating members, AI deleting, AI-written SOPs and reports (those arrive with SOPs and reports), AgencyOS calling an AI provider.
