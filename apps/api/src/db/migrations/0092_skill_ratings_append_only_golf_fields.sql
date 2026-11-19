-- Custom migration: extend the skill_ratings append-only trigger to cover
-- the two golf-score fields (time_seconds, stroke_count_value) added in
-- 0091, plus golf_score_category (never locked down, overlooked in 0062).
-- Corrections continue to live as new rows via supersedes_rating_id.
--
-- Mirrors 0062, which relaxed the trigger to permit supersede fields on
-- the predecessor. Every UPDATE path in app code (see routes/evaluations.ts)
-- only touches void / supersede columns, so tightening these extra checks
-- doesn't break any live mutation path.

CREATE OR REPLACE FUNCTION skill_ratings_enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF
    NEW.session_id        IS DISTINCT FROM OLD.session_id        OR
    NEW.swimmer_id        IS DISTINCT FROM OLD.swimmer_id        OR
    NEW.skill_id          IS DISTINCT FROM OLD.skill_id          OR
    NEW.coach_id          IS DISTINCT FROM OLD.coach_id          OR
    NEW.grade             IS DISTINCT FROM OLD.grade             OR
    NEW.not_legal         IS DISTINCT FROM OLD.not_legal         OR
    NEW.no_concept        IS DISTINCT FROM OLD.no_concept        OR
    NEW.side              IS DISTINCT FROM OLD.side              OR
    NEW.capacity_value    IS DISTINCT FROM OLD.capacity_value    OR
    NEW.capacity_unit     IS DISTINCT FROM OLD.capacity_unit     OR
    NEW.measurement_value IS DISTINCT FROM OLD.measurement_value OR
    NEW.measurement_unit  IS DISTINCT FROM OLD.measurement_unit  OR
    NEW.golf_score_category IS DISTINCT FROM OLD.golf_score_category OR
    NEW.time_seconds        IS DISTINCT FROM OLD.time_seconds        OR
    NEW.stroke_count_value  IS DISTINCT FROM OLD.stroke_count_value  OR
    NEW.note              IS DISTINCT FROM OLD.note              OR
    NEW.rated_at          IS DISTINCT FROM OLD.rated_at          OR
    NEW.created_at        IS DISTINCT FROM OLD.created_at        OR
    NEW.supersedes_rating_id IS DISTINCT FROM OLD.supersedes_rating_id
  THEN
    RAISE EXCEPTION 'skill_ratings rows are append-only; only void fields, supersede fields, and updated_at may change';
  END IF;
  RETURN NEW;
END;
$$;
