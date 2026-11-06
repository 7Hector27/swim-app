# Plan: Payments and prepaid household balance

**Status:** Planning
**Branch:** `feature/payments` (off `dev`)
**ADR:** [036 — Payments and prepaid household balance via Stripe](../decisions/036-payments-stripe-prepaid-balance.md) (draft)

---

## Overview

Every household carries one prepaid balance, stored in integer cents, derived from an append-only ledger. Parents fund the balance by card through Stripe (hosted Checkout). Bookings charge the balance at insert time; cancellations and no-shows refund it; coach bookings can either charge the balance or mark a lesson free. Credit never expires. There is no Venmo, no manual-payment stage, no balance import.

Packages and single top-ups both just add to the balance — a package is a top-up that also adds a bonus row for the discount, so the balance history shows exactly where every cent came from.

The pricing table is a single pure module in `packages/shared` so the API, the web app's booking screens, and the package cards all read the same number. A lesson's price is **locked at the moment the lesson row is inserted** (column `price_cents_at_booking`); subsequent rate changes never affect in-flight lessons, and cancellations refund exactly what was charged.

---

## Decisions already baked in (from Jason)

Fixed inputs from the feature brief, not up for debate in planning:

- **Private rate:** $120/hr, billed by the minute. 30 min = $60; 45 min = $90; 60 min = $120.
- **Sibling rates (per hour, one household):** 2 swimmers $180; 3 $198; 4 $216.
- **Only cents value is 50 cents.** All sibling per-minute rates divide evenly except 3-swimmer/45-min ($148.50). Pricing module returns integer cents; no rounding surprises.
- **One prepaid balance per household**, in cents. Parents see dollars plus an approximate count of private hours.
- **Packages — "Cannonball" (10 hr, 10% off) and "Deep End" (20 hr, 20% off)**, each sized for 1–4 swimmers. Credit = hourly rate × hours. Price = credit × (1 − discount). Example copy: *"Pay $1,080, get $1,200 of lesson credit."* Credit never expires.
- **Single lessons add the lesson's price**, not a round-dollar amount (i.e. a single-lesson top-up is `priceForLesson(duration, swimmerCount)` exactly).
- **Card only, via Stripe.** No Venmo, no manual-payment mode. Jason absorbs card fees.
- **No existing balances to import.**
- **Insufficient-funds screen** offers two routes: add exactly what this booking needs, or buy a package.
- **Coach can book any family** with two choices: charge their balance, or free lesson.
- **Cancellations and no-shows refund the booking's locked price in full to the balance.**
- **No travel fee.** The pricing module takes `(durationMinutes, swimmerCount)` only; location does not affect price.
- **Kids 3 and under book 30 minutes.** Age-gated at the booking UI and re-checked server-side. Pricing is standard for a 30-min lesson — this is a scheduling rule, not a pricing rule.
- **FAQ updates at launch:** "credit never expires," plus a short explainer of the balance model.

---

## 1. Ledger

### Table shape

New table `household_balance_ledger`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid not null → households | indexed |
| `entry_type` | enum `balance_entry_type` | see list below |
| `amount_cents` | integer not null | signed: positive credits, negative debits, zero markers allowed |
| `lesson_id` | uuid nullable → lessons | set for `lesson_charge` / `refund_to_balance` / `free_lesson` |
| `stripe_checkout_session_id` | text nullable | UNIQUE partial index WHERE NOT NULL — idempotency anchor for top-ups |
| `stripe_payment_intent_id` | text nullable | denormalized convenience for the ledger history view |
| `actor_id` | uuid nullable → profiles | the acting party: parent for card flows, coach for charges/adjustments/free lessons, `null` for cron-driven refunds |
| `reason` | text nullable | `coach_adjustment` only; free text, Zod-capped at 500 chars |
| `created_at` | timestamptz not null default now() | |

Append-only enforced the same way `skill_ratings` is: a trigger that blocks `UPDATE` and `DELETE` on any row. Account deletion is the single documented exception (same posture ADR 022 / ADR 032 / ADR 034 already established for the skills ledger).

### Entry types

`balance_entry_type` is a Postgres enum with these values:

