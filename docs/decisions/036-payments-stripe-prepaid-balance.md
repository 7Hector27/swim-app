# 036 — Payments and prepaid household balance via Stripe

**Date:** 2026-11-06
**Status:** Draft — pending Jason's answers on the open questions in `docs/plans/payments.md`

## Context

Before this ADR there is no money flow in the app. Lessons book freely against Jason's calendar, and billing happens off-platform. Jason has set the v1 payment model himself: every household carries a single prepaid balance in cents; parents fund it by card through Stripe (no Venmo, no manual-payment stage, no balance import); bookings charge the balance at booking time; cancellations and no-shows refund it; the coach can book any family and chooses to either charge their balance or mark the lesson free. Credit never expires.

Pricing is fixed: $120/hr private billed by the minute, with sibling rates per hour of 2=$180, 3=$198, 4=$216. The only cents value anywhere in the system is $0.50 (from 3 swimmers × 45 minutes = $148.50). Two packages, "Cannonball" (10 hr, 10% off) and "Deep End" (20 hr, 20% off), each sized for 1–4 swimmers; the package price is credit × (1 − discount) and the customer sees "pay $1,080, get $1,200 of lesson credit." Kids 3-and-under book 30 minutes. No travel fee. Jason absorbs the Stripe fee.

The architecture question is how to turn those rules into a durable, append-only, concurrency-safe money ledger integrated with the existing booking lifecycle (ADR 021), with reliable Stripe webhook handling and a clean story for what happens when a family leaves (ADR 034).

The planning doc at `docs/plans/payments.md` carries the full step-by-step. This ADR records the architectural decisions it depends on. Several decisions here remain draft until Jason confirms the open questions (unused-balance policy, minimum top-up, package swimmer-count resolution, coach-adjustment reason requirement).

## Decision

### One append-only ledger per household, balance derived by sum

A new table `household_balance_ledger` stores every balance movement: card top-ups, package purchases, package bonuses (the discount portion), lesson charges, refunds, coach adjustments, and `free_lesson` markers. Rows are append-only; an `UPDATE` / `DELETE` trigger rejects mutation, mirroring the posture `skill_ratings` has carried since ADR 022 (and reaffirmed in ADR 032). Account deletion (ADR 034) is the single documented exception — the solo-tear-down path is permitted to delete a deleted household's ledger rows, same as it is permitted to delete skill ratings.

Balance is `SELECT COALESCE(SUM(amount_cents), 0) FROM household_balance_ledger WHERE household_id = $1`. No denormalized balance column. Jason's expected throughput (order hundreds of entries per household per year) keeps the sum sub-millisecond under the `(household_id)` index; if that ever stops being true, the fix is a materialized view the trigger refreshes, not a stored column that can drift from the append-only source of truth.

Every ledger insert is paired with a `household_audit_log` insert in the **same transaction** (CLAUDE.md rule). The audit payload names the actor, the entry type, the amount, and the related lesson or Stripe session when applicable. If either insert fails, the whole transaction rolls back — there is no world in which a ledger row exists without its audit row, or an audit row exists without the ledger row it refers to.

Alternatives considered:

- **Stored `households.balance_cents` with mutating updates.** Rejected. The ledger is the audit trail for money; losing the ability to reconstruct how the current number was reached would fail any serious reconciliation question ("how much promotional credit did we give out this month?", "did this family ever get refunded for lesson X?"). A sum over an append-only table answers both for free.
- **Ledger-only, no audit log.** Rejected. The audit log carries the acting profile and the surrounding context (lesson id, Stripe session id, reason text) that the ledger row's constrained shape can't; both are the right abstraction.
- **Soft-delete on the ledger (tombstone rows).** Rejected. Any mutation is a legal footgun for a payments ledger. Correction = a new row with the inverse amount, categorized as `coach_adjustment` with a reason.

### Package purchase writes two ledger rows atomically

A package charges the parent `price` and credits them `credit` where `credit > price`. Rather than writing one row for the gross credit or one row with a `discount` sidecar column, the handler writes two rows in the same transaction: a `package_purchase` entry for the actual card charge (what Stripe settled) and a `package_bonus` entry for the discount delta (`credit − price`). The balance moves by `credit` atomically — any concurrent `GET /me/balance` sees either the pre-commit state or the full post-commit state, never halfway.

Why split: the audit question "how much promotional credit did we give out?" is a single-row query over `entry_type = 'package_bonus'`. The question "how much actual money came in through packages?" is a single-row query over `entry_type = 'package_purchase'`. A single-row design would force every reconciliation query to parse a sidecar column.

