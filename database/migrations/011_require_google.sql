-- Joshua Nunez
-- Phase 8b: an agency can require Google sign-in for everyone except Owners.
ALTER TABLE organizations ADD COLUMN require_google INTEGER NOT NULL DEFAULT 0 CHECK (require_google IN (0,1));
