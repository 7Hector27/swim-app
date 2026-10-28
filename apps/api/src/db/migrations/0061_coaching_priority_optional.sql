ALTER TABLE "evaluation_sessions" DROP CONSTRAINT "coaching_priority_not_blank";--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ALTER COLUMN "coaching_priority" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD CONSTRAINT "coaching_priority_not_blank" CHECK ("evaluation_sessions"."coaching_priority" IS NULL OR "evaluation_sessions"."coaching_priority" <> '');