- **`card_topup`** — parent paid by card for a plain top-up. Amount is positive, equal to the card charge.
- **`package_purchase`** — parent paid by card for a package. Amount is positive, equal to the card charge (`price`, not `credit`).
- **`package_bonus`** — the discount delta for a package. Amount is positive, equal to `credit − price`. Written in the same transaction as the matching `package_purchase` row so the two rows always appear together and the balance moves by the full `credit` atomically.
- **`lesson_charge`** — a booking consumed balance. Amount is negative, equal to the lesson's locked price.
- **`refund_to_balance`** — cancellation, no-show, or expired-pending refund. Amount is positive, equal to the lesson's locked price (the same magnitude as the original `lesson_charge`).
- **`coach_adjustment`** — Jason manually moves the balance. Amount signed. `reason` required. Audited.
- **`free_lesson`** — a coach-booked free lesson. Amount `0`. Written for history completeness so the family's balance screen explains the lesson's existence; does not move the balance.

Why `package_bonus` is a separate row rather than a single `package_purchase` of `credit` cents: the audit log needs to show both the money that came in (what Stripe settled) and the promotional credit (what Jason gave up). Split rows also let the reconciliation story at month-end answer "how much promotional credit went out" without parsing anything.

### Balance derivation

```sql
SELECT COALESCE(SUM(amount_cents), 0)
FROM household_balance_ledger
WHERE household_id = $1;
```

Covered by the `(household_id)` index. At Jason's expected throughput (order hundreds of entries per household per year) the sum is sub-millisecond; no stored-balance column, no cache. If the ledger ever grows past the point where this hurts, the fix is a materialized view keyed on household, not a denormalized column — the append-only invariant means the materialized view is always correct after a trigger-driven refresh.

### Audit log

Every write path that inserts a ledger row also inserts an `household_audit_log` row **in the same transaction** (CLAUDE.md rule). One new audit action per entry type:

- `balance_card_topup`
- `balance_package_purchased`
- `balance_lesson_charged`
- `balance_lesson_refunded`
- `balance_coach_adjusted`
- `balance_free_lesson`

The audit payload carries `{ ledgerId, entryType, amountCents, lessonId?, stripeSessionId?, reason? }`. If the ledger insert fails, the audit insert rolls back with it, and no ledger row ever exists without its matching audit row.

### Concurrency: per-household advisory lock

Two browser tabs clicking "Book lesson" at the same instant could both read a $90 balance, both decide it's enough for a $60 lesson, both write a −$6000 ledger row, and leave the balance at −$30. The advisory lock makes that impossible:

```ts
await tx.execute(
  sql`SELECT pg_advisory_xact_lock(hashtext('household-balance:' || ${householdId}))`,
);
```

Every transaction that reads-then-writes balance takes the lock first. Concurrent transactions on the same household serialize; concurrent transactions on different households do not. Independent of the existing `lesson-day` advisory lock (ADR 029) — a coach booking on 2026-12-01 for one household cannot block a parent booking on 2026-12-02 for another.

### Package purchase → two rows, one transaction

```
BEGIN
  INSERT INTO household_balance_ledger ( ..., entry_type='package_purchase', amount_cents=108_000 )
  INSERT INTO household_balance_ledger ( ..., entry_type='package_bonus',    amount_cents= 12_000 )
  INSERT INTO household_audit_log ( action='balance_package_purchased', ... )
COMMIT
```

Balance moves from $0 to $1,200 atomically. A concurrent `GET /me/balance` either sees $0 (before the commit) or $1,200 (after), never $1,080.

---

## 2. Pricing module

Lives in `packages/shared/src/pricing/` with its own Zod schemas and types. Imported by both `apps/api` (for authoritative pricing at the booking boundary) and `apps/web` (for showing prices on the booking screen and package cards).

### Pure functions

```ts
// All amounts in integer cents.
export function priceForLesson(
  durationMinutes: LessonDurationMinutes,  // 30 | 45 | 60
  swimmerCount: 1 | 2 | 3 | 4,
): number;

export function packagePrice(
  tier: 'cannonball' | 'deep_end',
  swimmerCount: 1 | 2 | 3 | 4,
): { creditCents: number; priceCents: number; bonusCents: number };

export function hourlyRateCents(swimmerCount: 1 | 2 | 3 | 4): number;
// 1 → 12000, 2 → 18000, 3 → 19800, 4 → 21600

export function approximatePrivateHours(balanceCents: number): number;
// Floor to 0.5 hr. Parents see "≈ 3 hours" or "≈ 3.5 hours", never "2.834 hours".
```

`priceForLesson` is the single source of truth for the per-minute math. Implementation is literal: `hourlyRateCents(swimmerCount) * durationMinutes / 60`. Every supported combination divides exactly to an integer except the `(3 swimmers, 45 min)` case which lands on 14850 (`$148.50`) — the only half-dollar value in the system. Unit tests enumerate all 12 combinations.

