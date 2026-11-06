# 036 — Payments and prepaid household balance via Stripe

**Date:** 2026-11-06 (revised)
**Status:** Draft — pending Jason's answer on the unused-balance policy in `docs/plans/payments.md` §6

## Context

Before this ADR there is no money flow in the app. Lessons book freely against Jason's calendar, and billing happens off-platform. Jason has set the v1 payment model himself: every household carries a single prepaid balance in cents; parents fund it by card through Stripe (no Venmo, no manual-payment stage, no balance import); bookings charge the balance at booking time; cancellations, declines, bulk-cancels, no-shows, and pending-expirations refund it in full with no cutoff; the coach can book any family and chooses to either charge their balance or mark the lesson free. Credit never expires.

Pricing is fixed: $120/hr private billed by the minute, with sibling rates per hour of 2=$180, 3=$198, 4=$216. The only cents value anywhere in the system is $0.50 (from 3 swimmers × 45 minutes = $148.50). Two packages, "Cannonball" (10 hr, 10% off) and "Deep End" (20 hr, 20% off), each sized for 1–4 swimmers; the package price is credit × (1 − discount) and the customer sees "pay $1,080, get $1,200 of lesson credit." There is no travel fee, no age gate on duration, and no "add any amount" free-form field. Jason absorbs the Stripe fee.

The architecture question is how to turn those rules into a durable, append-only, concurrency-safe money ledger integrated with the existing booking lifecycle (ADR 021), with reliable Stripe webhook handling, maximum data minimization on the Stripe boundary, and a clean story for what happens when a family leaves (ADR 034).

The planning doc at `docs/plans/payments.md` carries the full step-by-step. This ADR records the architectural decisions it depends on. One decision — unused-balance policy on request and on account deletion — remains draft until Jason picks between the three options in the plan's §6 (recommendation: Option A).

## Decision

### One append-only ledger per household, balance derived by sum

A new table `household_balance_ledger` stores every balance movement: card top-ups, package purchases, package bonuses (the discount portion), lesson charges, refunds, coach adjustments, and `free_lesson` markers. Rows are append-only; an `UPDATE` / `DELETE` trigger rejects mutation, mirroring the posture `skill_ratings` has carried since ADR 022 (and reaffirmed in ADR 032). Account deletion (ADR 034) is the single documented exception — and for payments, that exception is weaker than the skills-ledger one: ledger rows are **anonymized, not deleted** (see "Account deletion anonymizes, not deletes" below).

Balance is `SELECT COALESCE(SUM(amount_cents), 0) FROM household_balance_ledger WHERE household_id = $1`. No denormalized balance column. Jason's expected throughput (order hundreds of entries per household per year) keeps the sum sub-millisecond under the `(household_id)` index; if that ever stops being true, the fix is a materialized view the trigger refreshes, not a stored column that can drift from the append-only source of truth.

Every ledger insert is paired with a `household_audit_log` insert in the **same transaction** (CLAUDE.md rule). If either insert fails, the whole transaction rolls back — no ledger row ever exists without its audit row, and no audit row exists without the ledger row it refers to.

Alternatives considered:

- **Stored `households.balance_cents` with mutating updates.** Rejected. The ledger is the audit trail for money; losing the ability to reconstruct how the current number was reached would fail any serious reconciliation question ("how much promotional credit did we give out this month?", "did this family ever get refunded for lesson X?"). A sum over an append-only table answers both for free.
- **Ledger-only, no audit log.** Rejected. The audit log carries the acting profile and the surrounding context (lesson id, Stripe session id, reason text) that the ledger row's constrained shape can't; both are the right abstraction.
- **Soft-delete on the ledger (tombstone rows).** Rejected. Any mutation is a legal footgun for a payments ledger. Correction = a new row with the inverse amount, categorized as `coach_adjustment` with a reason.

### Refunds read the `lesson_charge` ledger row — no price-lock column on `lessons`

