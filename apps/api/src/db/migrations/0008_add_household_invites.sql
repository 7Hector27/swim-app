-- Invite tokens for households.
--
-- expires_at defaults to now() + interval '72 hours' set at insert time by
-- the DB. It cannot reference created_at because column defaults cannot
-- reference sibling columns.
--
-- The raw token is never stored. The API stores only the SHA-256 hex digest.
-- One pending invite per household is enforced in application logic (generating
-- a new invite revokes any existing pending one).

CREATE TABLE "household_invites" (
  "id"           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid         NOT NULL REFERENCES "households"("id")  ON DELETE CASCADE,
  "token_hash"   text         NOT NULL UNIQUE,
  "created_by"   uuid         NOT NULL REFERENCES "profiles"("id")    ON DELETE RESTRICT,
  "expires_at"   timestamptz  NOT NULL DEFAULT now() + interval '72 hours',
  "revoked_at"   timestamptz,
  "accepted_at"  timestamptz,
  "accepted_by"  uuid         REFERENCES "profiles"("id")             ON DELETE RESTRICT,
  "created_at"   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT "invites_not_both_revoked_and_accepted"
    CHECK (NOT (revoked_at IS NOT NULL AND accepted_at IS NOT NULL))
);
