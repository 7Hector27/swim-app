-- `password_changed` outbox event — direct-to-user security alert
-- fired after any successful password reset or change. Scope columns
-- (lesson_id, batch_id, bulk_cancellation_id, household_id) stay NULL
-- since the recipient is a profile, not a household — same shape coach_
-- account_deleted and the balance_* events already use. Extend each of
-- the three CHECK constraints to carve out this event.

ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_event_valid";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_scope_exactly_one";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT "lesson_email_outbox_bulk_household_pair";--> statement-breakpoint

ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_event_valid" CHECK (
  "lesson_email_outbox"."event" IN (
    'booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired',
    'lesson_canceled', 'lesson_rescheduled',
    'batch_booked', 'batch_approved', 'batch_canceled',
    'coach_booking_request', 'coach_bulk_cancel', 'coach_account_deleted',
    'balance_funded', 'balance_adjusted', 'balance_cashed_out',
    'password_changed'
  )
);--> statement-breakpoint

ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_scope_exactly_one" CHECK (
  ("lesson_email_outbox"."payload" ? '_scrubbed_at')
  OR ("lesson_email_outbox"."event" IN (
    'coach_account_deleted',
    'balance_funded', 'balance_adjusted', 'balance_cashed_out',
    'password_changed'
  ))
  OR ((CASE WHEN "lesson_email_outbox"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN "lesson_email_outbox"."batch_id" IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN "lesson_email_outbox"."bulk_cancellation_id" IS NOT NULL THEN 1 ELSE 0 END) = 1)
);--> statement-breakpoint

ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_bulk_household_pair" CHECK (
  ("lesson_email_outbox"."payload" ? '_scrubbed_at')
  OR ("lesson_email_outbox"."event" IN (
    'coach_account_deleted',
    'balance_funded', 'balance_adjusted', 'balance_cashed_out',
    'password_changed'
  ))
  OR (("lesson_email_outbox"."bulk_cancellation_id" IS NULL) = ("lesson_email_outbox"."household_id" IS NULL))
);
