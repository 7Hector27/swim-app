-- Read-only audit: find charged lessons that reached a terminal non-billable
-- status (canceled, declined, expired, no_show) but still have an outstanding
-- lesson_charge with no matching refund_to_balance ledger row.
--
-- Returns zero rows when every cancelled-ish lesson's charge has been
-- correctly offset by a refund. One row per leaked charge; grouped so a
-- lesson with multiple historic charges only shows the ones still
-- outstanding.
--
-- Safe to run against prod (SELECT only, no writes). Paste into the
-- Supabase SQL editor for axiom-aquatics-dev / prod as-is.

SELECT
  lesson.id                       AS lesson_id,
  lesson.household_id,
  lesson.status,
  lesson.starts_at,
  lesson.canceled_at,
  lesson.declined_at,
  charge.id                       AS outstanding_charge_ledger_id,
  charge.amount_cents             AS outstanding_charge_cents,
  charge.created_at               AS charge_created_at
FROM lessons AS lesson
JOIN household_balance_ledger AS charge
  ON charge.lesson_id = lesson.id
 AND charge.entry_type = 'lesson_charge'
LEFT JOIN household_balance_ledger AS refund
  ON refund.refund_of_ledger_id = charge.id
 AND refund.entry_type = 'refund_to_balance'
WHERE lesson.status IN ('canceled', 'declined', 'expired', 'no_show')
  AND refund.id IS NULL
ORDER BY lesson.starts_at DESC;