Each successful booking writes one `lesson_charge` row with `lesson_id` set and `amount_cents` equal to the negative of `priceForLesson(duration, swimmerCount)` at the moment of booking. Every refund path (cancellation, decline, bulk-cancel, no-show, expired-pending) reads that row by `lesson_id` and writes a `refund_to_balance` with the inverse amount in the same transaction as the status change. A lesson with no matching `lesson_charge` — a coach-booked free lesson, a pre-payments-era row that somehow surfaces — refunds **$0** by design (no row to invert, no error thrown).

This replaces an earlier draft that locked the price onto the lesson row (`lessons.price_cents_at_booking`). Keeping the authoritative amount on the ledger entry has two advantages: there is one source of truth for money, not two to keep in sync; and the "lesson exists but no charge row" case (free lessons) is self-resolving — the refund path simply finds nothing and no-ops.

No backfill is required. Production launches empty per Jason's brief; dev data is test data.

Alternatives considered:

- **Column `lessons.price_cents_at_booking`, refunds read the lesson.** Rejected on second review. Adds a nullable column whose only correct value is a copy of the matching ledger row, requires a NOT NULL migration and a backfill decision that production launching empty makes irrelevant, and forces every "is this lesson billable?" question to join across two tables that already encode the same number.
- **Recompute price from current rates at refund time.** Rejected. Means a pending lesson's refund amount differs from its charge amount if Jason edited rates in between.

### Package purchase writes two ledger rows atomically

A package charges the parent `price` and credits them `credit` where `credit > price`. The handler writes two rows in the same transaction: a `package_purchase` entry for the actual card charge (what Stripe settled) and a `package_bonus` entry for the discount delta (`credit − price`). The balance moves by `credit` atomically — any concurrent `GET /me/balance` sees either the pre-commit state or the full post-commit state, never halfway.

Why split: "how much promotional credit did we give out?" is a single-row `GROUP BY entry_type` query. "How much actual money came in through packages?" is the same, on the other type. A single-row design would force every reconciliation query to parse a sidecar column.

### Pricing is a pure module in `packages/shared`, one source of truth

`packages/shared/src/pricing/` exports `priceForLesson(durationMinutes, swimmerCount)`, `packagePrice(tier, swimmerCount)`, `hourlyRateCents(swimmerCount)`, and `approximatePrivateHours(balanceCents)`. All amounts are integer cents. The twelve `priceForLesson` combinations and eight `packagePrice` combinations are enumerated in unit tests, including the one half-dollar case (`(3 swimmers, 45 min) = $148.50`).

The API is the authoritative caller — the server computes every price fresh from this module before inserting any ledger or lesson row and **never accepts a price from the client**. The web app imports the same module for display on the booking screens and package cards; this is identical math by construction.

Pricing is not sensitive. It lives freely in client-side bundles. Stripe-side Products/Prices are not used; each Checkout session's line items carry an integer-cents amount computed by the API at session-creation time, keeping the repo as the single source of truth.

### Reschedule is time-only; duration or swimmer changes are cancel-and-rebook

`PATCH /lessons/:id` can only change the start time. Duration and swimmer-set changes are rejected at the API — the existing booking decision across the app's reschedule flows is "cancel and rebook," and the payments layer honors it: a reschedule touches no money because the pricing inputs cannot change, and no delta row is ever written. A cancel-and-rebook sequence is the familiar `refund_to_balance` (from cancel) plus a fresh `lesson_charge` (from rebook) at whatever the current pricing module returns.

This is a change from an earlier draft that included price-delta logic on reschedule. Not needed.

### Stripe hosted Checkout, not Elements, for v1

The parent redirects to a Stripe-hosted Checkout page. Card data is entered on `checkout.stripe.com` and never touches our pages, servers, or logs. Compliance posture is SAQ A. 3D Secure, Apple Pay, Google Pay, Link, and address collection come for free with no code on our side.

Alternatives considered:

