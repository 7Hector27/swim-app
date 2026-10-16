ALTER TABLE "evaluation_sessions" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD COLUMN "screen_slug" text;--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD COLUMN "breathing_pattern" text;--> statement-breakpoint
ALTER TABLE "swimmers" ADD COLUMN "recommended_breathing_pattern" text;