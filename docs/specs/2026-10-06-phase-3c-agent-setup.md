# Phase 3c: Agent setup page and personal AI connections

Requested by Josh on 2026-10-06, after seeing the "Agent setup" page of another product: one page with the MCP server URL and a copy button, a setup prompt to paste into an AI agent, and each person using their own agent. It builds on Phases 3 and 3b.

## What changes

- Every signed-in person, not only Owner and Admin, can connect their own AI. A connection (a key, or a claude.ai sign-in) acts as the person who made it, with that person's role, so an Employee's AI can do only what the Employee can, and a Contractor's AI sees only the Contractor's tasks.
- One MCP address serves everyone: `https://agency.joshnunezseo.com/mcp`. Who is connecting is decided by the key or the sign-in, not by the address, so each person has their own personal connection without separate addresses.
- A new page, **AI agent**, replaces the AI page for everyone, with three tabs: **Setup**, **Inbox**, **Connections**.

## Permissions

- New action `ai.use`: every role. Creates keys and approves claude.ai sign-ins for oneself.
- A person sees and changes only their own connections. Another person's connection is "not found". Owner and Admin (`ai.manage`) see and revoke all connections in the agency.
- A person sees and decides only the proposals of their own connections. Owner and Admin (`ai.approve`) see and decide all of them. Approving always runs the plan as the person who owns the connection, so approving never gives more power than that person has.

## Setup tab

- The MCP server URL for this agency, with a copy button.
- **Claude on the web and phone (claude.ai):** the steps to add a custom connector with that URL, then sign in and approve.
- **Claude Code and other agents:** choose an access level, then **Create key and copy setup prompt**. This makes a personal key and copies a prompt to paste into the agent. The prompt holds the URL, the key and how to connect, and tells the agent what to do next. The key is shown only inside the prompt, once.
- **Any other MCP client:** the URL and the header to set.

## Connections tab

The person's connections (keys and connected apps) with access level, last use and revoke. Owner and Admin also see whose each one is.

## Testing

Update the earlier tests for the new rules (personal keys for every role, visibility, approval of own proposals, Owner and Admin seeing all) and add: an Employee's AI can change the status of their own task and cannot create tasks; a Contractor's connection sees only their own tasks. Front-end smoke tests for the new tabs for an Owner and a Contractor.
