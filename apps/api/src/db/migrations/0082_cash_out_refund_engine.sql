-- ADR 036 Phase 8 Part B — cash-out refund engine.
--
-- Adds two ledger entry types (`cash_refund`, `balance_writeoff`),
-- relaxes three CHECK constraints to cover them, and introduces the
-- `cash_refund_jobs` table that the post-commit drain uses to call
-- Stripe refunds with idempotency.
--
-- Postgres forbids using a brand-new enum variant as an enum literal in
-- the same transaction as the `ALTER TYPE ADD VALUE` that introduced
-- it. drizzle-orm's postgres-js migrator wraps the whole migration
-- batch in one transaction, so references to the new variants here are
-- expressed via `entry_type::text IN (...)` instead of `entry_type IN
-- (...)`. Casting the column to `text` dodges the enum-literal check at
-- parse time; the comparison runs on strings and accepts the new
-- variants on the very next INSERT.

ALTER TYPE "balance_entry_type" ADD VALUE IF NOT EXISTS 'cash_refund';--> statement-breakpoint
ALTER TYPE "balance_entry_type" ADD VALUE IF NOT EXISTS 'balance_writeoff';--> statement-breakpoint

-- Relax amount-sign, stripe-scope, and refund-of-scope checks so the
-- two new entry types pass. The existing clauses are preserved verbatim
-- (modulo the ::text cast) so prior rows stay legal.

ALTER TABLE "household_balance_ledger" DROP CONSTRAINT IF EXISTS "balance_ledger_amount_sign_valid";--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "balance_ledger_amount_sign_valid" CHECK (
  (entry_type::text IN ('card_topup', 'package_purchase', 'package_bonus', 'refund_to_balance') AND amount_cents > 0)
  OR (entry_type::text = 'lesson_charge' AND amount_cents < 0)
  OR (entry_type::text = 'free_lesson' AND amount_cents = 0)
  OR (entry_type::text = 'coach_adjustment' AND amount_cents <> 0)
  OR (entry_type::text IN ('cash_refund', 'balance_writeoff') AND amount_cents < 0)
);--> statement-breakpoint

ALTER TABLE "household_balance_ledger" DROP CONSTRAINT IF EXISTS "balance_ledger_stripe_session_scope_valid";--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "balance_ledger_stripe_session_scope_valid" CHECK (
  (entry_type::text IN ('card_topup', 'package_purchase', 'package_bonus', 'cash_refund') AND stripe_checkout_session_id IS NOT NULL)
  OR (entry_type::text NOT IN ('card_topup', 'package_purchase', 'package_bonus', 'cash_refund') AND stripe_checkout_session_id IS NULL)
);--> statement-breakpoint

ALTER TABLE "household_balance_ledger" DROP CONSTRAINT IF EXISTS "balance_ledger_refund_of_scope_valid";--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "balance_ledger_refund_of_scope_valid" CHECK (
  (entry_type::text IN ('refund_to_balance', 'cash_refund') AND refund_of_ledger_id IS NOT NULL)
  OR (entry_type::text NOT IN ('refund_to_balance', 'cash_refund') AND refund_of_ledger_id IS NULL)
);--> statement-breakpoint

-- Email outbox: extend the three constraints 0081 touched so a
-- `balance_cashed_out` row can be inserted with only household_id set
-- (matching the balance_funded / balance_adjusted shape). The `event`
-- column is `text`, not an enum, so these are safe without the cast.

ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT IF EXISTS "lesson_email_outbox_event_valid";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_event_valid" CHECK (
  "lesson_email_outbox"."event" IN (
    'booking_requested', 'lesson_confirmed', 'request_declined', 'request_expired',
    'lesson_canceled', 'lesson_rescheduled',
    'batch_booked', 'batch_approved', 'batch_canceled',
    'coach_booking_request', 'coach_bulk_cancel', 'coach_account_deleted',
    'balance_funded', 'balance_adjusted', 'balance_cashed_out'
  )
);--> statement-breakpoint

ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT IF EXISTS "lesson_email_outbox_scope_exactly_one";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_scope_exactly_one" CHECK (
  ("lesson_email_outbox"."payload" ? '_scrubbed_at')
  OR ("lesson_email_outbox"."event" IN ('coach_account_deleted', 'balance_funded', 'balance_adjusted', 'balance_cashed_out'))
  OR ((CASE WHEN "lesson_email_outbox"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN "lesson_email_outbox"."batch_id" IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN "lesson_email_outbox"."bulk_cancellation_id" IS NOT NULL THEN 1 ELSE 0 END) = 1)
);--> statement-breakpoint

ALTER TABLE "lesson_email_outbox" DROP CONSTRAINT IF EXISTS "lesson_email_outbox_bulk_household_pair";--> statement-breakpoint
ALTER TABLE "lesson_email_outbox" ADD CONSTRAINT "lesson_email_outbox_bulk_household_pair" CHECK (
  ("lesson_email_outbox"."payload" ? '_scrubbed_at')
  OR ("lesson_email_outbox"."event" IN ('coach_account_deleted', 'balance_funded', 'balance_adjusted', 'balance_cashed_out'))
  OR (("lesson_email_outbox"."bulk_cancellation_id" IS NULL) = ("lesson_email_outbox"."household_id" IS NULL))
);--> statement-breakpoint

-- New status enum + job table.

CREATE TYPE "cash_refund_job_status" AS ENUM ('pending', 'succeeded', 'needs_manual_handling');--> statement-breakpoint

CREATE TABLE "cash_refund_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ledger_id" uuid NOT NULL UNIQUE REFERENCES "household_balance_ledger"("id"),
  "household_id" uuid REFERENCES "households"("id") ON DELETE SET NULL,
  "stripe_payment_intent_id" text NOT NULL,
  "idempotency_key" uuid NOT NULL UNIQUE,
  "amount_cents" integer NOT NULL,
  "status" cash_refund_job_status NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "claimed_until" timestamptz,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_error" text,
  "last_attempt_at" timestamptz,
  "stripe_refund_id" text,
  "succeeded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cash_refund_jobs_amount_positive" CHECK ("amount_cents" > 0)
);--> statement-breakpoint

ALTER TABLE "cash_refund_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE INDEX "cash_refund_jobs_drain_idx" ON "cash_refund_jobs" ("next_attempt_at") WHERE status = 'pending';
