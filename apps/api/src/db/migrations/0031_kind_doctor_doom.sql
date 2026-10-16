CREATE TABLE "evaluation_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"screen_slug" text NOT NULL,
	"session_date" date,
	"context" "evaluation_context",
	"coaching_priority" text,
	"breathing_pattern" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_coach_swimmer_screen_unique" UNIQUE("coach_id","swimmer_id","screen_slug"),
	CONSTRAINT "draft_screen_slug_valid" CHECK ("evaluation_drafts"."screen_slug" IN ('fundamentals','water-confidence','freestyle','backstroke','breaststroke','butterfly','starts','im-turns','racing')),
	CONSTRAINT "draft_breathing_pattern_valid" CHECK ("evaluation_drafts"."breathing_pattern" IS NULL OR "evaluation_drafts"."breathing_pattern" IN ('every_1','every_2','every_3','every_4','every_5','other'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluation_drafts" ADD CONSTRAINT "evaluation_drafts_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_drafts" ADD CONSTRAINT "evaluation_drafts_coach_id_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;