`packagePrice` returns the three fields so callers don't recompute the bonus:
- Cannonball 1 swimmer: `{ creditCents: 120_000, priceCents: 108_000, bonusCents: 12_000 }`
- Cannonball 4 swimmers: `{ creditCents: 216_000, priceCents: 194_400, bonusCents: 21_600 }`
- Deep End 1 swimmer: `{ creditCents: 240_000, priceCents: 192_000, bonusCents: 48_000 }`
- Deep End 4 swimmers: `{ creditCents: 432_000, priceCents: 345_600, bonusCents: 86_400 }`

All eight package variants resolve to integer cents (the 10% and 20% discounts fall on the cleanly-divisible hourly rates — unlike the per-minute math, no half-cent edge cases exist here).

### Price locked at booking time

Add column `lessons.price_cents_at_booking integer` (nullable until Phase 4 backfills + adds the NOT NULL in a separate migration). Set at the booking insert, read at every refund.

Why lock it: Jason may raise rates in the future. A pending lesson booked at today's price that gets declined tomorrow must refund at today's price, not tomorrow's. The locked column is the authoritative record; the pricing module is for computing the number to charge, never for computing the number to refund.

**Reschedule rules.** `PATCH /lessons/:id` can change the start time, the duration, or the swimmer set. If any change affects the pricing inputs (duration or swimmer count), the server recomputes `priceForLesson(newInputs)`, writes the delta as a balance adjustment in the same transaction (negative for an upcharge, positive for a downcharge), and updates `price_cents_at_booking` to the new value. The ledger shows both the original charge and the adjustment, not a destructive overwrite. A pure time change (same duration, same swimmers) touches no money. Time-only is the overwhelmingly common reschedule path today; the adjustment path exists for the rare cases.

### Pricing never leaks into the client bundle as a web-env secret

Public pricing is not sensitive and lives in `packages/shared` — imported freely by client components. Stripe-side pricing (Products/Prices if we use any) is not used; we compute every amount server-side and hand Stripe an integer cents value for each Checkout session line. This keeps the Stripe dashboard simple and the single source of truth in the repo.

---

## 3. Stripe

### Checkout vs Elements — recommendation: hosted Checkout

The choice is between Stripe-hosted Checkout (redirect to a Stripe URL) and embedded Elements (card input inline in our pages).

**Recommend Checkout for v1.** Reasons:

