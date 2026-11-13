-- Custom migration: refund idempotency moves from "one refund per lesson"
-- to "one refund per charge" so that a lesson can be charged, refunded,
-- re-charged (duration-change reschedule), and refunded again without
-- colliding with the uniqueness guard.
--
-- Shape change:
--   - Add nullable column `refund_of_ledger_id` on
--     household_balance_ledger. For refund_to_balance rows it points at
--     the lesson_charge row being offset. For every other entry type
--     it is NULL.
--   - Drop the old unique index on (lesson_id) scoped to
--     entry_type='refund_to_balance'.
--   - Add a new unique partial index on (refund_of_ledger_id) scoped to
--     entry_type='refund_to_balance'. Guarantees "a given charge row has
--     at most one refund row" — the DB-level invariant the Phase-2
--     one-refund-per-lesson rule used to provide, now correctly scoped
--     to the ledger-row level.
--   - Add a scope CHECK: refund_to_balance rows have
--     refund_of_ledger_id non-null; all other types have it null.
--   - Update the append-only trigger so refund_of_ledger_id joins the
--     allowlist of immutable columns (any change rejected). Only the
--     identity columns (household_id, actor_id, lesson_id) remain
--     permitted-to-null for anonymization.

ALTER TABLE household_balance_ledger
  ADD COLUMN refund_of_ledger_id uuid REFERENCES household_balance_ledger(id);

DROP INDEX IF EXISTS balance_ledger_refund_lesson_uq;

CREATE UNIQUE INDEX balance_ledger_refund_of_uq
  ON household_balance_ledger(refund_of_ledger_id)
  WHERE entry_type = 'refund_to_balance';

ALTER TABLE household_balance_ledger
  ADD CONSTRAINT balance_ledger_refund_of_scope_valid CHECK (
    (entry_type = 'refund_to_balance' AND refund_of_ledger_id IS NOT NULL)
    OR (entry_type <> 'refund_to_balance' AND refund_of_ledger_id IS NULL)
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
      NEW.created_at                   IS DISTINCT FROM OLD.created_at                   OR
      NEW.refund_of_ledger_id          IS DISTINCT FROM OLD.refund_of_ledger_id
    THEN
      RAISE EXCEPTION 'household_balance_ledger rows are append-only; no non-identity column may change';
    END IF;

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
