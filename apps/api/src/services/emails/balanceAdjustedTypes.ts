// Payload shape for the `balance_adjusted` outbox event (ADR 036 Phase 7).
// Written inside the coach's adjust-balance transaction so the family
// email ships with the ledger row or rolls back with it. API-internal,
// not exported through @swim-app/shared.

export interface BalanceAdjustedEmailPayload {
  kind: "balance_adjusted";
  // Signed cents the coach entered. Positive → credit, negative → debit.
  // Zero is rejected upstream by the adjust-balance validator, so the
  // renderer never has to render a $0 line.
  amountCents: number;
  // Household balance AFTER the adjustment landed. Snapshotted so later
  // ledger activity doesn't retroactively repaint this email.
  newBalanceCents: number;
  // Coach's note verbatim. Capped at 500 chars upstream by the adjust
  // body schema; the family will see it, so the modal copy ("The family
  // will see this reason.") warns Jason before he hits Save.
  reason: string;
  // Deep link to /account/balance so the parent can see the ledger row.
  deepLink: string;
  // Snapshotted coach first name — same rule as every other email.
  coachFirstName: string | null;
}