- **PCI scope.** Hosted Checkout keeps us on SAQ A — the simplest self-assessment questionnaire — because no card data touches our pages or servers. Elements drops us to SAQ A-EP, which is still card-data-free but requires a bit more compliance paperwork.
- **Built-in features.** 3D Secure, Apple Pay, Google Pay, Link (Stripe's one-click), and address collection are all handled by Stripe's hosted page with zero code on our side. Elements gives us the same primitives but we wire them.
- **Design cost.** Jason's app is mobile-first and the top-up flow is infrequent (≤ a dozen times per family per year). A redirect-and-return flow is a reasonable UX cost for the compliance and feature savings.
- **Time to ship.** Checkout cuts the first-live-charge timeline by days.

The main loss: Checkout opens in a new context, which is a small UX seam versus an inline card form. If telemetry after launch shows an abandonment spike at the redirect step, we can migrate to Elements — the webhook, ledger, and idempotency contract would survive the swap.

### Webhook handling

One endpoint: `POST /webhooks/stripe`. Wired before `express.json()` middleware so it can read the **raw** request body (required for signature verification); Stripe sends JSON but with a signed digest over the raw bytes, and any JSON parse-and-re-stringify breaks the signature.

**Signature verification.** Every request runs through `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`. Invalid signature → `400 Bad Request`, log at warn level with the event id (if present) and no body. This is non-negotiable; an endpoint that accepts unsigned webhook payloads is a free credit-issuance oracle.

**Idempotency, two layers.**

1. **`stripe_events` table.** Columns: `id uuid pk`, `stripe_event_id text unique not null`, `type text not null`, `received_at timestamptz`, `processed_at timestamptz nullable`, `payload jsonb not null`. Every incoming event is first inserted with `INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`. If the insert returned zero rows the event is a replay — respond 200 immediately without reprocessing. If it returned a row, hand off to the handler.
2. **Per-event idempotency anchor on the ledger.** Even if `stripe_events` is somehow bypassed, the `household_balance_ledger.stripe_checkout_session_id` UNIQUE constraint prevents a double credit: the top-up handler does `INSERT ... ON CONFLICT (stripe_checkout_session_id) DO NOTHING`. If the row already exists (same Checkout session), the credit has already been applied.

Both layers are belt-and-braces: layer 1 is the standard pattern and handles well-behaved replays; layer 2 catches the pathological case where somehow a second webhook for the same session got past layer 1 (misconfigured clone endpoint, DB restore, operational mistake). The DB is the final arbiter.

**Events we care about (v1):**

- `checkout.session.completed` — the main top-up and package-purchase trigger. Metadata on the session carries `{ householdId, kind: 'topup' | 'package', packageTier?, swimmerCount? }` so the handler knows which ledger rows to write. If the session was for a package, the handler writes both `package_purchase` and `package_bonus` rows.
- `charge.refunded` / `refund.created` — only relevant if Jason ever issues a manual refund from the Stripe dashboard (e.g. a disputed charge). Handler writes a `coach_adjustment` ledger row (negative) referencing the original Checkout session id. Out of scope for v1 if Jason prefers to reconcile manually; still recommend wiring the listener and logging unmatched refunds.
- `checkout.session.expired` and `checkout.session.async_payment_failed` — informational only. No ledger row; the parent simply didn't complete the flow. Log for support.

All other event types return 200 with no action (Stripe retries non-200s up to 3 days).

**Response contract.** 200 for any event we recognized, including replays. 400 for signature failure. 500 for unhandled exceptions (Stripe will retry, which is what we want). Never return 2xx on an unhandled exception — that quietly loses the retry.

### Keys and where they live

- **`STRIPE_SECRET_KEY`** — on `apps/api` only. Not exported to the client, not read by Next.js. Added to `apps/api/.env.example` with a `sk_test_...` placeholder and a comment pointing at the Stripe dashboard.
- **`STRIPE_WEBHOOK_SECRET`** — on `apps/api` only. Required at boot; the API's env validator (`apps/api/src/lib/env.ts`) refuses to start when `APP_ENV` is `dev` or `prod` without it (same posture as `SUPABASE_SERVICE_ROLE_KEY` after ADR 034).
- **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** — not needed under the hosted-Checkout design. If we migrate to Elements it goes on `apps/web` only, and only then. Keeping it absent until Elements lands means the build fails the day someone tries to use Elements without wiring the key — which is the right signal.

The secret key and webhook secret are **never** shipped to Vercel. The web app's role is to call `POST /payments/checkout-session` on the API and redirect to the returned Stripe URL; it does not hold Stripe credentials.

### Local development

- `STRIPE_SECRET_KEY=sk_test_...` in `apps/api/.env`.
- `stripe listen --forward-to localhost:3001/webhooks/stripe` from the Stripe CLI. The CLI prints a `whsec_...` value at startup — that is the local webhook secret, which goes in `apps/api/.env` as `STRIPE_WEBHOOK_SECRET`.
- Test cards from Stripe's docs (`4242 4242 4242 4242` for success, `4000 0000 0000 9995` for insufficient-funds decline, `4000 0025 0000 3155` for 3DS).
- `apps/api/.env.example` gains both Stripe keys with test-mode placeholders and a one-line pointer at the `stripe listen` command.

### What Jason needs for live mode

1. **Activate the Stripe account.** Business details, EIN/SSN, bank account for payouts, representative info. Stripe's standard activation — he'll do this in the dashboard.
2. **Set the payout schedule.** Defaults to daily; Jason can change to weekly or manual.
3. **Register the production webhook endpoint.** In the dashboard under *Developers → Webhooks*, add `https://api.axiomaquatics.com/webhooks/stripe` (or whatever the prod API hostname is), subscribe to the events listed above, copy the generated `whsec_...` into the Railway API service as `STRIPE_WEBHOOK_SECRET`.
4. **Add the live secret key** to the Railway API service as `STRIPE_SECRET_KEY`. Never commit; never put it on Vercel.
5. **Decide on Stripe receipt emails.** By default Stripe emails a receipt to the customer email for every successful charge. Jason can disable this in dashboard settings if he wants our outbox emails to be the only receipt; otherwise both go out. Recommended: leave Stripe receipts on for v1 — they are branded with Axiom Aquatics (configurable in the dashboard), are legally compliant, and don't cost us anything.

---

## 4. Proposed answers to Jason's open questions

### Q1. Charge at booking or at approval?

**Proposal: charge at booking.** Refund in full if the lesson is declined or expires.

- Every booking consumes real money at insert time. A pending-approval lesson sits with the balance already debited. If Jason declines (ADR 021), the refund path writes a `refund_to_balance` row; if the auto-expiry cron (ADR 021) marks it `expired`, the same refund path fires.
- Why not charge-at-approval: a parent could request three $90 lessons back-to-back with a $100 balance, and the current system would happily hold all three as pending until Jason approves them one by one. Charge-at-booking makes "can I afford this" a hard check at the booking boundary, which is where the parent is making the decision.
- Jason's lean matches this.

### Q2. Can a coach "charge" take the balance negative?

**Proposal: no.** A coach booking with "charge balance" selected requires `balance >= price`. If balance is insufficient, the coach UI disables "charge balance" and forces the choice: pick "free lesson" (no ledger movement) or tell the family to top up.

- Negative balances create collection problems. We don't have an invoice flow, a dunning system, or a way to re-present a payment — adding any of those is a separate, much bigger project.
- Jason has an escape hatch in the form of "free lesson" — a coach-booked lesson that bypasses the balance entirely. For the "I'll collect cash later" case, Jason writes it up as free and creates a positive `coach_adjustment` when the cash lands.
- Alternative considered: allow negative with a flag like `collect_later=true`. Rejected — adds state and reporting complexity for a case that a free-lesson plus an adjustment already covers cleanly.

### Q3. Batch bookings — check the whole total?

**Proposal: all-or-nothing on the total, inside one transaction.** The batch-booking transaction (ADR 030) sums the per-lesson prices, compares to the household's current balance under the per-household advisory lock, and either inserts every lesson + every charge or rolls the whole thing back with `insufficient_balance`.

- A partial batch (3 of 5 lessons booked, 2 rejected after the $0 cutover) would leave the parent with half of what they asked for and no clean way to reason about why. Atomicity matches the per-lesson model and matches CLAUDE.md's audit-in-same-transaction rule.
- The lock ensures two concurrent batches for the same household can't both see the same starting balance.

### Q4. Races between two bookings spending the same balance?

**Proposal: per-household advisory lock in the balance-charging transaction.** Covered above in §1 — `pg_advisory_xact_lock(hashtext('household-balance:' || householdId))` at the top of every transaction that reads-then-writes the ledger. Concurrent charges serialize; each one sees the state the previous one committed.

- This is the same pattern ADR 029 uses for the lesson-day lock. The two locks are independent (different hash namespaces) so they don't deadlock against each other; the ordering is "day lock first, then balance lock" everywhere, which gives a consistent global acquire order.

---

## 5. User-facing surfaces

### Parent — `/account/balance`

Mobile-first page under `apps/web/src/content/AccountBalanceContent/`. Linked from the existing account nav (new row) and from the booking screen's "Add funds" CTA in the insufficient-funds state.

Layout:

1. **Balance card** at the top. Big number in dollars. Below, in smaller text: `≈ {approximatePrivateHours(balance)} hours of private lessons`, with a tooltip explaining the estimate assumes a single swimmer at the private rate.
2. **"Add funds" button.** Opens a sheet with a short numeric input (minimum $20 — see open questions) and a "Continue to payment" button that POSTs to `/payments/checkout-session` and redirects to Stripe.
3. **Package cards.** Two cards (Cannonball, Deep End), each showing the credit, the price, and the discount for the household's swimmer count. If the household has 1 active swimmer the cards show the 1-swimmer variants; if 3, the 3-swimmer variants. For households with a mix in flight (one lesson booked for one kid, another booked for two) the cards still display the per-household swimmer-count resolved on the server and sent as a prop; packages apply to balance, not to a specific swimmer subset, so "which swimmers" never enters the UI.
4. **History table.** Reverse-chronological. Columns: date, type (plain-language — "Lesson", "Refund", "Added funds", "Package: Cannonball", etc.), amount (signed, dollar-formatted), running balance after the entry. Pagination at 50 rows with a "Load more" button.

Insufficient-funds state at booking:

- Modal title: *Insufficient funds.*
- Body: *This lesson costs $X.XX. Your balance is $Y.YY.*
- Two CTAs, stacked on mobile:
  - **Add exactly $Z.ZZ** (where $Z = X − Y) — jumps to the Checkout flow with a pre-filled amount. On successful return the parent lands back on the booking screen, which auto-retries the booking since the balance is now sufficient.
  - **Buy a package** — jumps to `/account/balance` with the package cards scrolled into view.

### Coach — household detail

The existing coach surfaces (`/coach/households/[id]`, `/coach/swimmers/[id]`) gain a Balance panel:

- Current balance (dollar-formatted).
- "Charge balance" / "Free lesson" radio on the coach-booking flow (see ADR 029 for the surrounding surface). "Charge balance" disabled with an inline hint if balance < price.
- A "Recent transactions" list — last 10 ledger rows with the same columns as the parent history.
- An "Adjust balance" button (opens a modal: positive or negative amount, reason text, confirm). Writes a `coach_adjustment` ledger row + audit. Jason-only; the UI gates on `requireCoach`.

### Receipts, emails, notifications

- **Stripe sends its own receipt email** by default for every successful Checkout session. Branded with Axiom Aquatics (configured in the Stripe dashboard). This covers the legal "you were charged $X" email with no code on our side.
- **One outbox email per ledger-moving event.** Reuses the ADR 028 transactional outbox pattern. Three new `lesson_email_outbox` events — or, more likely, a new `household_email_outbox` table parallel to the lesson one, because these emails are per-household, not per-lesson:
  - `balance_funds_added` — on `card_topup` or `package_purchase` commit. "You added $X to your balance. New balance: $Y."
  - `balance_refunded` — on `refund_to_balance` commit. "Your lesson on {date} was cancelled. $X refunded to your balance. New balance: $Y."
  - `balance_adjusted` — on `coach_adjustment` commit. "Jason adjusted your balance by ±$X. New balance: $Y. Reason: {reason}."
  - No email for `lesson_charge` — the lesson-confirmed email (ADR 028) already tells the parent they were charged. Adding a second email per booking is noise.
  - No email for `free_lesson` — the lesson-confirmed email with the "Jason scheduled this" copy (ADR 029) already covers it.
- **No coach-side push notifications** for ledger events in v1. Jason uses the household detail page for visibility; push is for lessons and alerts (ADR 031).

---

## 6. Unused balance — options to pick from

Credit never expires. The policy question is what happens when a family *asks* for their leftover money back, and what happens if they delete their account while holding balance. Three coherent positions:

### Option A — Keep as credit; refunds on request only

- **Default:** balance stays on the household forever.
- **Refund-to-card on request:** the parent asks via email or Jason surfaces a refund button in the coach UI; Jason issues it manually from the Stripe dashboard, which reverses the specific `card_topup` or `package_purchase` charge. A webhook (`charge.refunded`) writes the negative ledger row.
- **Account deletion (ADR 034):** the deletion flow adds a preflight check. If balance > $0, the confirm screen offers *"Refund $X to your card"* (Stripe refund, charges-only within 180 days) or *"Forfeit $X"* with a typed-phrase confirmation. Deletion proceeds only after the balance is $0.
- **Tradeoffs:** keeps Jason's money in his pocket unless pressed; small effort per refund; places the refund-timing burden on parents. Risk: feels bad to a family that quits mid-package; may draw a "we keep your money by default" complaint.

### Option B — Automatic refund on account deletion

- **Same refund-on-request mechanism as A**, plus:
- **Account deletion automatically refunds:** the engine walks `card_topup` + `package_purchase` rows most-recent-first, issuing Stripe refunds against each until the remaining balance is zero, then anonymizes the household as in ADR 034. Charges older than Stripe's 180-day refund window land as a residual flagged for Jason (manual check mailed to the parent's last known address, or forfeited — Jason decides per case).
- **The `package_bonus` portion is forfeit on delete.** Only money the parent actually paid can be returned — the discount credit was ours.
- **Tradeoffs:** cleaner parent-facing story; matches "fair play" expectation; adds a post-commit retry task to the deletion job (same shape as the existing Google-reconcile retry from ADR 034).

