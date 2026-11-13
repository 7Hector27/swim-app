import type { BalanceEntryType } from "../schemas/payments";

// Human-safe label for one household_balance_ledger row, surfaced by both
// the parent-facing GET /me/balance/history and the coach-facing GET
// /coach/households/:id/balance/history. The switch is exhaustive on
// BalanceEntryType; adding a new enum variant to BalanceEntryTypeSchema
// without adding a case here is a typecheck error via the `never` check.
export function balanceDisplayType(row: {
  entryType: BalanceEntryType;
  reason: string | null;
}): string {
  switch (row.entryType) {
    case "lesson_charge":
      return "Lesson";
    case "refund_to_balance":
      return "Refund";
    case "card_topup":
      return "Added credit";
    case "package_purchase":
      return "Package purchased";
    case "package_bonus":
      return "Package bonus credit";
    case "coach_adjustment":
      return row.reason ? `Jason adjusted · ${row.reason}` : "Jason adjusted";
    case "free_lesson":
      return "Free lesson";
    case "cash_refund":
      return "Refunded to your card";
    case "balance_writeoff":
      return "Unused bonus credit forfeited";
  }
  const exhaustive: never = row.entryType;
  return exhaustive;
}
