# Phase 7b: Connect a Google account (sign in with Google)

Requested by Josh on 2026-10-06 after seeing how OpenSEO does it: connect your own Google account once, then choose from every Search Console site and Analytics property that account can already see, with no per-client sharing. It adds to Phase 7; the service account stays as an option.

## What it does

- In Settings, Google, an Owner or Admin clicks **Add Google account**, signs in with Google, and approves read-only access to Search Console and Analytics. The agency can connect several accounts.
- On a client, **Connect Google** shows a picker: choose the account, then the Search Console site and the Analytics property (with a search box). The numbers sync exactly as in Phase 7.
- A client uses one credential: one connected account, or the service account.

## How it is built

- AgencyOS needs a Google OAuth client (Web application) from Josh's own Google Cloud project: its id and secret are installed on the server by `deploy/set-google-oauth.sh` (the secret is typed hidden and never seen by Claude). The return address is `<site>/api/integrations/google/callback`.
- Google sign-in uses the authorization code flow with offline access. The state value is random, single use, expires in 10 minutes, and is tied to the person who started it and their agency. The callback only works for that same signed-in person.
- The refresh token is stored encrypted (AES-256-GCM) in the database. The encryption key is a separate file in the data folder, generated on first use, so a copy of the database or a backup alone cannot reveal tokens.
- A token Google has withdrawn marks the account "needs reconnecting", and clients using it show that plainly instead of failing silently.
- Removing an account revokes its token at Google and disconnects the clients that used it (their numbers stay).
- Only read-only scopes are requested (Search Console, Analytics, and the account's email address).

## Who

Owner and Admin add and remove accounts. Manager and above connect clients, using any connected account. Everyone who sees results sees the numbers.

## Note on Google's "unverified app" screen

An OAuth client in Testing mode makes Google expire the sign-in every 7 days. Publishing it ("In production") removes that. Because the app is Josh's own and unverified, Google shows a warning screen on first sign-in that he clicks through (Advanced, then continue). Unverified apps are limited to 100 users, far above what this needs.

## Testing

Test first, with Google replaced by a fake: the sign-in address, the state rules, the code exchange, encrypted token storage, refreshing tokens, withdrawn access, listing and removing accounts, the picker data, connecting a client through an account, syncing through an account, permissions, isolation, and smoke tests for Settings and the picker.

## Out of scope

Verification of the app with Google, other Google products, per-person private accounts (accounts belong to the agency).
