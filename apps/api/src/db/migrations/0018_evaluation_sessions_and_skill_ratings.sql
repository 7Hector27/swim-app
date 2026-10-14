-- Custom migration: written by hand because drizzle-kit cannot create new
-- pg enums in non-interactive mode (promptNamedWithSchemasConflict requires a TTY).

CREATE TYPE "public"."evaluation_context" AS ENUM('drill', 'practice', 'race');
CREATE TYPE "public"."rating_side" AS ENUM('left', 'right');
CREATE TYPE "public"."capacity_unit" AS ENUM('yards', 'reps');
CREATE TYPE "public"."measurement_unit" AS ENUM('stroke_cycles_per_minute', 'stroke_count', 'seconds', 'feet');

CREATE TABLE "evaluation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "swimmer_id" uuid NOT NULL,
  "coach_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "session_date" date NOT NULL,
  "context" "evaluation_context" NOT NULL,
  "coaching_priority" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "coaching_priority_not_blank" CHECK ("coaching_priority" <> '')
);

ALTER TABLE "evaluation_sessions"
  ADD CONSTRAINT "evaluation_sessions_swimmer_id_swimmers_id_fk"
    FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "evaluation_sessions_coach_id_profiles_id_fk"
    FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "evaluation_sessions_category_id_skill_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."skill_categories"("id") ON DELETE RESTRICT;

ALTER TABLE "evaluation_sessions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "skill_ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "swimmer_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "coach_id" uuid NOT NULL,
  "grade" integer,
  "not_legal" boolean DEFAULT false NOT NULL,
  "no_concept" boolean DEFAULT false NOT NULL,
  "side" "rating_side",
  "capacity_value" numeric,
  "capacity_unit" "capacity_unit",
  "measurement_value" numeric,
  "measurement_unit" "measurement_unit",
  "note" text,
  "voided_at" timestamptz,
  "void_reason" text,
  "void_by" uuid,
  "rated_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "grade_xor_no_concept" CHECK (
    ("no_concept" = false AND "grade" IS NOT NULL AND "grade" >= 1 AND "grade" <= 5)
    OR ("no_concept" = true AND "grade" IS NULL)
  ),
  CONSTRAINT "capacity_value_and_unit_consistent" CHECK (
    ("capacity_value" IS NULL) = ("capacity_unit" IS NULL)
  ),
  CONSTRAINT "measurement_value_and_unit_consistent" CHECK (
    ("measurement_value" IS NULL) = ("measurement_unit" IS NULL)
  ),
  CONSTRAINT "void_fields_consistent" CHECK (
    ("voided_at" IS NULL AND "void_reason" IS NULL AND "void_by" IS NULL)
    OR ("voided_at" IS NOT NULL AND "void_reason" IS NOT NULL AND "void_by" IS NOT NULL)
  )
);

ALTER TABLE "skill_ratings"
  ADD CONSTRAINT "skill_ratings_session_id_evaluation_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."evaluation_sessions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "skill_ratings_swimmer_id_swimmers_id_fk"
    FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "skill_ratings_skill_id_skills_id_fk"
    FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "skill_ratings_coach_id_profiles_id_fk"
    FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "skill_ratings_void_by_profiles_id_fk"
    FOREIGN KEY ("void_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;

ALTER TABLE "skill_ratings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "rating_fault_tags" (
  "rating_id" uuid NOT NULL,
  "fault_tag" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "rating_fault_tags_rating_id_fault_tag_pk" PRIMARY KEY ("rating_id", "fault_tag")
);

ALTER TABLE "rating_fault_tags"
  ADD CONSTRAINT "rating_fault_tags_rating_id_skill_ratings_id_fk"
    FOREIGN KEY ("rating_id") REFERENCES "public"."skill_ratings"("id") ON DELETE CASCADE;

ALTER TABLE "rating_fault_tags" ENABLE ROW LEVEL SECURITY;
