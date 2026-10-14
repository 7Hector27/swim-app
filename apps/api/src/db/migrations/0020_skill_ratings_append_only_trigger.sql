-- Custom migration: hand-written because Drizzle-kit cannot express triggers.
-- Enforces the append-only rule from ADR 022: after insert, only voided_at,
-- void_reason, void_by, and updated_at may change.

CREATE OR REPLACE FUNCTION skill_ratings_enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF
    NEW.session_id    IS DISTINCT FROM OLD.session_id    OR
    NEW.swimmer_id    IS DISTINCT FROM OLD.swimmer_id    OR
    NEW.skill_id      IS DISTINCT FROM OLD.skill_id      OR
    NEW.coach_id      IS DISTINCT FROM OLD.coach_id      OR
    NEW.grade         IS DISTINCT FROM OLD.grade         OR
    NEW.not_legal     IS DISTINCT FROM OLD.not_legal     OR
    NEW.no_concept    IS DISTINCT FROM OLD.no_concept    OR
    NEW.side          IS DISTINCT FROM OLD.side          OR
    NEW.capacity_value  IS DISTINCT FROM OLD.capacity_value  OR
    NEW.capacity_unit   IS DISTINCT FROM OLD.capacity_unit   OR
    NEW.measurement_value IS DISTINCT FROM OLD.measurement_value OR
    NEW.measurement_unit  IS DISTINCT FROM OLD.measurement_unit  OR
    NEW.note          IS DISTINCT FROM OLD.note          OR
    NEW.rated_at      IS DISTINCT FROM OLD.rated_at      OR
    NEW.created_at    IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'skill_ratings rows are append-only; only void fields and updated_at may change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER skill_ratings_append_only
BEFORE UPDATE ON skill_ratings
FOR EACH ROW
EXECUTE FUNCTION skill_ratings_enforce_append_only();
