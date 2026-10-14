CREATE TYPE "public"."skill_side" AS ENUM('left', 'right');--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "fault_tags" text[];--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "side" "skill_side";