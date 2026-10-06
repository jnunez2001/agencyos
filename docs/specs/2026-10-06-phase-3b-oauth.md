# Phase 3b: OAuth sign-in for claude.ai connectors

Requested by Josh on 2026-10-06: he wants to use AgencyOS from claude.ai in the browser (and the phone app). Those apps connect to a remote MCP server through OAuth, not a pasted key. Requirements checked against Anthropic's connector authentication docs on the same day (claude.com/docs/connectors/building/authentication).

## What it does

AgencyOS becomes its own small OAuth server for the `/mcp` endpoint. In claude.ai, Josh adds a custom connector with the URL `https://agency.joshnunezseo.com/mcp` and no other settings. Claude finds the sign-in on its own, opens an AgencyOS page, and Josh approves the connection there. Nothing is pasted anywhere.

## Flow

1. `/mcp` answers a call without a valid token with `401` and `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
2. Discovery documents: protected resource metadata (`resource` is exactly `<origin>/mcp`, one authorization server, the origin itself) and authorization server metadata (`/.well-known/oauth-authorization-server`) with `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, grants `authorization_code` and `refresh_token`.
3. Dynamic client registration (`POST /oauth/register`, JSON). Only clients whose redirect addresses are Claude's are accepted: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, and loopback addresses (`http://localhost` or `http://127.0.0.1`, any port) for Claude Code. Anything else is refused.
4. `GET /oauth/authorize` checks the request (client, exact redirect address, PKCE S256 required, optional `resource` must be our `/mcp`), stores it for 10 minutes and sends the browser to the AgencyOS page `#/connect/<id>`.
5. The AgencyOS page needs a signed-in Owner or Admin (the normal sign-in comes first). It shows who is asking ("Claude", and the redirect host), acts as the signed-in person, and lets them choose the access level (Ask me first by default, Read only, Apply directly). Approve or Cancel.
6. Approve gives a one-time code (5 minutes) bound to the client, redirect address and PKCE challenge, and sends the browser back to Claude with `code` and `state`. Cancel sends `error=access_denied`.
7. `POST /oauth/token` (form encoded) exchanges the code (with the PKCE verifier) for an access token (1 hour, `aot_`) and a refresh token (30 days, `aor_`). Refresh tokens rotate on every use. Using an old refresh token again is treated as theft and ends the connection.

## It is a key

An approved connection appears on the AI page under Keys, named after the app, marked as a connected app. It is an ordinary key underneath: it acts as the person who approved, with their live role, at the chosen access level, shows when it was last used, and can be revoked. Revoking it ends the access token and the refresh token at once. Everything else (plans, the AI inbox, limits, the activity log) works the same, so changes still wait in the inbox when the access level is Ask me first.

## Safety

- PKCE S256 is required. Codes are single use and short lived. Codes, access tokens and refresh tokens are stored only as hashes.
- Open registration is limited to Claude's redirect addresses, capped in number, and rate limited.
- The consent screen names the client and the redirect host. Only an Owner or Admin can approve.
- Token and registration endpoints are rate limited per address.
- The public address comes from the `PUBLIC_URL` setting on the server, so discovery documents never trust a header.

## Testing

Test first: discovery documents, registration rules, the whole flow with PKCE, wrong verifier, reused code, wrong redirect, unknown client, refresh rotation and theft detection, expiry, revoking, who may approve, cancel, request expiry, and a front-end smoke test of the connect page.

## Out of scope

Scopes beyond one fixed scope, client credentials, a list of registered clients to manage, Anthropic-held credentials, enterprise SSO.