### Option C — No cash refunds, ever; balance is non-redeemable credit

- **Legal copy says the balance is "non-refundable lesson credit."** Credit is always spendable, never convertible to cash.
- **Account deletion:** balance forfeits automatically. A final ledger row records the forfeiture at `amount_cents = -balance` with `entry_type = 'coach_adjustment'` and a `reason = 'account_deletion_forfeit'` so the audit trail is complete.
- **Tradeoffs:** simplest to operate; worst parent perception; strongest legal risk around unclaimed-property law. California (which is where Jason operates) has rules around prepaid balances that may or may not treat this as unclaimed property — specifically needs legal review. The "we keep leftover money" framing also invites credit-card chargebacks, which cost more than the refund would have.

### My recommendation

**Option A for v1**, with the deletion-flow preflight check. It's the smallest surface area to build, it gives Jason case-by-case control, and the "refund on request" copy is defensible. Move to Option B in a follow-up if the "refund button" grows into a visible parent request pattern.

**Reject Option C.** The chargeback and legal risk is not worth the simplicity.

**Confirm with Jason before implementing.** If he leans A or B, we build accordingly; if he leans C, we flag the legal review before writing any code.

---

## 7. Legal review packet

What the kids'-data / payments legal review needs to see:

- **Stripe is the payment processor and the PCI data owner.** We integrate via hosted Checkout, which means card numbers, CVVs, and expiry dates are entered on Stripe's domain and never touch our servers or logs. Our PCI compliance posture is SAQ A.
- **What we store on our side:**
  - Integer-cents balance movements in `household_balance_ledger`.
  - Stripe Checkout session ids and payment intent ids as opaque strings (no card data in them).
  - Stripe event ids and full event payloads in `stripe_events` for idempotency and forensics — these payloads include customer email (which we already have) and the last four digits of the card number (Stripe standard). Retention policy for `stripe_events` is TBD in the same review.
  - Audit entries naming the acting profile and the amount — no card data.
