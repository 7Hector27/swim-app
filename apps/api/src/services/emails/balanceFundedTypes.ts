// Payload shape for the `balance_funded` outbox event (ADR 036 Phase 7).
// Written inside the Stripe webhook's household-balance transaction; the
// renderer / sender treat the payload as frozen — never read the live
// ledger. API-internal, not exported through @swim-app/shared.

export type BalanceFundedKind = "topup" | "package";

export interface BalanceFundedEmailPayload {
  kind: "balance_funded";
  // "topup" → card_topup row. "package" → package_purchase + package_bonus
  // pair written in the same transaction; the renderer shows the two
  // amounts separately.
  type: BalanceFundedKind;
  // What the parent paid at Stripe, in integer cents. For a package this
  // is the discounted price (what the card was charged); the bonus is
  // reported separately below.
  amountPaidCents: number;
  // Package bonus credit in integer cents. 0 for a straight top-up.
  // Always ≥ 0 — never negative in a success payload.
  bonusCents: number;
  // Household balance AFTER both rows landed. Snapshotted so a later
  // ledger write (another lesson charge, another refund) doesn't rewrite
  // the number the family sees in this email.
  newBalanceCents: number;
  // Deep link to /account/balance so the family can see the ledger. The
  // writer resolves this from siteUrl at outbox-write time.
  deepLink: string;
  // Snapshotted first name of the coach at outbox-write time. Used in
  // body copy ("…Jason's weekly schedule"); null falls back to a generic
  // closing. Matches the other email payloads so one rename later
  // never retroactively repaints a scheduled email.
  coachFirstName: string | null;
}
