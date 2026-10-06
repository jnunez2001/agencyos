# Phase 8: Sign in with Google

Approved by Josh on 2026-10-06 ("yes", to the invite-only design). Google becomes a way to sign in to AgencyOS. It is invite-only: nobody gets an account just by having a Google account.

## What people can do

- **Sign in with Google** on the login page, next to the username and password form (shown only when the server has a Google OAuth client).
- **Link my Google account** (My profile): a signed-in person approves once. After that, Google is their sign-in. Their password keeps working unless they or an Owner or Admin turn it off.
- **Invite by Google email:** an Owner or Admin adds a member with a Google email and no password (or sets the email for an existing member). The person's first Google sign-in with that email links the account and signs them in.
- **Google only:** a person with a linked account can turn off password sign-in for themselves, and an Owner or Admin can do it for people they manage. Nobody can remove their last way to sign in: password sign-in can only be turned off while a Google account is linked, and Google can only be unlinked while password sign-in is on.

## Rules

- A Google account maps to one person, permanently, by Google's own account id (not the email). Changing the email on the Google account later makes no difference.
- Only a Google-verified email counts. An email that is not linked and not invited gets no account ("ask an Owner or Admin to invite you"). Nothing is created automatically.
- An invited email can belong to one person only, and a Google account already linked to someone cannot be linked or invited again.
- A deactivated person cannot sign in by Google either, and their sessions end as before.
- Sign-in uses the same sessions, cookie, CSRF protection and activity log as the password sign-in. Failed Google sign-ins count toward the same per-address throttle.
- Only basic identity access is asked from Google (openid, email, profile). It uses the same Google OAuth client as the data connection, with one more return address: `/api/auth/google/callback`.

## How the sign-in is protected

State is random, single use, expires in 10 minutes, and is also held in a short-lived HttpOnly cookie, so a sign-in can only be finished in the browser that started it. PKCE and a nonce are used. The ID token's issuer, audience, expiry, nonce and verified email are checked. Linking is tied to the signed-in person who started it.

## Screens

Login page button and error messages; My profile "Sign in with Google" panel (link, unlink, Google only); Team: add member with a Google email and optional password, and a member's Google status with invite, clear and turn off password; result pages after linking.

## Testing

Test first, with Google replaced by a fake: the sign-in address and state rules, the ID token checks, signing in with a linked account, binding an invite, refusing strangers, deactivated people, linking and unlinking rules, the last-way-in rule, password sign-in turned off, throttling, permissions, isolation, the HTTP flow with the cookie, and smoke tests.

## Out of scope

Automatic sign-up, company-domain rules, other providers, two-factor.
