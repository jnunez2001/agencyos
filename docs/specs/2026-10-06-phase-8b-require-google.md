# Phase 8b: Require Google sign-in (Owners excepted)

Requested by Josh on 2026-10-06 ("make Google required for everyone except me"). A setting in Settings, Security, for Owners only.

## What it does

- When on, everyone except Owners must sign in with Google. A correct password from a non-Owner is refused with "Your agency requires signing in with Google". Owners keep password sign-in as the way back in if Google is unavailable.
- It can only be switched on when the server can sign in with Google and every active non-Owner member is either linked to a Google account or invited by Google email, so nobody is locked out. If not, it says who still needs an invitation and does not switch on.
- Switching it on ends the current sessions of non-Owners, so they sign in again with Google. Switching it off changes nothing else.

## Rules that keep people from being locked out

- While it is on, a new non-Owner member needs a Google email (a password alone is refused).
- A person cannot be changed from Owner to another role unless they are linked or invited by Google.
- A non-Owner cannot unlink Google while it is on.
- An Owner cannot turn off their own password sign-in while it is on.
- Only an Owner can switch it, and every change is logged.

## Testing

Test first: switching on and off with its conditions, sign-in refused for non-Owners and allowed for Owners, sessions ended, the lock-out guards, permissions, isolation between agencies, the HTTP routes and a smoke test of the Settings panel.
