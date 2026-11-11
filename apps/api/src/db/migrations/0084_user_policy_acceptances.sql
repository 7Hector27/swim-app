-- ADR 036 Phase 8 Part B Stop 3 — user_policy_acceptances append-only table.
--
-- Captures each parent's (user, policy, version, accepted_at, source)
-- acceptance. Append-only: the trigger below rejects every UPDATE and DELETE
-- except the non-null → NULL transition on user_id used by the account-
-- deletion anonymization step (same posture as household_balance_ledger per
-- migration 0079). The trigger's identity-nullification carve-out doesn't need
-- a transaction tag because the only legal mutation on an existing row is
-- user_id non-null → NULL — nothing else is permitted, so no deletion-vs-
-- random-write ambiguity to resolve.

CREATE TABLE "user_policy_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "policy_slug" text NOT NULL,
  "version" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "source" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_policy_acceptances_slug_valid"
    CHECK ("policy_slug" IN ('terms', 'privacy', 'payments_refund')),
  CONSTRAINT "user_policy_acceptances_source_valid"
    CHECK ("source" IN ('signup', 'reaccept_prompt'))
);--> statement-breakpoint

ALTER TABLE "user_policy_acceptances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE INDEX "user_policy_acceptances_user_policy_accepted_at_idx"
  ON "user_policy_acceptances"
  USING btree ("user_id", "policy_slug", "accepted_at" DESC);--> statement-breakpoint

-- Append-only trigger. Mirrors household_balance_ledger's shape
-- (migration 0079): DELETE is always rejected; UPDATE is rejected unless the
-- only change is user_id going non-null → NULL (the anonymization step from
-- the account-deletion flow). Every other column is immutable.
CREATE OR REPLACE FUNCTION user_policy_acceptances_enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'user_policy_acceptances rows are append-only; DELETE is not allowed';
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    IF
      NEW.id           IS DISTINCT FROM OLD.id           OR
      NEW.policy_slug  IS DISTINCT FROM OLD.policy_slug  OR
      NEW.version      IS DISTINCT FROM OLD.version      OR
      NEW.accepted_at  IS DISTINCT FROM OLD.accepted_at  OR
      NEW.source       IS DISTINCT FROM OLD.source       OR
      NEW.created_at   IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'user_policy_acceptances rows are append-only; no non-identity column may change';
    END IF;

    -- user_id is the only identity-pointer column. An UPDATE is permitted
    -- only when its transition is non-null → NULL (the legal anonymization
    -- step). Rejecting NULL → non-null prevents a bug where an anonymized
    -- row is re-attached to a live profile by mistake.
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      IF NEW.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'user_policy_acceptances.user_id can only be set to NULL on an existing row';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER user_policy_acceptances_append_only_update
BEFORE UPDATE ON user_policy_acceptances
FOR EACH ROW
EXECUTE FUNCTION user_policy_acceptances_enforce_append_only();--> statement-breakpoint

CREATE TRIGGER user_policy_acceptances_append_only_delete
BEFORE DELETE ON user_policy_acceptances
FOR EACH ROW
EXECUTE FUNCTION user_policy_acceptances_enforce_append_only();
