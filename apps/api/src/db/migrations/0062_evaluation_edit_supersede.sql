ALTER TABLE "evaluation_sessions" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "superseded_by_rating_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "supersedes_rating_id" uuid;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_superseded_by_profiles_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_superseded_by_rating_id_skill_ratings_id_fk" FOREIGN KEY ("superseded_by_rating_id") REFERENCES "public"."skill_ratings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_supersedes_rating_id_skill_ratings_id_fk" FOREIGN KEY ("supersedes_rating_id") REFERENCES "public"."skill_ratings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "supersede_fields_consistent" CHECK (("skill_ratings"."superseded_at" IS NULL AND "skill_ratings"."superseded_by" IS NULL AND "skill_ratings"."superseded_by_rating_id" IS NULL)
          OR ("skill_ratings"."superseded_at" IS NOT NULL AND "skill_ratings"."superseded_by" IS NOT NULL AND "skill_ratings"."superseded_by_rating_id" IS NOT NULL));--> statement-breakpoint

-- Phase 2 trigger changes. Drizzle-kit can't express these.
-- Relax skill_ratings_append_only to allow the three supersede fields on the
-- predecessor and supersedes_rating_id on the correction. Every other column
-- stays locked after insert. ADR 032.
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
    NEW.created_at    IS DISTINCT FROM OLD.created_at    OR
    NEW.supersedes_rating_id IS DISTINCT FROM OLD.supersedes_rating_id
  THEN
    RAISE EXCEPTION 'skill_ratings rows are append-only; only void fields, supersede fields, and updated_at may change';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- evaluation_sessions_immutable_columns: ADR 022 made sessions immutable; ADR
-- 032 relaxes that to let coaches edit the four metadata columns
-- (session_date, context, coaching_priority, breathing_pattern) plus
-- edited_at + updated_at in place. Identity columns stay locked at the DB.
CREATE OR REPLACE FUNCTION evaluation_sessions_enforce_immutable_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF
    NEW.id            IS DISTINCT FROM OLD.id            OR
    NEW.swimmer_id    IS DISTINCT FROM OLD.swimmer_id    OR
    NEW.coach_id      IS DISTINCT FROM OLD.coach_id      OR
    NEW.category_id   IS DISTINCT FROM OLD.category_id   OR
    NEW.screen_slug   IS DISTINCT FROM OLD.screen_slug   OR
    NEW.created_at    IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'evaluation_sessions identity columns (id, swimmer_id, coach_id, category_id, screen_slug, created_at) are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER evaluation_sessions_immutable_columns
BEFORE UPDATE ON evaluation_sessions
FOR EACH ROW
EXECUTE FUNCTION evaluation_sessions_enforce_immutable_columns();
