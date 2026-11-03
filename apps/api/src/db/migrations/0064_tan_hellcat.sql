CREATE TABLE "bulk_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_profile_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"location_id" uuid,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_cancellations_end_on_or_after_start" CHECK ("bulk_cancellations"."end_date" >= "bulk_cancellations"."start_date"),
	CONSTRAINT "bulk_cancellations_message_length" CHECK ("bulk_cancellations"."message" IS NULL OR char_length("bulk_cancellations"."message") <= 500)
);
--> statement-breakpoint
ALTER TABLE "bulk_cancellations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_event_valid";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_scope_exactly_one";--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD COLUMN "bulk_cancellation_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "bulk_cancellations" ADD CONSTRAINT "bulk_cancellations_coach_profile_id_profiles_id_fk" FOREIGN KEY ("coach_profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_cancellations" ADD CONSTRAINT "bulk_cancellations_location_id_lesson_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."lesson_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_cancellations_coach_created_idx" ON "bulk_cancellations" USING btree ("coach_profile_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "blocked_times" ADD CONSTRAINT "blocked_times_location_id_lesson_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."lesson_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_bulk_cancellation_id_bulk_cancellations_id_fk" FOREIGN KEY ("bulk_cancellation_id") REFERENCES "public"."bulk_cancellations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_email_outbox_bulk_household_event_seq_uq" ON "lesson_email_outbox" USING btree ("bulk_cancellation_id","household_id","event","sequence") WHERE bulk_cancellation_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lesson_email_outbox_bulk_created_idx" ON "lesson_email_outbox" USING btree ("bulk_cancellation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_bulk_household_pair" CHECK (("lesson_email_outbox"."bulk_cancellation_id" IS NULL) = ("lesson_email_outbox"."household_id" IS NULL));--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_event_valid" CHECK ("lesson_email_outbox"."event" IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled', 'batch_booked', 'batch_approved', 'batch_canceled', 'coach_booking_request', 'coach_bulk_cancel'));--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_scope_exactly_one" CHECK ((CASE WHEN "lesson_email_outbox"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN "lesson_email_outbox"."batch_id" IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN "lesson_email_outbox"."bulk_cancellation_id" IS NOT NULL THEN 1 ELSE 0 END) = 1);