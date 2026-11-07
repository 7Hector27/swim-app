-- Custom migration: hand-written because Drizzle-kit cannot express triggers.
-- Enforces the append-only rule from ADR 036: once a household_balance_ledger
-- row lands, no column may change and the row may not be deleted. The
-- account-deletion anonymization path (ADR 036 §7, Phase 8) will later relax
-- this trigger to permit an UPDATE that nulls household_id and actor_id only.
-- Until that phase, every mutation is rejected.

CREATE OR REPLACE FUNCTION household_balance_ledger_enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    RAISE EXCEPTION 'household_balance_ledger rows are append-only; DELETE is not allowed';
  END IF;

  IF (TG_OP = 'UPDATE') THEN
    IF
      NEW.id                           IS DISTINCT FROM OLD.id                           OR
      NEW.household_id                 IS DISTINCT FROM OLD.household_id                 OR
      NEW.entry_type                   IS DISTINCT FROM OLD.entry_type                   OR
      NEW.amount_cents                 IS DISTINCT FROM OLD.amount_cents                 OR
      NEW.lesson_id                    IS DISTINCT FROM OLD.lesson_id                    OR
      NEW.stripe_checkout_session_id   IS DISTINCT FROM OLD.stripe_checkout_session_id   OR
      NEW.stripe_payment_intent_id     IS DISTINCT FROM OLD.stripe_payment_intent_id     OR
      NEW.actor_id                     IS DISTINCT FROM OLD.actor_id                     OR
      NEW.reason                       IS DISTINCT FROM OLD.reason                       OR
      NEW.created_at                   IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'household_balance_ledger rows are append-only; no column may change';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER household_balance_ledger_append_only_update
BEFORE UPDATE ON household_balance_ledger
FOR EACH ROW
EXECUTE FUNCTION household_balance_ledger_enforce_append_only();

CREATE TRIGGER household_balance_ledger_append_only_delete
BEFORE DELETE ON household_balance_ledger
FOR EACH ROW
EXECUTE FUNCTION household_balance_ledger_enforce_append_only();