- **Stripe Elements (inline card form).** Rejected for v1. Better UX, but costs implementation time, drops compliance posture to SAQ A-EP (still card-data-free but with extra paperwork), and gains little for an app whose top-up cadence is ≤ a dozen times per family per year. The webhook, ledger, data-minimization, and idempotency contracts here all survive a future Elements migration if conversion telemetry justifies it.
- **Stripe Payment Links.** Rejected. Links don't carry household metadata cleanly and can't be parameterized with per-household amounts at creation time without API work anyway.

### Stripe data-minimization principle — stored data, redaction, trust boundary

The implementation plan commits to these rules. Each is enforced by a test in Phase 3 (plan §8):

- **Webhook signature verified on the raw body.** `POST /webhooks/stripe` is wired before `express.json()` and runs `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`. Invalid or unsigned events return 400 and are never allowed to credit anything.
- **Every amount is server-computed.** The browser never sends an amount, a package price, or a household id. `POST /payments/checkout-session` takes only `{ kind, packageTier?, swimmerCount?, lessonTopup?: { durationMinutes, swimmerCount } }` — the discriminator and the pricing inputs. The acting household comes from the authenticated session via `requireHouseholdMember`. The server computes the amount from the pricing module and puts it (plus the household id) in the Checkout session's metadata.
- **The webhook re-validates the session metadata against our records** before crediting: household exists; the Stripe-reported `amount_total` equals the amount the pricing module computes from the declared kind/tier/inputs; the kind is one we recognize. Mismatch → log at `warn`, respond 200, do **not** credit. Stripe has already charged the parent's card; Jason is paged and refunds manually.
- **Balance is credited only from the verified webhook.** The Checkout `success_url` lands on `/account/balance?topup=success`, which re-reads balance from the DB and shows a toast. It does not write. A browser forging the redirect cannot mint credit.
- **No card data, no full event payloads, no Stripe customer details beyond the ids we need.** `stripe_events` is a narrow table with columns `stripe_event_id` (PK), `event_type`, `stripe_checkout_session_id` (nullable), `received_at`, `processed_at`. No `payload jsonb`. No customer email is copied from Stripe into our DB — the parent's email already lives on `profiles` from auth. If debugging ever needs the full event, Stripe's dashboard has it.
- **Stripe keys and the webhook secret on the API only** — never on Vercel, never in a `NEXT_PUBLIC_*` variable, never in request logs.

This section was re-worked after an explicit review for data-minimization posture. An earlier draft had `stripe_events.payload jsonb` for forensics; dropped on the reasoning that Stripe's dashboard is authoritative for the full event and we don't need a second copy.

### Webhook idempotency: two layers, DB-enforced

Two serial gates:

1. **`stripe_events` table.** `stripe_event_id` is the primary key. Incoming events are inserted with `ON CONFLICT (stripe_event_id) DO NOTHING RETURNING stripe_event_id`. Zero rows returned → the event is a replay; respond 200 with no further action.
2. **`household_balance_ledger.stripe_checkout_session_id` UNIQUE partial index** (WHERE NOT NULL). The top-up/package handler writes the ledger row with `ON CONFLICT (stripe_checkout_session_id) DO NOTHING`. If somehow a second webhook for the same session bypasses layer 1 (misconfigured clone endpoint, DB restore, operational mistake), the DB rejects the double credit.

Any unhandled exception inside the handler returns 500 so Stripe retries (up to 3 days). Any handled "we don't care about this event" case, including the metadata-mismatch policy-refusal, returns 200 so Stripe stops.

Alternatives considered:

- **Single-layer idempotency on `stripe_event_id` only.** Rejected. One layer is enough for well-behaved Stripe retries, but the ledger is the thing we actually care about not double-writing to; anchoring the invariant on the ledger itself survives operational mistakes that mishandle the event table.
- **In-memory dedup cache (Redis / Map).** Rejected. Not durable across restarts; ledger uniqueness is cheaper and stronger.

### Secret key and webhook secret live on the API only, never on Vercel

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are environment variables on the Railway `apps/api` service. They are never added to Vercel. They are never exposed as `NEXT_PUBLIC_*`. The API's env validator (`apps/api/src/lib/env.ts`) refuses to boot when `APP_ENV` is `dev` or `prod` without both — a deploy that forgot to copy the credentials fails in the Railway deploy log rather than silently serving every other route until a parent clicks "Buy." (Same posture ADR 034 established for the Supabase service-role key.)

