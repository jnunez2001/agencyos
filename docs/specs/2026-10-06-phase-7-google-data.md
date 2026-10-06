# Phase 7: Google Search Console and Analytics data

Approved by Josh on 2026-10-06 ("yes, option 2, start with those numbers"). Results are filled automatically from Google instead of typed by hand, using Google's free APIs and a service account (a read-only robot identity), not "Sign in with Google".

## How it connects

- A Google **service account** key is installed on the server as a root-only file (`GOOGLE_KEY_FILE`, installed by `deploy/set-google-key.sh`). The key is never stored in the database, shown on a screen, or seen by Claude. Without the file, Google is simply "not set up" and everything else works.
- Each client connects its own **Search Console site** and **Analytics (GA4) property**, picked from a list of what the service account can see. A client's owner gives access once by adding the service account's email as a read-only user in Search Console and in Analytics.
- Who: Owner, Admin and Manager connect, disconnect and sync clients. Everyone who can see results sees the numbers.

## Numbers pulled (monthly, completed months only)

- Search Console: **Search clicks**, **Search impressions**, **Search CTR** (percent), **Average position**.
- Analytics: **Sessions**, **Organic sessions** (the Organic Search channel), **Users**, **Conversions** (key events).
- Each number is recorded as a result dated the last day of its month, labelled with its source and month. A month is recorded only once it has ended.
- First connect fetches the last 12 completed months. After that a daily sync refreshes the last 2 completed months (Google finalises data late) and adds new months.
- Syncing is safe to repeat: the same metric and month is updated, never duplicated. Hand-typed results are never touched.
- A missing property, a refused permission or a Google outage shows a plain message on the client ("Add <email> as a viewer in Search Console") and keeps the other source working.

## Screens

- **Client page, Google panel:** Connect (choose site and property), connected state with last sync time, **Sync now**, Disconnect (results are kept).
- **Results:** automatic results show their source and cannot be edited by hand.
- **Settings, Google** (Owner and Admin): whether the server has a key, the service account email to share, and the one command to install a key.

## AI and MCP

No new tools: Claude reads the synced numbers like any result (`get_metrics`, `list_results`, `get_report_data`), so reports pick them up. Connecting a client's Google is a person's action.

## Data (migration 008)

`client_google` (the client's site and property, last sync and its outcome) and a `source` column on results (`manual`, `gsc`, `ga4`) with a unique index so synced numbers cannot duplicate.

## Testing

Test first, with Google replaced by a fake: the service account sign-in token (signed and checked with a test key), the API calls and error messages, the sync (months, idempotence, partial failures, hand-typed results untouched), permissions, isolation, the daily schedule, the HTTP routes, and smoke tests for the new panels.

## Out of scope

Sign in with Google, keyword and page level data, rank tracking against competitors, daily or weekly series, alerts, a Google Business Profile or Ads connection.
