ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_scope_exactly_one";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_bulk_household_pair";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_scope_exactly_one" CHECK (("lesson_email_outbox"."payload" ? '_scrubbed_at')
        OR ((CASE WHEN "lesson_email_outbox"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN "lesson_email_outbox"."batch_id" IS NOT NULL THEN 1 ELSE 0 END)
          + (CASE WHEN "lesson_email_outbox"."bulk_cancellation_id" IS NOT NULL THEN 1 ELSE 0 END) = 1));--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_bulk_household_pair" CHECK (("lesson_email_outbox"."payload" ? '_scrubbed_at')
        OR (("lesson_email_outbox"."bulk_cancellation_id" IS NULL) = ("lesson_email_outbox"."household_id" IS NULL)));