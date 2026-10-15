CREATE TABLE "coach_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"session_id" uuid,
	"lesson_id" uuid,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_notes_body_not_blank" CHECK ("coach_notes"."body" <> '')
);
--> statement-breakpoint
ALTER TABLE "coach_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_session_id_evaluation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."evaluation_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_notes" ADD CONSTRAINT "coach_notes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;