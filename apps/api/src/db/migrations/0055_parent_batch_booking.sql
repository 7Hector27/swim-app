CREATE TABLE "booking_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"mode" text NOT NULL,
	"weekly_pattern_weekdays" integer[],
	"weekly_pattern_times" time[],
	"weekly_start_date" date,
	"weekly_weeks" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_batches_mode_valid" CHECK ("booking_batches"."mode" IN ('manual', 'weekly')),
	CONSTRAINT "booking_batches_weekly_fields_pair" CHECK ((
        ("booking_batches"."mode" = 'weekly'
         AND "booking_batches"."weekly_pattern_weekdays" IS NOT NULL
         AND "booking_batches"."weekly_pattern_times" IS NOT NULL
         AND "booking_batches"."weekly_start_date" IS NOT NULL
         AND "booking_batches"."weekly_weeks" IS NOT NULL
         AND array_length("booking_batches"."weekly_pattern_weekdays", 1)
             = array_length("booking_batches"."weekly_pattern_times", 1))
        OR
        ("booking_batches"."mode" = 'manual'
         AND "booking_batches"."weekly_pattern_weekdays" IS NULL
         AND "booking_batches"."weekly_pattern_times" IS NULL
         AND "booking_batches"."weekly_start_date" IS NULL
         AND "booking_batches"."weekly_weeks" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "booking_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_lesson_event_sequence_uniq";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_event_valid";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ALTER COLUMN "lesson_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_batches" ADD CONSTRAINT "booking_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_batches" ADD CONSTRAINT "booking_batches_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_batches_household_created_idx" ON "booking_batches" USING btree ("household_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_batch_id_booking_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."booking_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_batch_id_booking_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."booking_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_email_outbox_lesson_event_seq_uq" ON "lesson_email_outbox" USING btree ("lesson_id","event","sequence") WHERE lesson_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_email_outbox_batch_event_seq_uq" ON "lesson_email_outbox" USING btree ("batch_id","event","sequence") WHERE batch_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lesson_email_outbox_batch_created_idx" ON "lesson_email_outbox" USING btree ("batch_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_scope_exactly_one" CHECK ((CASE WHEN "lesson_email_outbox"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN "lesson_email_outbox"."batch_id" IS NOT NULL THEN 1 ELSE 0 END) = 1);--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_event_valid" CHECK ("lesson_email_outbox"."event" IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled', 'batch_booked', 'batch_approved', 'batch_canceled'));