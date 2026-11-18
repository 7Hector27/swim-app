ALTER TYPE "public"."measurement_unit" ADD VALUE 'kicks_per_minute';--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "time_seconds" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD COLUMN "stroke_count_value" integer;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "golf_fields_together" CHECK (("skill_ratings"."time_seconds" IS NULL) = ("skill_ratings"."stroke_count_value" IS NULL));--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "golf_fields_require_category" CHECK ("skill_ratings"."time_seconds" IS NULL OR "skill_ratings"."golf_score_category" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "golf_fields_non_negative" CHECK (("skill_ratings"."time_seconds" IS NULL OR "skill_ratings"."time_seconds" >= 0)
          AND ("skill_ratings"."stroke_count_value" IS NULL OR "skill_ratings"."stroke_count_value" >= 0));