The web app has no Stripe credential of its own under hosted Checkout — it calls `POST /payments/checkout-session` on the API and redirects to the hosted URL the API returns. If we ever migrate to Elements, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` goes on `apps/web` and only then.

### Charge at booking time; refund on decline, cancel, bulk-cancel, no-show, or expiry — always full, no cutoff

Every booking debits the balance at the moment the lesson row is inserted. Pending-approval lessons (ADR 021) sit with the balance already consumed. If Jason declines, if the parent cancels, if the lesson is a no-show, if a bulk-cancel runs (ADR 033), or if the pending-expiry cron (ADR 021) marks it `expired`, the same refund path writes a `refund_to_balance` for the matching `lesson_charge.amount_cents` in the same transaction as the status change. **Refunds are always in full, at any time, with no cutoff.** The earlier planning reference to a 30-minute parent-cancel cutoff is removed; no such cutoff exists in Jason's model.

Alternatives considered:

- **Charge at approval, not booking.** Rejected. A parent could stack three $90 pending lessons against a $100 balance and none would hit the insufficient-funds check until Jason worked through the queue. Charge-at-booking puts the affordability decision at the booking boundary.
- **Charge at the lesson's start time.** Rejected. Introduces a schedulable background job for every pending lesson and conflates "did the parent intend to pay?" with "did the lesson actually happen?"

### Coach "charge balance" cannot go negative; "free lesson" is the escape hatch

The coach-booking flow (ADR 029) gains a `chargeType: 'balance' | 'free'` field. When the coach picks `'balance'` the server requires `balance >= price`; if insufficient, the coach UI disables "charge balance" and forces the choice: free lesson now (no ledger movement, `free_lesson` marker row for history; cancelling a free lesson refunds nothing, which is correct), or tell the family to top up.

Negative balances would require a collections / dunning / re-present-the-charge story that we don't have and shouldn't build for v1. Jason has the free-lesson lever for the "I'll collect cash later" case — book it free, then post a positive `coach_adjustment` when the cash lands.

### Batch bookings check the whole total, all-or-nothing

The parent batch booking (ADR 030) sums per-lesson prices under the per-household balance lock, compares the sum to the current balance, and either inserts every lesson plus every charge or rolls the whole thing back with `insufficient_balance`. No partial batches. One `lesson_charge` row per lesson in the batch.

### Concurrent charges on one household serialize via a per-household advisory lock

Every transaction that reads-then-writes the balance takes `pg_advisory_xact_lock(hashtext('household-balance:' || household_id))` first. Concurrent charges on the same household serialize; concurrent charges on different households do not.

The lock is independent of the existing `lesson-day` advisory lock (ADR 029) — different hash namespaces, no deadlock. Acquire order is "day lock first, then balance lock" everywhere so there is one consistent global ordering.

Alternatives considered:

- **Serializable transaction isolation.** Rejected for this path. Postgres' SERIALIZABLE retries under contention, and callers would need to handle `40001` at every booking site. The advisory lock is explicit, deterministic, and matches the pattern already used elsewhere.
- **`SELECT ... FOR UPDATE` on a sentinel household row.** Rejected. We don't have a natural sentinel row to lock; manufacturing one duplicates the advisory-lock semantics with worse ergonomics.

### Only the household owns a balance; swimmer-level balances are not supported

The ledger is keyed on `household_id`. A household with four kids has one balance; there is no "credit scoped to swimmer X." This matches Jason's brief ("one prepaid balance per household") and simplifies every downstream question — refunds, package purchases, insufficient-funds flows are all household-level.

Parents can buy any package tier regardless of their current swimmer count. The "which tier?" UI highlights the variant that matches the household's active swimmer count as the default but lets the parent pick any of the four — a one-swimmer family can buy the 4-swimmer tier for a bigger balance, a four-swimmer family can buy the 1-swimmer tier for a smaller one.

### Top-ups are always sized to a specific lesson; no free-form "add any amount"

Both top-up surfaces use the pricing module:

- **Balance page "Add credit for one lesson":** a short form with a duration (30/45/60) and a swimmer count (1–4). The amount is `priceForLesson(duration, swimmerCount)` exactly.
- **Insufficient-funds screen "Add exactly $Z":** `Z = price − balance` for the booking the parent just attempted.

No input field lets the parent type an arbitrary dollar amount. This keeps the Checkout session metadata closed under the pricing module — the webhook's re-validation step has a small, closed set of amounts to recognize, and any amount that doesn't match one is a tampering signal.

### Reuse the existing `lesson_email_outbox`; no separate `household_email_outbox`

The ADR 028 outbox already carries per-household rows for the bulk-cancel case (ADR 033). Two new event types land there instead of in a new table:

- `balance_funds_added` — fired after `card_topup` or `package_purchase` commit. Reuses the household recipient-resolution path.
- `balance_adjusted` — fired after `coach_adjustment` commit.

**No separate refund email.** The existing `lesson_canceled`, `lesson_declined`, bulk-cancel summary, and (if present) `lesson_expired` email templates each gain two lines: "Refunded $X.XX to your balance." / "New balance: $Y.YY." No new outbox event for refunds; piggybacking on the status-change email the parent is already getting is fewer emails and the obvious place for the information.

**No `lesson_charge` email** (the lesson-confirmed email in ADR 028 already covers it) and **no `free_lesson` email** (the ADR 029 coach-booking email with `initiatedBy: 'coach'` covers it).

The sender identity for the two new event types is the same one the existing transactional emails already use — no new sender address.

Alternatives considered:

- **Separate `household_email_outbox` table.** Rejected on second review. The `lesson_email_outbox` already supports the household-only case (bulk-cancel summary); extending the recipient-resolution path to accept purely-household-scoped rows is cheaper than a parallel table with its own drain, its own retry curve, and its own account-deletion scrub shape.
- **Per-refund email.** Rejected. The parent is already receiving an email about the cancellation / decline / bulk-cancel / no-show that triggered the refund; the refund belongs on that email, not on a second one.

### Account deletion anonymizes the ledger, not deletes it

Payment records are generally subject to tax-retention requirements. Jason needs to answer "what did Axiom Aquatics earn in 2026?" after a family leaves, and the ledger is the only authoritative source for that.

The proposed default (pending the legal review) is to treat `household_balance_ledger` the way ADR 034 treats `lessons`: on account deletion, strip identifying columns and keep the row. Specifically:

- `household_id` → NULL. (The FK is already nullable per §1 of the plan.)
- `actor_id` → NULL.
- `lesson_id` stays — the lesson is itself anonymized under ADR 034, so the pointer resolves to a row with no identifying data.
- `amount_cents`, `entry_type`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `created_at` all stay. Jason's revenue and refund reports still work; no identifying data about the deleted family remains in our DB.

The audit-log rows that reference the anonymized ledger entries are already covered by ADR 034's audit-payload scrub rule.

`stripe_events` rows are not scrubbed (they never carried identifying data under this ADR's data-minimization posture). The original customer's email history remains on Stripe's side only.

This is a weaker exception to the append-only trigger than the skills-ledger one (ADR 022 / 032) — a `household_id` null is a mutation of a non-null column, so the trigger has to allow an `UPDATE` where the only changed columns are the nulled identifiers, and only during the account-deletion path. Scoped by the same transaction-tag pattern ADR 034 already established for the ratings-ledger DELETE exception.

Alternatives considered:

- **Hard-delete the household's ledger rows on account deletion** (parallel to the skills-ledger exception). Rejected. Loses tax-period revenue totals and refund history Jason needs for accounting, and offers no privacy benefit over anonymization since the identifying data is already stripped.
- **Keep ledger rows unchanged, rely on the audit-log scrub alone.** Rejected. Leaves `household_id` populated on ledger rows pointing at a torn-down household, which is a leak by any reasonable standard.

### Unused-balance policy — pending Jason, recommendation Option A

Still open. Three positions documented in the plan §6:

- **Option A (recommended):** balance stays indefinitely; refunds on request only, Jason-mediated via the Stripe dashboard with a mirrored `coach_adjustment` row. Account deletion blocks on balance > $0 until the parent chooses refund or forfeiture.
- **Option B:** same, plus automatic refunds on account deletion via a post-commit retry task.
- **Option C:** non-refundable credit; balance forfeits automatically on deletion.

Final text of this section lands once Jason picks.

## Consequences

- **The money ledger is a first-class, append-only table from day one.** All callers that touch balance go through `apps/api/src/services/balance/`; no route handler reaches `household_balance_ledger` directly. Future features that need "charge the household" (merch, clinics, meet-fee reimbursements) extend the entry-type enum rather than inventing a new table.
- **Every booking flow grows a balance check and a ledger write.** `POST /lessons`, `POST /coach/lessons`, `POST /parent/batch-bookings`, `DELETE /lessons/:id`, `PATCH /lessons/:id` (decline), the bulk-cancel path, the no-show marker, and the pending-expiry cron each gain exactly one new transactional responsibility. The audit log grows six new `action` values.
- **No price-locking column on `lessons`.** The schema stays unchanged under this ADR; the ledger is the single source of money truth.
- **Stripe keys are the second service-role credential posture.** `SUPABASE_SERVICE_ROLE_KEY` (ADR 034) and now `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` all live on the Railway API service only. The env validator refuses to boot without them in `dev` / `prod`.
- **PCI compliance stays at SAQ A** under hosted Checkout. Any move to Elements in the future requires a compliance sign-off, not just a frontend swap.
- **The web app still never touches Postgres directly.** The new `/payments/checkout-session` route sits in `apps/api` like every other write. The web surfaces call it and redirect; they never hold Stripe credentials.
- **The Stripe boundary is data-minimized by construction.** `stripe_events` holds only idempotency and debugging metadata (event id, type, session id, timestamps). No full payloads, no card data, no copied customer details. Webhook replays, metadata tampering, forged success redirects, and client-supplied amounts are each blocked by a test in Phase 3.
- **Account deletion anonymizes the ledger** instead of deleting it. Jason retains tax-period revenue and refund totals indefinitely; no identifying data about the deleted family remains. This is a weaker exception to the append-only trigger than the ratings-ledger DELETE exception — one `UPDATE` pattern, scoped by transaction tag.
- **Email surface grows by two outbox event types** (`balance_funds_added`, `balance_adjusted`) and the four lesson status-change templates grow by two lines each. No new email for refunds; no new outbox table.
- **FAQ and marketing copy change at launch.** "Credit never expires," a balance-model explainer, and a rewritten ages answer that no longer mentions "20-minute bursts." The refund-policy copy depends on the Option A/B/C choice.
- **A monthly reconciliation query becomes trivial.** "Money in via card vs promotional credit granted vs charges consumed vs refunds issued" is four `GROUP BY entry_type` queries over the ledger — including after account deletion, because the rows survive with amounts intact.

## Open questions

Documented in full at `docs/plans/payments.md` §9. The one that blocks this ADR moving from Draft to Accepted:

- **Unused-balance policy on account deletion / request.** Options A / B / C in the plan; recommendation is A (refund-on-request, deletion-preflight). The final text of the "Unused-balance policy" decision above depends on this answer.

Other calls — hosted Checkout over Elements, charge-at-booking, refund-at-any-time with no cutoff, coach-charge-can't-go-negative, batch bookings all-or-nothing, per-household advisory lock, refunds-via-ledger-row (no price-lock column), reschedule-is-time-only, append-only ledger with the anonymize-not-delete exception, Stripe keys on the API only, two-layer webhook idempotency, Stripe data-minimization principle, reuse of `lesson_email_outbox`, no separate refund email, no free-form top-up amounts, package tier switcher, required coach-adjustment reason, Stripe receipts left on — are documented here as the decisions and will proceed on this branch unless Jason flags one.
