-- ADR 036 Phase 8 Part B Stop 2 — unmatched-residual + manual-handling
-- columns on cash_refund_jobs, and coach_notifications gets a new
-- category so the needs-manual-handling banner has a feed.

-- Relax ledger checks: `cash_refund` MAY have null stripe ids (when
-- the refundable residual couldn't be matched to a live card payment).
ALTER TABLE "household_balance_ledger" DROP CONSTRAINT IF EXISTS "balance_ledger_stripe_session_scope_valid";--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "balance_ledger_stripe_session_scope_valid" CHECK (
  (entry_type::text IN ('card_topup', 'package_purchase', 'package_bonus') AND stripe_checkout_session_id IS NOT NULL)
  OR (entry_type::text = 'cash_refund')
  OR (entry_type::text NOT IN ('card_topup', 'package_purchase', 'package_bonus', 'cash_refund') AND stripe_checkout_session_id IS NULL)
);--> statement-breakpoint

ALTER TABLE "household_balance_ledger" DROP CONSTRAINT IF EXISTS "balance_ledger_refund_of_scope_valid";--> statement-breakpoint
ALTER TABLE "household_balance_ledger" ADD CONSTRAINT "balance_ledger_refund_of_scope_valid" CHECK (
  (entry_type::text = 'refund_to_balance' AND refund_of_ledger_id IS NOT NULL)
  OR (entry_type::text = 'cash_refund')
  OR (entry_type::text NOT IN ('refund_to_balance', 'cash_refund') AND refund_of_ledger_id IS NULL)
);--> statement-breakpoint

ALTER TABLE "cash_refund_jobs" ALTER COLUMN "stripe_payment_intent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_refund_jobs" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "cash_refund_jobs" ADD COLUMN "needs_manual_reason" text;--> statement-breakpoint
ALTER TABLE "cash_refund_jobs" ADD COLUMN "resolved_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cash_refund_jobs" ADD CONSTRAINT "succeeded_requires_timestamp" CHECK (status <> 'succeeded' OR succeeded_at IS NOT NULL);--> statement-breakpoint

ALTER TABLE "coach_notifications" DROP CONSTRAINT IF EXISTS "coach_notifications_category_valid";--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_category_valid" CHECK (
  "coach_notifications"."category" IN ('booking_request', 'request_expiring_soon', 'parent_change', 'calendar_disconnected', 'auto_approved_summary', 'daily_summary', 'account_deleted', 'cash_refund_needs_manual_handling')
);--> statement-breakpoint

-- The scope CHECK was previously keyed only to the pre-Stop-2 category
-- set; relax it so the new category (which carries neither lesson_id
-- nor batch_id) also satisfies the rule. Preserves the per-lesson xor
-- rule and the "no scope columns" posture for summary categories.
ALTER TABLE "coach_notifications" DROP CONSTRAINT IF EXISTS "coach_notifications_scope_valid";--> statement-breakpoint
ALTER TABLE "coach_notifications" ADD CONSTRAINT "coach_notifications_scope_valid" CHECK (
  (
    "coach_notifications"."category" IN ('booking_request', 'request_expiring_soon', 'parent_change', 'auto_approved_summary')
    AND ((CASE WHEN "coach_notifications"."lesson_id" IS NOT NULL THEN 1 ELSE 0 END)
       + (CASE WHEN "coach_notifications"."batch_id" IS NOT NULL THEN 1 ELSE 0 END) = 1)
  )
  OR (
    "coach_notifications"."category" IN ('calendar_disconnected', 'daily_summary', 'account_deleted', 'cash_refund_needs_manual_handling')
    AND "coach_notifications"."lesson_id" IS NULL AND "coach_notifications"."batch_id" IS NULL
  )
);
