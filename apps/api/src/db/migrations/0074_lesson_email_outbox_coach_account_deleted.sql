ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_event_valid";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_scope_exactly_one";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_bulk_household_pair";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_event_valid" CHECK ("lesson_email_outbox"."event" IN ('booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired', 'lesson_canceled', 'lesson_rescheduled', 'batch_booked', 'batch_approved', 'batch_canceled', 'coach_booking_request', 'coach_bulk_cancel', 'coach_account_deleted'));--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_scope_exactly_one" CHECK (("lesson_email_outbox"."payload" ? '_scrubbed_at')
        OR ("lesson_email_outbox"."event" = 'coach_account_deleted')
        OR ((CASE WHEN "lesson_email_outbox"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN "lesson_email_outbox"."batch_id" IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN "lesson_email_outbox"."bulk_cancellation_id" IS NOT NULL THEN 1 ELSE 0 END) = 1));--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_bulk_household_pair" CHECK (("lesson_email_outbox"."payload" ? '_scrubbed_at')
        OR ("lesson_email_outbox"."event" = 'coach_account_deleted')
        OR (("lesson_email_outbox"."bulk_cancellation_id" IS NULL) = ("lesson_email_outbox"."household_id" IS NULL)));