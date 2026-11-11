// Payload shape for the `balance_cashed_out` outbox event (ADR 036
// Phase 8 Part B). Written inside the executeCashOut transaction that
// writes the cash_refund + balance_writeoff ledger rows; the renderer /
// sender treat the payload as frozen — never read the live ledger.
// API-internal, not exported through @swim-app/shared.

export interface BalanceCashedOutEmailPayload {
  kind: "balance_cashed_out";
  // Sum of every card_topup + package_purchase for the household, in
  // integer cents. The "paid" line the family sees.
  totalCardPaidCents: number;
  // Sum of cash_refund rows that EXISTED PRIOR to this cash-out (not
  // including the rows the current cash-out just wrote). Carried for
  // transparency so a family that was previously partially refunded
  // sees why the current refund amount doesn't match their total paid.
  totalCashRefundedPriorCents: number;
  // Net lesson spending: -(sum of lesson_charge + refund_to_balance).
  // The amount of the balance the family has already "used".
  netLessonSpendingCents: number;
  // How much is going back to the card on this cash-out. Positive cents.
  refundableCents: number;
  // How much is being written off (bonus credit + coach gifts +
  // unallocatable residual). Positive cents.
  writeOffCents: number;
  // Deep link to /account/balance so the family can confirm. Writer
  // resolves this from siteUrl at outbox-write time.
  deepLink: string;
  // Snapshotted first name of the coach at outbox-write time. Null
  // falls back to a generic closing in the renderer.
  coachFirstName: string | null;
}