- **What Stripe retains on their side** — the full card record, PaymentIntent history, dispute records. Subject to Stripe's own compliance and retention. Out of our reach.
- **Account deletion interaction** (depends on §6 choice):
  - Option A/B: the household's ledger rows are deleted when the household is torn down (ADR 034 solo path); the `stripe_events` entries referencing those sessions are scrubbed (customer email nulled, PaymentIntent id kept). Legal review needs to bless the scrub shape.
  - Option C: same tear-down; final forfeiture row before deletion.
- **Unclaimed property law (California)** — balance held indefinitely may invoke CA unclaimed-property rules after an inactivity period. The legal review needs to answer whether the balance is subject to this.
- **Refund policy copy.** The marketing site, the `/account/balance` page, and the package cards all need a consistent statement of the refund posture. Written once the §6 choice lands.
- **Receipt and tax posture.** Stripe sends the customer a receipt by default; our outbox sends an additional confirmation. Sales tax on swim lessons in CA is a Jason / accountant question, not an engineering one, but flag it for the review.

---

## 8. Phases on this branch — backend before UI

**Phase 1 — Schema and shared pricing (no behavior change yet)**

- Migration: `balance_entry_type` enum; `household_balance_ledger` table with append-only trigger (modeled on `skill_ratings`); `stripe_events` table with UNIQUE(`stripe_event_id`); `lessons.price_cents_at_booking integer` (nullable, see Phase 4 note).
- `packages/shared/src/pricing/` pure module + unit tests enumerating all 12 lesson-price combos and all 8 package-price combos. The `(3 swimmers, 45 min) = $148.50` case gets its own test.
- `packages/shared/src/schemas/payments.ts` Zod schemas (ledger entry shape, balance response shape, checkout-session request body shape, webhook event shape — a loose `z.object({ id, type, data }).passthrough()` since Stripe's full event schema is wide).
- CLAUDE.md gets a one-line entry: *"Payments: the balance ledger is append-only; writes always pair with an audit log entry in the same transaction."*

**Phase 2 — Balance service**

- `apps/api/src/services/balance/` with:
  - `getHouseholdBalance(householdId)` — simple sum, no lock.
  - `applyLedgerEntry(tx, entry)` — inside a provided transaction, writes the row and the audit row. Caller holds the advisory lock.
  - `withBalanceLock(householdId, fn)` — helper that opens a tx, acquires the lock, calls `fn`, commits.
  - Integration tests at `apps/api/src/__tests__/integration/balanceLedger.integration.test.ts`: concurrent-charge serialization, package two-row atomicity, append-only trigger rejection of UPDATE/DELETE.

**Phase 3 — Stripe integration**

- `apps/api/src/services/stripe/` with `createCheckoutSession`, `verifyAndStoreEvent`, `handleCheckoutCompleted`.
- `POST /payments/checkout-session` route (behind `requireParent`): takes `{ kind: 'topup' | 'package', amountCents?, packageTier?, swimmerCount? }`, server-side validates the household/swimmer-count/package combination, creates the Checkout session with the household id in metadata, returns the hosted URL.
- `POST /webhooks/stripe` route (no auth middleware, raw-body express.raw mounted before `express.json()` for this one path): verifies signature, inserts into `stripe_events`, dispatches by event type.
- Env validator additions for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (`apps/api/src/lib/env.ts`).
- `apps/api/.env.example` additions with placeholders and the `stripe listen` command.
- Integration tests: signature failure → 400, replay of same `stripe_event_id` → 200 with no second ledger insert, replay of same `checkout_session_id` (bypassing the first layer) → still no double-credit.

**Phase 4 — Hook into booking flows**

- `POST /lessons` (parent booking) — before the lesson insert, under the day lock and now also the balance lock, compute `price = priceForLesson(...)`, check `balance >= price`, insert the lesson with `price_cents_at_booking = price`, write the `lesson_charge` ledger row. Audit as today.
- `POST /coach/lessons` (ADR 029) — body gains `chargeType: 'balance' | 'free'`. For `'balance'`, same shape as parent; for `'free'`, insert the lesson at `price_cents_at_booking = 0` with a `free_lesson` ledger marker row (amount 0).
- `POST /parent/batch-bookings` (ADR 030) — sum per-lesson prices in the transaction, single balance-sufficient check, all-or-nothing.
- Cancellation (`DELETE /lessons/:id`), no-show (coach-flow), expired-pending (cron) — all write `refund_to_balance` at the locked price in the same transaction as the status change.
- Reschedule (`PATCH /lessons/:id`) — delta handling if pricing inputs changed, as described in §2.
- Backfill migration: `UPDATE lessons SET price_cents_at_booking = priceForLesson(...)` across existing rows, then a second migration adds the NOT NULL constraint. (Or: leave nullable forever with a "null means pre-payments-era" convention. Decide in Phase 4 after an audit of refunds-on-old-lessons risk; current recommendation is backfill + NOT NULL for simplicity.)

**Phase 5 — Parent UX**

- `/account/balance` page under `apps/web/src/content/AccountBalanceContent/`.
- Insufficient-funds modal on the booking screens.
- Add-funds and buy-package flows that POST to the API and redirect to Stripe.
- Successful-return route (`/account/balance?topup=success` or similar) that reads the balance fresh and shows a confirmation toast.

**Phase 6 — Coach UX**

- Household-detail balance panel.
- Coach booking "charge / free" radio.
- Coach-adjustment modal.

**Phase 7 — Emails and FAQ**

- Outbox event wiring for `balance_funds_added` / `balance_refunded` / `balance_adjusted`.
- Templates for each, with the same `ejs` / `react-email` approach ADR 028 uses.
- FAQ edits: credit-never-expires line, balance-model explainer, insufficient-funds explainer.

**Phase 8 — Unused balance (depends on §6 outcome)**

- If Option A: deletion-flow preflight; Stripe refund helper on coach UI.
- If Option B: automatic-refund engine in the deletion job post-commit task.
- If Option C: forfeiture row and the legal/copy work.

---

## 9. Open questions

### For Jason

1. **Unused-balance policy** — Option A, B, or C in §6 (my recommendation: A).
2. **Minimum top-up amount** — $1, $20, or something else? Default proposal: $20 for ergonomics (sub-$20 top-ups are small enough that the Stripe fee eats a meaningful fraction, and Jason is absorbing fees), with an exception for the insufficient-funds "add exactly $Z" shortcut which may be less than $20.
3. **"Buy a package" available to brand-new households** who haven't booked a lesson yet? Default proposal: yes — no reason to gate it.
4. **Package swimmer-count resolution** — tie to household's active swimmer count (my default) or let the parent choose at checkout (e.g. "this package is for my 2 kids" vs "this package is for just my daughter")? Default resolves by count because packages fund a balance that doesn't track swimmers; the only question is which discount tier applies.
5. **Coach-adjustment reason** — require it (my proposal, free text, 500-char cap) or make it optional?
6. **Stripe receipt emails** — leave on (my recommendation) or disable in favor of our outbox-only?
7. **Receipt sender identity** — Axiom Aquatics as the sender name on our outbox receipts? Reply-to on Jason's address, or on a no-reply?
8. **Refund window for cancellations** — the brief says cancellations refund in full. Confirm this holds for a cancellation 30 minutes before the lesson (currently the parent-cancel cutoff per earlier work), not just for 24+-hour cancels.

### Calls I'm making myself (will proceed unless flagged)

- **Hosted Checkout, not Elements.** Covered in §3.
- **Charge at booking, refund on decline/expire.** Jason leans this; proposal matches.
- **Coach "charge balance" cannot go negative.** Free lesson covers the pool-deck "I'll sort it out later" case.
- **Batch bookings: all-or-nothing on total.**
- **Per-household advisory lock to serialize concurrent balance writes.**
- **Ledger entry types as listed in §1, including splitting `package_purchase` and `package_bonus` into two rows.**
- **Lesson price locked at insert via `lessons.price_cents_at_booking`, refunds use the locked value, reschedule writes a delta row only if pricing inputs changed.**
- **Append-only ledger enforced by trigger, with account deletion as the documented exception** (same pattern as ADR 022 / ADR 032 / ADR 034 for skill ratings).
- **`stripe_events` table + per-session UNIQUE on the ledger row** as the two layers of webhook idempotency.
- **Stripe keys on API only, never on Vercel, never `NEXT_PUBLIC_*`.**
- **Separate `household_email_outbox` table for balance-level emails**, parallel to `lesson_email_outbox` (ADR 028). Avoids overloading the lesson outbox with non-lesson events.
- **Legal review covers the Stripe data boundary, our scrub shape, and the unclaimed-property question** before the first production charge.
