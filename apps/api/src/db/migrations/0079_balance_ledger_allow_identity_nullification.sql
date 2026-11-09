-- Custom migration: relaxes the ADR 036 anonymization barriers from
-- migration 0076 (check constraints) and 0077 (append-only trigger) to
-- permit nullification of identity-pointer columns on
-- household_balance_ledger: household_id, actor_id, lesson_id. Matches
-- the ADR 036 §7 / Phase 8 Part A anonymization posture ("rows survive,
-- identity is stripped") and is pulled forward because without it any
-- FK ON DELETE SET NULL from households, profiles, or lessons into
-- household_balance_ledger fires an UPDATE that either the un-relaxed
-- trigger or the strict check constraint rejects.
--
-- In production, hard-deleting a household / profile / lesson isn't a
-- normal code path (ADR 034 anonymizes rather than deletes), so this
-- relaxation only fires during the account-deletion flow and in test
-- fixtures that hard-delete lessons as cleanup. The ledger row survives
-- with its amount intact for tax retention either way.
--
-- Mutation policy after this migration:
--   INSERT with lesson_id non-null and entry_type not in the lesson set
--     (lesson_charge | refund_to_balance | free_lesson)  → rejected
--   INSERT with lesson_id null and entry_type in the lesson set
--     → permitted (previously rejected). Service-layer code (ApplyLedgerEntry
--       TypeScript discriminated union) enforces the "lesson entry carries
--       a lesson_id at write time" invariant; the DB check now only
--       guards the inverse direction (non-null lesson_id implies lesson
--       entry type).
--   DELETE                             → rejected (unchanged)
--   UPDATE of id, entry_type,
--          amount_cents,
--          stripe_checkout_session_id,
--          stripe_payment_intent_id,
--          reason, or created_at       → rejected
--   UPDATE of household_id, actor_id,
--          or lesson_id                → permitted ONLY as non-null → NULL

ALTER TABLE household_balance_ledger
  DROP CONSTRAINT balance_ledger_lesson_id_scope_valid;

ALTER TABLE household_balance_ledger
  ADD CONSTRAINT balance_ledger_lesson_id_scope_valid CHECK (
    lesson_id IS NULL
    OR entry_type IN ('lesson_charge', 'refund_to_balance', 'free_lesson')
  );

CREATE OR REPLACE FUNCTION household_balance_ledger_enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'household_balance_ledger rows are append-only; DELETE is not allowed';
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    IF
      NEW.id                           IS DISTINCT FROM OLD.id                           OR
      NEW.entry_type                   IS DISTINCT FROM OLD.entry_type                   OR
      NEW.amount_cents                 IS DISTINCT FROM OLD.amount_cents                 OR
      NEW.stripe_checkout_session_id   IS DISTINCT FROM OLD.stripe_checkout_session_id   OR
      NEW.stripe_payment_intent_id     IS DISTINCT FROM OLD.stripe_payment_intent_id     OR
      NEW.reason                       IS DISTINCT FROM OLD.reason                       OR
      NEW.created_at                   IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'household_balance_ledger rows are append-only; no non-identity column may change';
    END IF;

    -- household_id, actor_id, and lesson_id are the identity-pointer
    -- columns. An UPDATE is permitted only when their transitions are
    -- non-null → NULL (the only legal anonymization step). Rejecting
    -- NULL → non-null prevents a bug where an anonymized row is
    -- re-attached to a live household, profile, or lesson by mistake.
    IF NEW.household_id IS DISTINCT FROM OLD.household_id THEN
      IF NEW.household_id IS NOT NULL THEN
        RAISE EXCEPTION 'household_balance_ledger.household_id can only be set to NULL on an existing row';
      END IF;
    END IF;

    IF NEW.actor_id IS DISTINCT FROM OLD.actor_id THEN
      IF NEW.actor_id IS NOT NULL THEN
        RAISE EXCEPTION 'household_balance_ledger.actor_id can only be set to NULL on an existing row';
      END IF;
    END IF;

    IF NEW.lesson_id IS DISTINCT FROM OLD.lesson_id THEN
      IF NEW.lesson_id IS NOT NULL THEN
        RAISE EXCEPTION 'household_balance_ledger.lesson_id can only be set to NULL on an existing row';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
