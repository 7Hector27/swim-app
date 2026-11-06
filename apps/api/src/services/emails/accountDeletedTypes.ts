// Payload shape for the coach-side `coach_account_deleted` outbox event
// (ADR 034). Carries only what Jason needs to know a slot opened up — no
// family name, no swimmer names, no pool addresses. The template reads
// this shape directly; the sender resolves the recipient at send time.

export interface AccountDeletedEmailLesson {
  // ISO UTC start — kept for completeness and reporting. The template
  // renders the LA-local display below.
  startsAtUtc: string;
  // Pre-formatted LA wall-time display ("Sat, Nov 1, 2026 at 10:30 AM").
  // Composed at enqueue time so the renderer stays a pure function of
  // the frozen payload.
  startsAtLocalDisplay: string;
  // "Home pool" when the lesson was at a family's residence, otherwise
  // the named pool (e.g. "Egret Park"). NEVER the family's actual
  // address — docs/accounts.md kids'-data rules apply.
  poolLabel: string;
}

export interface AccountDeletedEmailPayload {
  kind: "account_deleted_email";
  // Freed-up lesson summaries. Empty array when no upcoming lessons were
  // affected (never-booked family or a family with only past lessons) —
  // the template renders "No upcoming lessons were affected" in that
  // branch.
  cancelledLessons: AccountDeletedEmailLesson[];
  // The URL the template's CTA button points at — matches the account_
  // deleted notification's clickUrl (ADR 034): coach schedule day view on
  // the first freed lesson's LA date, or today view when the list is
  // empty.
  scheduleUrl: string;
  // Deletion timestamp (ISO UTC). Audit trail for the payload.
  deletedAtUtc: string;
}