### Price is locked at booking time on the lesson row

New column `lessons.price_cents_at_booking integer`. Set at the booking insert via the pricing module, read at every refund and at every reschedule price-delta computation. A rate change by Jason in the future never affects an in-flight pending lesson's refund amount; the refund always matches the original charge.

Reschedules that change the duration or swimmer set recompute the price and write a signed delta row (negative for an upcharge, positive for a downcharge) in the same transaction as the lesson update. A pure time-change reschedule (same duration, same swimmers) touches no money. The `price_cents_at_booking` column is updated to reflect the new locked price.

Alternatives considered:

- **Recompute price from current rates at refund time.** Rejected. Means a pending lesson's refund amount differs from its charge amount if Jason edited rates in between. The ledger would no longer pair charges and refunds cleanly.
- **Store the price only in the `lesson_charge` ledger row, not on the lesson.** Rejected. The lesson is the primary key for the schedule view; attaching price to it keeps the "how much does this lesson cost?" question a single-row read rather than a ledger scan.

### Pricing is a pure module in `packages/shared`, one source of truth

`packages/shared/src/pricing/` exports `priceForLesson(durationMinutes, swimmerCount)`, `packagePrice(tier, swimmerCount)`, `hourlyRateCents(swimmerCount)`, and `approximatePrivateHours(balanceCents)`. All amounts are integer cents. The twelve `priceForLesson` combinations and eight `packagePrice` combinations are enumerated in unit tests, including the one half-dollar case (`(3 swimmers, 45 min) = $148.50`).

The API is the authoritative caller — the server computes every price fresh from this module before inserting any ledger or lesson row and never accepts a price from the client. The web app imports the same module for display on the booking screens and package cards; this is identical math by construction.

Pricing is not sensitive. It lives freely in client-side bundles. Stripe-side Products/Prices are not used; each Checkout session's line items carry an integer-cents amount computed by the API at session-creation time, keeping the repo as the single source of truth.

### Stripe hosted Checkout, not Elements, for v1

The parent redirects to a Stripe-hosted Checkout page. Card data is entered on `checkout.stripe.com` and never touches our pages, servers, or logs. Compliance posture is SAQ A. 3D Secure, Apple Pay, Google Pay, Link, and address collection come for free with no code on our side.

Alternatives considered:

- **Stripe Elements (inline card form).** Rejected for v1. The embedded flow is a better UX but costs implementation time, drops compliance posture to SAQ A-EP (still card-data-free but with extra paperwork), and gains little for an app whose top-up cadence is ≤ a dozen times per family per year. The webhook, ledger, and idempotency contract defined here all survive a future Elements migration if conversion telemetry justifies it.
- **Stripe Payment Links (shared URLs).** Rejected. Links don't carry household metadata cleanly and can't be parameterized with per-household amounts at creation time without API work anyway. Checkout gets the metadata story right.

### Webhook idempotency: two layers, DB-enforced

The Stripe webhook endpoint at `POST /webhooks/stripe` sits before `express.json()` so it can read the raw body for signature verification (`stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`). Invalid signature returns 400; valid events go through two serial idempotency gates:

1. **`stripe_events` table.** `stripe_event_id text unique`. Incoming events are inserted with `ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`. Zero rows returned → the event is a replay, respond 200 with no further action.
2. **`household_balance_ledger.stripe_checkout_session_id` UNIQUE partial index** (WHERE NOT NULL). The top-up/package handler writes the ledger row with `ON CONFLICT (stripe_checkout_session_id) DO NOTHING`. If somehow a second webhook for the same session bypasses layer 1 (misconfigured clone endpoint, DB restore, operational mistake), the DB rejects the double credit.

Any unhandled exception inside the handler returns 500 so Stripe retries (up to 3 days). Any handled "we don't care about this event" case returns 200 so Stripe stops.

Alternatives considered:

- **Single-layer idempotency on `stripe_event_id` only.** Rejected. One layer is enough for well-behaved Stripe retries, but the ledger is the thing we actually care about not double-writing to; anchoring the invariant on the ledger itself survives operational mistakes that mishandle the event table.
- **In-memory dedup cache (Redis / Map).** Rejected. Not durable across restarts; ledger uniqueness is cheaper and stronger.

### Secret key and webhook secret live on the API only, never on Vercel

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are environment variables on the Railway `apps/api` service. They are never added to Vercel. They are never exposed as `NEXT_PUBLIC_*`. The API's env validator (`apps/api/src/lib/env.ts`) refuses to boot when `APP_ENV` is `dev` or `prod` without both — a deploy that forgot to copy the credentials fails in the Railway deploy log rather than silently serving every other route until a parent clicks "Add funds." (Same posture ADR 034 established for the Supabase service-role key.)

