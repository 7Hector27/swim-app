CREATE TABLE "lesson_email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"event" text NOT NULL,
	"sequence" integer NOT NULL,
	"recipient_profile_ids" uuid[] NOT NULL,
	"ics_method" text,
	"ics_sequence" integer,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_email_outbox_lesson_event_sequence_uniq" UNIQUE("lesson_id","event","sequence"),
	CONSTRAINT "lesson_email_outbox_event_valid" CHECK ("lesson_email_outbox"."event" IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled')),
	CONSTRAINT "lesson_email_outbox_status_valid" CHECK ("lesson_email_outbox"."status" IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'superseded')),
	CONSTRAINT "lesson_email_outbox_ics_pair" CHECK (("lesson_email_outbox"."ics_method" IS NULL) = ("lesson_email_outbox"."ics_sequence" IS NULL)),
	CONSTRAINT "lesson_email_outbox_claim_pair" CHECK (("lesson_email_outbox"."status" = 'sending') = ("lesson_email_outbox"."claimed_until" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "calendar_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "calendar_invite_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_email_outbox_drain_idx" ON "lesson_email_outbox" USING btree ("next_attempt_at") WHERE status IN ('pending', 'failed', 'sending');--> statement-breakpoint
CREATE INDEX "lesson_email_outbox_lesson_created_idx" ON "lesson_email_outbox" USING btree ("lesson_id","created_at" DESC NULLS LAST);