The web app has no Stripe credential of its own under hosted Checkout — it calls `POST /payments/checkout-session` on the API and redirects to the hosted URL the API returns. If we ever migrate to Elements, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` goes on `apps/web` and only then.

### Charge at booking time; refund on decline, cancel, no-show, or expiry

Every booking debits the balance at the moment the lesson row is inserted. Pending-approval lessons (ADR 021) sit with the balance already consumed. If Jason declines, if the parent cancels, if the lesson is a no-show, or if the pending-expiry cron (ADR 021) marks it `expired`, the same refund path writes a `refund_to_balance` row for the locked `price_cents_at_booking` in the same transaction as the status change.

Alternatives considered:

- **Charge at approval, not booking.** Rejected. A parent could stack three $90 pending lessons against a $100 balance and none of them would hit the insufficient-funds check until Jason worked through the queue. Charge-at-booking puts the affordability decision at the booking boundary, which is where the parent is deciding whether to commit.
- **Charge at the lesson's start time.** Rejected. Introduces a schedulable background job for every pending lesson and conflates "did the parent intend to pay?" with "did the lesson actually happen?" Making the booking itself the payment event keeps the model tight.

### Coach "charge balance" cannot go negative; "free lesson" is the escape hatch

The coach-booking flow (ADR 029) gains a `chargeType: 'balance' | 'free'` field. When the coach picks `'balance'` the server requires `balance >= price`; if balance is insufficient, the coach UI disables "charge balance" and forces the choice: free lesson now (no ledger movement, `free_lesson` marker row for history), or tell the family to top up.

Negative balances would require a collections / dunning / re-present-the-charge story that we don't have and shouldn't build for v1. Jason has the free-lesson lever for the "I'll collect cash later" case — he books it free, then posts a positive `coach_adjustment` when the cash lands.

Alternatives considered:

- **Allow negative with a `collect_later` flag.** Rejected. Adds parent-facing state ("you owe us $X") that we can't resolve with existing infrastructure. Free lesson + adjustment covers the use case with no new machinery.

### Batch bookings check the whole total, all-or-nothing

The parent batch booking (ADR 030) sums per-lesson prices under the per-household balance lock, compares the sum to the current balance, and either inserts every lesson plus every charge or rolls the whole thing back with `insufficient_balance`. No partial batches.

Same transactional guarantee the audit log already requires.

### Concurrent charges on one household serialize via a per-household advisory lock

Every transaction that reads-then-writes the balance takes `pg_advisory_xact_lock(hashtext('household-balance:' || household_id))` first. Concurrent charges on the same household serialize; concurrent charges on different households do not.

The lock is independent of the existing `lesson-day` advisory lock (ADR 029) — different hash namespaces, no deadlock. Acquire order is "day lock first, then balance lock" everywhere so there is one consistent global ordering.

Alternatives considered:

- **Serializable transaction isolation (`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`).** Rejected for this path. Postgres' SERIALIZABLE works, but under contention it retries, and callers would need to handle `40001` retry errors at every booking site. The advisory lock is explicit, deterministic, and matches the pattern already used elsewhere in the codebase.
- **`SELECT ... FOR UPDATE` on a sentinel household row.** Rejected. We don't have a natural sentinel row to lock; manufacturing one duplicates the advisory-lock semantics with worse ergonomics.

### Pricing stays locked even on reschedule unless pricing inputs change

`PATCH /lessons/:id` with a pure time change (same duration, same swimmer set) moves no money. A reschedule that changes `durationMinutes` or `swimmerIds` recomputes the new price, writes a signed delta ledger row (`entry_type = 'coach_adjustment'` with a reason like `reschedule_price_delta`, or a dedicated `reschedule_adjustment` entry type — resolved during Phase 4 implementation), updates `price_cents_at_booking`, and audits both the reschedule and the delta in the same transaction.

### `household_email_outbox` is a separate table from `lesson_email_outbox`

Balance events (`balance_funds_added`, `balance_refunded`, `balance_adjusted`) are per-household, not per-lesson. The existing outbox (ADR 028) is keyed on `lesson_id` with lesson-scoped idempotency; adding household-only events to it would require making `lesson_id` nullable, loosening the CHECK that ties payload shape to event type, and complicating the drain's shape-aware filters. A sibling table `household_email_outbox` with its own idempotency key, drain, and retry curve is clean: no changes to `lesson_email_outbox`, no cross-type payload CHECKs, and the two outboxes can evolve independently.

No email is sent on `lesson_charge` (the lesson-confirmed email in ADR 028 already covers it) or on `free_lesson` (ADR 029's coach-booking email with `initiatedBy: 'coach'` covers it).

### Account deletion blocks on non-zero balance until Jason's policy lands

Draft position, pending Jason's answer on the unused-balance options in `docs/plans/payments.md` §6: the ADR 034 deletion preflight gains a balance check. If balance > 0, the confirm screen offers either a Stripe refund (reverse the matching `card_topup` / `package_purchase` charges within Stripe's 180-day refund window, oldest to newest — package bonuses forfeit because they weren't paid money) or an explicit forfeiture with a typed-phrase confirmation. Deletion proceeds only after the balance reaches zero.

If Jason picks the "no cash refunds" option (Option C in the plan), balance forfeits automatically on delete with a final `coach_adjustment` row marking the forfeiture. If he picks the "automatic refund on delete" option (Option B), the deletion-job post-commit task adds a Stripe-refund step with the same retry-curve shape ADR 034 already uses for calendar reconciliation.

This section is intentionally sketch-level in draft; the final text lands once the option is chosen.

### Only the household owns a balance; swimmer-level balances are not supported

The ledger is keyed on `household_id`. A household with four kids has one balance; there is no "credit scoped to swimmer X." This matches Jason's brief ("one prepaid balance per household") and simplifies every downstream question — refunds, package purchases, insufficient-funds flows are all household-level.

Packages are a household-level discount tier. The "which swimmer-count variant does this household buy?" resolution happens at package purchase time based on the household's active swimmer count (pending Jason's answer on whether parents can override that in a package picker — see plan §9).

## Consequences

- **The money ledger is a first-class, append-only table from day one.** All callers that touch balance go through the service layer (`apps/api/src/services/balance/`); no route handler reaches `household_balance_ledger` directly. Future features that need "charge the household" (merch, clinics, meet-fee reimbursements) extend the entry-type enum rather than inventing a new table.
- **Every booking flow grows a balance check and a ledger write.** `POST /lessons`, `POST /coach/lessons`, `POST /parent/batch-bookings`, `DELETE /lessons/:id`, `PATCH /lessons/:id`, the no-show marker, and the pending-expiry cron all gain exactly one new transactional responsibility. The audit log grows six new `action` values.
- **Stripe keys are the second service-role credential posture.** `SUPABASE_SERVICE_ROLE_KEY` (ADR 034) and now `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` all live on the Railway API service only. The env validator refuses to boot without them in `dev` / `prod`.
- **PCI compliance stays at SAQ A** under hosted Checkout. Any move to Elements in the future requires a compliance sign-off, not just a frontend swap.
- **The web app still never touches Postgres directly.** The new `/payments/checkout-session` route sits in `apps/api` like every other write. The web surfaces call it and redirect; they never hold Stripe credentials.
- **Account deletion gains a balance preflight** regardless of which §6 option lands. ADR 034's deletion flow cannot leave money unaccounted for.
- **The legal review's payments packet** is a formal deliverable before the first production charge. Items are enumerated in the plan's §7.
- **FAQ and marketing copy change at launch.** "Credit never expires," a balance-model explainer, and the refund-policy statement (text depends on the §6 choice) all need coordinated updates.
- **A monthly reconciliation query becomes trivial.** "Money in via card vs promotional credit granted vs charges consumed vs refunds issued" is four `GROUP BY entry_type` queries over the ledger. No cross-source join between Stripe and our DB is required because every Stripe-settled event lands on a ledger row keyed by the Stripe session id.

## Open questions

Documented in full at `docs/plans/payments.md` §9. The ones that block this ADR moving from Draft to Accepted:

- **Unused-balance policy on account deletion / request.** Options A / B / C in the plan; recommendation is A (refund-on-request, deletion-preflight). The final text of the "Account deletion blocks on non-zero balance" decision above depends on this answer.
- **Package swimmer-count resolution** — tie to active swimmer count or parent-selected at checkout.
- **Coach-adjustment reason** — required or optional free text.
- **Minimum top-up amount.**
- **Receipt-email posture** — Stripe's built-in receipts on or off, and which sender identity our outbox receipts use.

Other calls — hosted Checkout over Elements, charge-at-booking, coach-charge-can't-go-negative, batch bookings all-or-nothing, per-household advisory lock, lesson price locked at insert, append-only ledger with the account-deletion exception, Stripe keys on the API only, two-layer webhook idempotency, separate household outbox table — are documented here as the recommendation and will proceed on this branch unless Jason flags one.
