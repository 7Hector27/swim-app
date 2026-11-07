# Plan: Payments and prepaid household balance

**Status:** Planning (revised 2026-11-06)
**Branch:** `feature/payments` (off `dev`)
**ADR:** [036 — Payments and prepaid household balance via Stripe](../decisions/036-payments-stripe-prepaid-balance.md) (draft)

---

## Overview

Every household carries one prepaid balance, stored in integer cents, derived from an append-only ledger. Parents fund the balance by card through Stripe (hosted Checkout). Bookings charge the balance at insert time; cancellations, declines, bulk-cancels, no-shows, and pending-expirations refund it. Coach bookings either charge the balance or mark the lesson free. Credit never expires. There is no Venmo, no manual-payment stage, no balance import.

Packages and single-lesson top-ups both just add to the balance — a package is a top-up that also adds a bonus row for the discount, so the balance history shows exactly where every cent came from.

The pricing table is a single pure module in `packages/shared` so the API, the booking screens, and the package cards all read the same number. **A lesson's refund amount is whatever its `lesson_charge` ledger row records**, not a column on the lesson itself. A lesson with no charge row (free or pre-payments era) refunds nothing. This keeps the ledger the authoritative source of money and removes any need for a locked-price column on `lessons`.

---

## Decisions already baked in (from Jason)

Fixed inputs from the feature brief, not up for debate in planning:

- **Private rate:** $120/hr, billed by the minute. 30 min = $60; 45 min = $90; 60 min = $120.
- **Sibling rates (per hour, one household):** 2 swimmers $180; 3 $198; 4 $216.
- **Only cents value is 50 cents.** All sibling per-minute rates divide evenly except 3-swimmer/45-min ($148.50). Pricing module returns integer cents; no rounding surprises.
- **One prepaid balance per household**, in cents. Parents see dollars plus an approximate count of private hours.
- **Packages — "Cannonball" (10 hr, 10% off) and "Deep End" (20 hr, 20% off)**, each sized for 1–4 swimmers. Credit = hourly rate × hours. Price = credit × (1 − discount). Example copy: *"Pay $1,080, get $1,200 of lesson credit."* Credit never expires.
- **Single-lesson top-ups add exactly that lesson's price** — the parent picks a duration and swimmer count, and the top-up is `priceForLesson(duration, swimmerCount)`. No free-form "add any amount" field anywhere in the app.
- **Card only, via Stripe.** No Venmo, no manual-payment mode. Jason absorbs card fees.
- **No existing balances to import.** Production launches empty; dev data is test data.
- **Insufficient-funds screen** offers two routes: add the exact shortfall for this booking, or buy a package.
- **Coach can book any family** with two choices: charge their balance, or free lesson.
- **Cancellations, declines, bulk-cancels, no-shows, and expired-pending all refund in full to the balance**, always, with no cutoff. Full refund regardless of how close to the lesson the cancellation happens.
- **No travel fee.** The pricing module takes `(durationMinutes, swimmerCount)` only; location does not affect price.
- **FAQ updates at launch:** credit never expires, how the balance works, and the ages answer no longer says "20-minute bursts." (Little ones book 30 minutes; Jason keeps the in-water work in short bursts within that.)

---

## 1. Ledger

### Table shape

New table `household_balance_ledger`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `household_id` | uuid nullable → households | indexed; nullable only to carry anonymized rows after household deletion (see §7) |
| `entry_type` | enum `balance_entry_type` | see list below |
| `amount_cents` | integer not null | signed: positive credits, negative debits, zero markers allowed |
| `lesson_id` | uuid nullable → lessons | set for `lesson_charge` and `refund_to_balance`; refunds look up the matching `lesson_charge` by this field |
| `stripe_checkout_session_id` | text nullable | UNIQUE partial index WHERE NOT NULL — idempotency anchor for top-ups and package purchases |
| `stripe_payment_intent_id` | text nullable | denormalized for the ledger history view |
| `actor_id` | uuid nullable → profiles | acting party: parent for card flows, coach for charges/adjustments, `null` for cron-driven refunds |
| `reason` | text nullable | required on `coach_adjustment`; Zod-capped at 500 chars |
| `created_at` | timestamptz not null default now() | |

Append-only enforced the same way `skill_ratings` is: a trigger that blocks `UPDATE` and `DELETE` on any row. Account deletion is the single documented exception (same posture ADR 022 / ADR 032 / ADR 034 already established for the skills ledger), and for payments the exception is weaker: rows are **anonymized** rather than deleted — see §7.

### Entry types

`balance_entry_type` is a Postgres enum with these values:

- **`card_topup`** — parent paid by card for a plain top-up (always sized to an exact single-lesson price under the "no free-form amount" rule). Amount positive, equal to the card charge.
- **`package_purchase`** — parent paid by card for a package. Amount positive, equal to the card charge (`price`, not `credit`).
- **`package_bonus`** — the discount delta for a package. Amount positive, equal to `credit − price`. Written in the same transaction as the matching `package_purchase` so the two rows always appear together and the balance moves by the full `credit` atomically.
- **`lesson_charge`** — a booking consumed balance. Amount negative, equal to `priceForLesson(duration, swimmerCount)` at the moment of booking. **This row is the authoritative charge record for the lesson.**
- **`refund_to_balance`** — cancellation, decline, bulk-cancel, no-show, or expired-pending refund. Amount positive, equal to the matching `lesson_charge.amount_cents` flipped to positive — i.e. the exact amount charged, never recomputed from current rates. A lesson with no matching `lesson_charge` (free-lesson marker or missing) writes **no** refund row.
- **`coach_adjustment`** — Jason manually moves the balance. Amount signed. `reason` required. Audited.
- **`free_lesson`** — a coach-booked free lesson. Amount `0`. Written for history completeness so the family's balance screen explains the lesson's existence; does not move the balance and is not considered a charge, so cancelling a free lesson refunds nothing.

Why `package_bonus` is a separate row rather than a sidecar column on `package_purchase`: the audit question "how much actual money came in via packages?" is one `GROUP BY entry_type` over the ledger; "how much promotional credit went out?" is the same, on `package_bonus`. Split rows make reconciliation mechanical.

### Refund lookup

```sql
SELECT amount_cents FROM household_balance_ledger
WHERE lesson_id = $1 AND entry_type = 'lesson_charge'
LIMIT 1;
```

The refund path reads this row, writes a `refund_to_balance` of `-amount_cents` (flipped sign), and audits both. No row found → no refund row written and no error (free lessons and any pre-payments-era lessons that ever appear here refund $0 by design).

### Balance derivation

```sql
SELECT COALESCE(SUM(amount_cents), 0)
FROM household_balance_ledger
WHERE household_id = $1;
```

Covered by the `(household_id)` index. At Jason's expected throughput (order hundreds of entries per household per year) the sum is sub-millisecond; no stored-balance column, no cache. If the ledger ever grows past the point where this hurts, the fix is a materialized view keyed on household, not a denormalized column — the append-only invariant means the view is always correct after a trigger-driven refresh.

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

Two browser tabs clicking "Book lesson" at the same instant could both read a $90 balance, both decide it's enough for a $60 lesson, both write a −$6000 row, and leave the balance at −$30. The advisory lock makes that impossible:

```ts
await tx.execute(
  sql`SELECT pg_advisory_xact_lock(hashtext('household-balance:' || ${householdId}))`,
);
```

Every transaction that reads-then-writes balance takes the lock first. Concurrent transactions on the same household serialize; concurrent transactions on different households do not. Independent of the existing `lesson-day` advisory lock (ADR 029) — a coach booking on 2026-12-01 for one household cannot block a parent booking on 2026-12-02 for another. Acquire order is always "day lock first, then balance lock" so there is one consistent global ordering and no deadlock between the two namespaces.

### Package purchase → two rows, one transaction

```
BEGIN
  INSERT INTO household_balance_ledger ( ..., entry_type='package_purchase', amount_cents=108_000 )
  INSERT INTO household_balance_ledger ( ..., entry_type='package_bonus',    amount_cents= 12_000 )
  INSERT INTO household_audit_log    ( action='balance_package_purchased', ... )
COMMIT
```

Balance moves from $0 to $1,200 atomically. A concurrent `GET /me/balance` either sees $0 (before commit) or $1,200 (after), never $1,080.

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

All eight package variants resolve to integer cents (the 10% and 20% discounts fall on the cleanly-divisible hourly rates — no half-cent edge cases here).

### No price-locking column on `lessons`

The ledger is the authoritative record of money. Refunds read the `lesson_charge` row (above) by `lesson_id`. Rate changes in the future never affect any already-booked lesson's refund because the refund amount is the recorded charge, not a recomputation.

### Reschedule is time-only

`PATCH /lessons/:id` can only change the start time. Duration and swimmer-set changes are **cancel-and-rebook** (existing decision across the booking flows). A reschedule touches no money because the pricing inputs cannot change. No delta logic, no secondary ledger row.

Rebook after a cancel is two ledger rows the normal way: the cancel's `refund_to_balance` and the rebook's new `lesson_charge` at the current price.

### Pricing never leaks into the client bundle as a web-env secret

Public pricing is not sensitive and lives in `packages/shared` — imported freely by client components. Stripe-side Products/Prices are not used; we compute every amount server-side and hand Stripe an integer cents value for each Checkout session line. This keeps the Stripe dashboard simple and the single source of truth in the repo.

---

## 3. Stripe

### The data-minimization principle

Store as little as possible; keep what remains locked down. Concretely:

1. **Webhook signature verified against the raw body** before any processing. Unsigned, missing-header, or invalid-signature events are rejected with `400` and never touch the ledger.
2. **Every amount is server-computed** from the pricing module at session-creation time and at webhook-processing time. The browser never passes an amount, a package price, or a household id. The acting household is read from the authenticated session via `requireParent` / `requireHouseholdMember`; the `POST /payments/checkout-session` body carries only `{ kind, packageTier?, swimmerCount?, lessonTopup?: { durationMinutes, swimmerCount } }` — the discriminator plus the pricing inputs, never the dollars.
3. **The webhook re-validates the Checkout session's metadata against our records** before crediting: the household referenced in the metadata must exist, and the session's `amount_total` must equal the amount the pricing module computes for the declared kind/tier/inputs. If either check fails, the handler logs at `warn` and **does not credit** — the parent's card is still charged (Stripe doesn't un-charge on our refusal), so Jason is paged and refunds manually via the dashboard.
4. **The balance is credited only from the verified webhook.** The success-redirect page is purely a cosmetic "thanks — your balance is refreshing" screen that re-reads `GET /me/balance` from the DB. It never writes. A browser that forges the redirect URL cannot mint credit.
5. **No card data, no full event payloads, no Stripe customer details beyond the ids we need.** `stripe_events` carries the event id, the type, the Checkout session id (when applicable), and the received/processed timestamps — nothing else. No `payload jsonb`. The event's full body is re-fetchable from Stripe's API with the id if debugging ever needs it.
6. **Stripe keys and the webhook secret on the API only** — never on Vercel, never in a `NEXT_PUBLIC_*` variable, never in request logs (pino-http already redacts `authorization` and `cookie`; no Stripe keys enter log lines by construction because no route handler logs the whole env, and we don't log request bodies for the webhook route).

### Hosted Checkout vs Elements — recommendation: hosted Checkout

The choice is between Stripe-hosted Checkout (redirect to a Stripe URL) and embedded Elements (card input inline in our pages).

**Recommend Checkout for v1.** Reasons:

- **PCI scope.** Hosted Checkout keeps us on SAQ A — the simplest self-assessment questionnaire — because no card data touches our pages or servers. Elements drops us to SAQ A-EP, still card-data-free but with more compliance paperwork.
- **Built-in features.** 3D Secure, Apple Pay, Google Pay, Link (Stripe's one-click), and address collection are all handled by Stripe's hosted page with zero code on our side.
- **Design cost.** The top-up flow is infrequent (≤ a dozen times per family per year). A redirect-and-return flow is a reasonable UX cost for the compliance and feature savings.
- **Time to ship.** Checkout cuts the first-live-charge timeline by days.

The main loss: Checkout opens in a new context, which is a small UX seam versus an inline card form. If telemetry after launch shows an abandonment spike at the redirect step, we can migrate to Elements — the webhook, ledger, data-minimization and idempotency contracts here all survive the swap.

### Webhook handling

One endpoint: `POST /webhooks/stripe`. Wired before `express.json()` middleware so it can read the **raw** request body (required for signature verification); Stripe sends JSON but with a signed digest over the raw bytes, and any JSON parse-and-re-stringify breaks the signature.

**Signature verification.** Every request runs through `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`. Invalid signature → `400 Bad Request`, log at `warn` with the event id (if the body happens to be parseable at all) and nothing from the body. Non-negotiable; an endpoint that accepts unsigned webhook payloads is a free credit-issuance oracle.

**Metadata re-validation.** On a valid `checkout.session.completed`:

- Retrieve the session from Stripe by id (`stripe.checkout.sessions.retrieve`) so the handler reads from Stripe-authoritative state, not from the webhook body.
- Read `metadata.householdId`, `metadata.kind`, and the matching pricing inputs (`packageTier`, `swimmerCount`, or `lessonTopup.{durationMinutes,swimmerCount}`).
- Verify the household exists and is not deleted (`disabled_at IS NULL` on all members, household row present).
- Compute the expected amount via the pricing module and compare to `session.amount_total`. Mismatch → log `warn` with the event id and session id, **do not credit**, return `200` (Stripe should not retry a well-formed event we refused on policy grounds).
- Only on pass: open the DB transaction, acquire the household's balance advisory lock, insert the ledger row(s), insert the audit row(s), commit.

**Idempotency, two layers.**

1. **`stripe_events` table.** Columns: `stripe_event_id text primary key`, `event_type text not null`, `stripe_checkout_session_id text nullable`, `received_at timestamptz not null default now()`, `processed_at timestamptz nullable`. Incoming events are inserted with `INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING RETURNING stripe_event_id`. Zero rows returned → the event is a replay; respond 200 immediately without reprocessing. One row returned → hand off to the handler, then on success update `processed_at`.
2. **Per-session idempotency anchor on the ledger.** Even if `stripe_events` is somehow bypassed, `household_balance_ledger.stripe_checkout_session_id` UNIQUE prevents a double credit: the top-up/package handler inserts with `ON CONFLICT (stripe_checkout_session_id) DO NOTHING`. If the row already exists, the credit has already been applied.

Both layers are belt-and-braces: layer 1 is the standard pattern and handles well-behaved replays; layer 2 catches the pathological case where somehow a second webhook for the same session got past layer 1 (misconfigured clone endpoint, DB restore, operational mistake). The DB is the final arbiter.

**Events we care about (v1):**

- `checkout.session.completed` — the main top-up and package-purchase trigger. Metadata validated as above. If `kind === 'package'`, the handler writes both `package_purchase` and `package_bonus`.
- `charge.refunded` / `refund.created` — informational only in v1. If Jason manually refunds from the Stripe dashboard, the webhook logs it with the session id and the amount so he can mirror the ledger adjustment via the coach UI. Automated ledger write on manual Stripe refunds is explicitly out of scope for v1 — keeps the coupling one-way.
- `checkout.session.expired` and `checkout.session.async_payment_failed` — log for support. No ledger row.

All other event types return 200 with no action (Stripe retries non-200s up to 3 days).

**Response contract.** 200 for any event we recognized, including replays and policy-refusals. 400 for signature failure. 500 for unhandled exceptions (Stripe will retry, which is what we want). Never return 2xx on an unhandled exception — that quietly loses the retry.

### Success redirect is cosmetic

Checkout's `success_url` lands on `/account/balance?topup=success`. The page server-renders the current balance from the DB (via `GET /me/balance`) and shows a toast. **It does not credit anything.** If the webhook hasn't arrived yet (sub-second race), the toast says "Your top-up is processing — refresh in a moment." The success-redirect URL is not authenticated against the Checkout session because it isn't trusted to prove anything; the webhook is the source of truth.

### Keys and where they live

- **`STRIPE_SECRET_KEY`** — on `apps/api` only. Not exported to the client, not read by Next.js. Added to `apps/api/.env.example` with a `sk_test_...` placeholder and a comment pointing at the Stripe dashboard.
- **`STRIPE_WEBHOOK_SECRET`** — on `apps/api` only. Required at boot; the API's env validator (`apps/api/src/lib/env.ts`) refuses to start when `APP_ENV` is `dev` or `prod` without it (same posture as `SUPABASE_SERVICE_ROLE_KEY` after ADR 034).
- **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** — not needed under the hosted-Checkout design. Add only if we migrate to Elements.

The secret key and webhook secret are **never** shipped to Vercel. The web app's role is to call `POST /payments/checkout-session` on the API and redirect to the returned Stripe URL; it does not hold Stripe credentials.

### Local development

- `STRIPE_SECRET_KEY=sk_test_...` in `apps/api/.env`.
- `stripe listen --forward-to localhost:3001/webhooks/stripe` from the Stripe CLI. The CLI prints a `whsec_...` at startup — that is the local webhook secret, which goes in `apps/api/.env` as `STRIPE_WEBHOOK_SECRET`.
- Test cards from Stripe's docs (`4242 4242 4242 4242` for success, `4000 0000 0000 9995` for insufficient-funds decline, `4000 0025 0000 3155` for 3DS).
- `apps/api/.env.example` gains both Stripe keys with test-mode placeholders and a one-line pointer at the `stripe listen` command.

### What Jason needs for live mode

1. **Activate the Stripe account.** Business details, EIN/SSN, bank account for payouts, representative info.
2. **Set the payout schedule.** Defaults to daily; Jason can change to weekly or manual.
3. **Register the production webhook endpoint.** In the dashboard under *Developers → Webhooks*, add `https://api.axiomaquatics.com/webhooks/stripe` (or whatever the prod API hostname is), subscribe to the events listed above, copy the generated `whsec_...` into the Railway API service as `STRIPE_WEBHOOK_SECRET`.
4. **Add the live secret key** to the Railway API service as `STRIPE_SECRET_KEY`. Never commit; never put it on Vercel.
5. **Leave Stripe's built-in receipt emails on** (answer to open question Q5). Branded with Axiom Aquatics in dashboard settings. Our own outbox emails cover the balance-after-the-fact confirmation; Stripe's email covers the legal "you were charged $X" record.

---

## 4. Answered questions from the previous round

### Q1 — Charge at booking, refund on decline / expire / cancel / no-show / bulk-cancel

Still the recommendation (Jason leaned this way). Every booking consumes real money at insert time. Every transition out of a billable status writes `refund_to_balance` in the same transaction as the status change. Full refund, always, no cutoff (per Jason's decision — there is no 30-minute parent-cancel cutoff and no per-window refund variance).

### Q2 — Coach "charge balance" cannot take a balance negative

If balance < price, "charge balance" is disabled in the coach UI and the choice is forced to "free lesson" or "ask the family to top up." Negative balances would require a collections flow we don't have.

### Q3 — Batch bookings are all-or-nothing on the total

Sum the per-lesson prices, compare to balance under the household lock, commit the whole batch or roll it back with `insufficient_balance`.

### Q4 — Concurrent charges on one household serialize via advisory lock

`pg_advisory_xact_lock(hashtext('household-balance:' || household_id))` at the top of every balance-touching transaction. Independent of the day lock; acquire order is "day, then balance."

### Follow-up answers from Jason

- **Single-lesson top-ups:** no free-form "add any amount" field. The balance page offers the two packages plus **"Add credit for one lesson"** — a small form where the parent picks a duration (30/45/60) and a swimmer count (1–4) and the top-up amount is `priceForLesson(duration, swimmerCount)` exactly. The insufficient-funds screen offers the **exact shortfall** for the booking they attempted, or a package.
- **Package swimmer-count resolution:** parents can pick any tier. The card for the household's active swimmer count is **highlighted as the default**, but all four variants of both packages are selectable. (A one-swimmer household can buy the 4-swimmer tier if they want a bigger balance; a four-swimmer household can buy the 1-swimmer tier if they want a smaller one.)
- **Coach adjustment reason:** required free text, Zod-capped at 500 chars. Blank reason → 422 at the API, disabled submit at the UI.
- **Stripe receipts:** on. Our outbox is additive, not replacement.
- **Receipt sender identity:** same sender setup as the existing transactional emails (ADR 028). No new sender identity for balance emails.
- **"Buy a package" available to brand-new households** before they've booked a lesson: yes.
- **Refund cutoff:** none. Full refund any time, including immediately before the lesson, including 30 minutes before — the earlier "30-minute parent-cancel cutoff" referenced in planning does not exist.
- **Age gate:** none at the pricing layer. Kids 3 and under book 30 minutes the same way everyone else books 30 minutes — no special rule, no server-side age gate on duration. The FAQ ages answer gets edited (see §8) so it no longer promises "20-minute bursts."
- **Unused balance (Q1-from-brief):** still waiting on Jason. Options A / B / C remain in §6 with A recommended.

---

## 5. User-facing surfaces

### Parent — `/account/balance`

Mobile-first page under `apps/web/src/content/AccountBalanceContent/`. Linked from the account nav (new row) and from the booking screen's CTAs in the insufficient-funds state.

Layout:

1. **Balance card** at the top. Big number in dollars. Below, in smaller text: `≈ {approximatePrivateHours(balance)} hours of private lessons`, with a tooltip explaining the estimate assumes a single swimmer at the private rate.
2. **Package cards.** Two cards (Cannonball, Deep End). Each card shows a tier switcher with the household's active swimmer count highlighted as the default — tapping another swimmer count re-renders the card's credit, price, and bonus for that tier. "Buy" posts to `/payments/checkout-session` with `{ kind: 'package', packageTier, swimmerCount }` and redirects to Stripe.
3. **"Add credit for one lesson" form.** Pick a duration (30/45/60) and a swimmer count (1–4). The form shows the computed price inline (`priceForLesson(...)` formatted as dollars). "Add" posts to `/payments/checkout-session` with `{ kind: 'topup', lessonTopup: { durationMinutes, swimmerCount } }` and redirects to Stripe. No free-form amount input anywhere.
4. **History table.** Reverse-chronological. Columns: date, type (plain-language — "Lesson", "Refund", "Added credit", "Package: Cannonball (2 swimmers)", "Jason adjusted"), amount (signed, dollar-formatted), running balance after the entry. Pagination at 50 rows with a "Load more" button.

Insufficient-funds state at booking:

- Modal title: *Not enough balance.*
- Body: *This lesson costs $X.XX. Your balance is $Y.YY.*
- Two CTAs, stacked on mobile:
  - **Add exactly $Z.ZZ** (where `Z = price − balance`) — jumps to the Checkout flow with a pre-filled line item for exactly the shortfall. On successful return the parent lands back on the booking screen; the webhook has typically already credited by the time the parent gets there, so the booking's affordability check succeeds and the parent confirms. If the webhook has not yet arrived, the booking screen shows "Your balance is still processing — try again in a moment."
  - **Buy a package** — jumps to `/account/balance` with the package cards scrolled into view.

No free-form amount entry anywhere in the UX.

### Coach — household detail

The existing coach surfaces (`/coach/households/[id]`, `/coach/swimmers/[id]`) gain a Balance panel:

- Current balance (dollar-formatted).
- "Charge balance" / "Free lesson" radio on the coach-booking flow (see ADR 029 for the surrounding surface). "Charge balance" disabled with an inline hint if balance < price.
- A "Recent transactions" list — last 10 ledger rows with the same columns as the parent history.
- An "Adjust balance" button (opens a modal: positive or negative amount, **required** reason text, confirm). Writes a `coach_adjustment` ledger row + audit. Jason-only; the UI and the API both require `reason.trim().length >= 1`.

### Receipts, emails, notifications

- **Stripe sends its own receipt email** for every successful Checkout session (left on per Q5). Branded with Axiom Aquatics via Stripe dashboard config.
- **Reuse the existing `lesson_email_outbox`** (ADR 028) for payment-related emails. The outbox already carries per-household rows for the bulk-cancel case; extend the recipient-resolution path to accept purely-household-scoped rows for the funds-added / adjustment events. No new `household_email_outbox` table.
- **Refund notifications piggyback on the existing cancellation/decline/bulk-cancel/no-show emails** — no separate "your balance was refunded" email:
  - The existing `lesson_canceled` (parent cancel) email template gains two lines: "Refunded $X.XX to your balance." / "New balance: $Y.YY."
  - The existing `lesson_declined` (coach decline, per ADR 021 + ADR 028) template gains the same two lines.
  - The existing bulk-cancel summary email (ADR 033) gains a single "Refunded $X.XX total to your balance. New balance: $Y.YY." line.
  - A new `lesson_no_show` email is **not** added (coaches currently learn about no-shows in-app only). If we ever add one, it includes the refund lines; for v1, the audit log is the no-show source of truth and there is no email.
  - Expired-pending refunds: the existing `lesson_expired` email (if it exists; if not, this is a no-op) gets the same two lines.
- **Two new outbox event types:**
  - `balance_funds_added` — fired after `card_topup` or `package_purchase` commit. "You added $X.XX to your balance. New balance: $Y.YY." Package variant mentions the tier and swimmer count.
  - `balance_adjusted` — fired after `coach_adjustment` commit. "Jason adjusted your balance by ±$X.XX. New balance: $Y.YY. Reason: {reason}."
- **No `balance_refunded` event.** Refund info rides on existing lesson-status emails.
- **No `lesson_charge` email.** The lesson-confirmed email (ADR 028) already tells the parent the lesson was booked; adding a second email per booking is noise.
- **No `free_lesson` email.** The lesson-confirmed email with the "Jason scheduled this" copy (ADR 029) already covers it.
- **No coach-side push notifications** for ledger events in v1. Jason uses the household detail page for visibility; push is for lessons and alerts (ADR 031).

---

## 6. Unused balance — options to pick from

Credit never expires. The policy question is what happens when a family *asks* for their leftover money back, and what happens if they delete their account while holding balance. Still open on Jason; three coherent positions:

### Option A — Keep as credit; refunds on request only

- **Default:** balance stays on the household forever.
- **Refund-to-card on request:** the parent asks via email or Jason surfaces a refund button in the coach UI; Jason issues it manually from the Stripe dashboard, which reverses the specific `card_topup` or `package_purchase` charge. A `charge.refunded` webhook (logged only in v1 — see §3) prompts Jason to mirror a negative `coach_adjustment` ledger row via the coach UI.
- **Account deletion (ADR 034):** the deletion flow adds a preflight check. If balance > $0, the confirm screen offers *"Refund $X to your card"* (Jason-mediated via dashboard) or *"Forfeit $X"* with a typed-phrase confirmation. Deletion proceeds only after the balance is $0.
- **Tradeoffs:** keeps Jason's money in his pocket unless pressed; small effort per refund; places the refund-timing burden on parents. Risk: feels bad to a family that quits mid-package; may draw a "we keep your money by default" complaint.

### Option B — Automatic refund on account deletion

- **Same refund-on-request mechanism as A**, plus:
- **Account deletion automatically refunds:** the deletion job post-commit task walks `card_topup` + `package_purchase` rows most-recent-first, issuing Stripe refunds against each until the remaining balance is zero, then anonymizes the household as in ADR 034. Charges older than Stripe's 180-day refund window land as a residual flagged for Jason.
- **The `package_bonus` portion is forfeit on delete.** Only money the parent actually paid can be returned — the discount credit was ours.
- **Tradeoffs:** cleaner parent-facing story; matches "fair play" expectation; adds a post-commit retry step to the deletion job (same shape as the existing Google-reconcile retry from ADR 034).

### Option C — No cash refunds, ever; balance is non-redeemable credit

- **Legal copy says the balance is "non-refundable lesson credit."** Credit is always spendable, never convertible to cash.
- **Account deletion:** balance forfeits automatically. A final `coach_adjustment` row with `reason = 'account_deletion_forfeit'` and `amount_cents = -balance` records the forfeiture before the household is anonymized.
- **Tradeoffs:** simplest to operate; worst parent perception; strongest legal risk around unclaimed-property law. California (where Jason operates) has rules around prepaid balances that may treat this as unclaimed property — needs legal review. The "we keep leftover money" framing also invites credit-card chargebacks, which cost more than the refund would have.

### Recommendation

**Option A for v1**, with the deletion-flow preflight check. It's the smallest surface area to build, it gives Jason case-by-case control, and the "refund on request" copy is defensible. Move to Option B in a follow-up if the "refund button" grows into a visible parent request pattern.

**Reject Option C.** Chargeback and legal risk aren't worth the simplicity.

**Confirm with Jason before implementing.** If he leans A or B, we build accordingly; if C, we flag the legal review before writing any code.

---

## 7. Legal review packet

What the kids'-data / payments legal review needs to see:

- **Stripe is the payment processor and the PCI data owner.** We integrate via hosted Checkout, which means card numbers, CVVs, and expiry dates are entered on Stripe's domain and never touch our servers or logs. Our PCI compliance posture is SAQ A.
- **What we store on our side:**
  - Integer-cents balance movements in `household_balance_ledger`, each with the Stripe Checkout session id (when applicable) and the Payment Intent id (denormalized for convenience).
  - Stripe event ids, event types, session ids, and received/processed timestamps in `stripe_events`. **No `payload jsonb` column.** No card data of any kind. No customer email or name is pulled from the webhook into our DB (the parent's email already lives in `profiles` from auth; we don't copy it from Stripe).
  - Audit entries naming the acting profile and the amount — no card data.
- **What Stripe retains on their side** — the full card record, PaymentIntent history, dispute records, customer email history. Subject to Stripe's own compliance and retention. Out of our reach.
- **Account deletion: ledger rows are anonymized, not deleted. (Proposed default — needs sign-off.)** Payment records are generally subject to tax-retention requirements (seven years for the IRS, variable for CA). Deleting ledger rows on account deletion would prevent Jason from answering "what did Axiom Aquatics earn in 2026?" after a family left. The proposal is to treat the ledger the same way ADR 034 treats lessons: strip the `household_id` (set to NULL — the FK is already nullable per §1), null the `actor_id`, keep `amount_cents`, `entry_type`, `lesson_id` (which is also anonymized under ADR 034), the Stripe ids, and the timestamp. Jason can run revenue and refund reports; no identifying data about the deleted family remains.
  - The audit-log rows that reference the anonymized ledger entries are already covered by ADR 034's audit-payload scrub rule.
  - `stripe_events` rows are not scrubbed (they never carried identifying data), but their session ids now reference ledger rows whose household is null — reconciliation still works for Jason because the Stripe dashboard carries the original customer email. Our DB does not.
- **Unclaimed property law (California)** — balance held indefinitely may invoke CA unclaimed-property rules after an inactivity period. The legal review needs to answer whether the balance is subject to this and whether our §6 policy choice needs adjusting.
- **Refund policy copy.** The marketing site, the `/account/balance` page, and the package cards all need a consistent statement of the refund posture. Written once the §6 choice lands. "Full refund any time, no cutoff" is the policy for lesson cancellations under this ADR regardless of the §6 outcome.
- **Receipt and tax posture.** Stripe sends the customer a receipt; our outbox sends a balance-update confirmation. Sales tax on swim lessons in CA is a Jason / accountant question, not an engineering one, but flag it for the review.
- **Stripe principle checklist** — the implementation plan commits to (see §3): raw-body signature verification; server-computed amounts; webhook metadata re-validation; balance credited only from the webhook, never from the success redirect; no card data / no full payloads / no customer details beyond needed ids; keys on the API only. Each point has a test in Phase 3.

---

## 8. Phases on this branch — backend before UI

**Phase 1 — Schema and shared pricing (no behavior change yet)**

- Migration: `balance_entry_type` enum; `household_balance_ledger` table (with `household_id` nullable to support future anonymization under §7) and append-only trigger (modeled on `skill_ratings`); `stripe_events` table with `stripe_event_id PRIMARY KEY` and the narrow column set described in §3.
- `packages/shared/src/pricing/` pure module + unit tests enumerating all 12 lesson-price combos and all 8 package-price combos. The `(3 swimmers, 45 min) = $148.50` case gets its own named test.
- `packages/shared/src/schemas/payments.ts` Zod schemas (ledger entry shape, balance response shape, checkout-session request body — `{ kind: 'topup' | 'package', packageTier?, swimmerCount?, lessonTopup?: { durationMinutes, swimmerCount } }`).
- CLAUDE.md gets a one-line entry: *"Payments: the balance ledger is append-only; writes always pair with an audit log entry in the same transaction."*

**Phase 2 — Balance service**

- `apps/api/src/services/balance/` with:
  - `getHouseholdBalance(householdId)` — simple sum, no lock.
  - `applyLedgerEntry(tx, entry)` — inside a provided transaction, writes the ledger row and the audit row. Caller holds the advisory lock.
  - `withBalanceLock(householdId, fn)` — helper that opens a tx, acquires the lock, calls `fn`, commits.
  - `refundLessonCharge(tx, lessonId, reason)` — reads the matching `lesson_charge` row, writes the inverse `refund_to_balance`, audits, no-ops if no charge row exists.
  - Integration tests at `apps/api/src/__tests__/integration/balanceLedger.integration.test.ts`: concurrent-charge serialization, package two-row atomicity, append-only trigger rejection of UPDATE/DELETE, refund no-op on a free-lesson marker.

**Phase 3 — Stripe integration**

- `apps/api/src/services/stripe/` with `createCheckoutSession`, `verifyWebhookSignature`, `recordEvent`, `handleCheckoutCompleted`.
- `POST /payments/checkout-session` route (behind `requireParent` + `requireHouseholdMember`): body is `{ kind, packageTier?, swimmerCount?, lessonTopup? }` with Zod validation. **No amount in the body.** Server computes the amount from the pricing module, puts `{ householdId, kind, tier?, swimmerCount?, durationMinutes? }` in session metadata, returns the Stripe-hosted URL.
- `POST /webhooks/stripe` route (no auth middleware, raw-body `express.raw({ type: 'application/json' })` mounted before `express.json()` for this one path): verifies signature, inserts into `stripe_events`, dispatches by event type, re-validates metadata against the pricing module and the DB before crediting.
- Env validator additions for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (`apps/api/src/lib/env.ts`).
- `apps/api/.env.example` additions with placeholders and the `stripe listen` command.
- Integration tests enforcing every item of the §3 Stripe principle checklist:
  - Signature failure → 400, no ledger insert.
  - Metadata mismatch (tampered amount) → 200 but no ledger insert, warn log asserted.
  - Replay of same `stripe_event_id` → 200 with no second ledger insert.
  - Replay of same `checkout_session_id` bypassing layer 1 → still no double-credit.
  - Browser cannot forge the success redirect into a credit (no DB write from the success route, at all).
  - Browser cannot pass an amount: `POST /payments/checkout-session` with an `amountCents` field is either ignored (unknown-key stripping) or rejected (Zod `strict`).

**Phase 4 — Hook into booking flows**

- `POST /lessons` (parent booking) — under the day lock and the balance lock, compute `price = priceForLesson(...)`, check `balance >= price`, insert the lesson, write the `lesson_charge` ledger row with `lesson_id = inserted.id` and `amount_cents = -price`. Audit as today plus the new audit action.
- `POST /coach/lessons` (ADR 029) — body gains `chargeType: 'balance' | 'free'`. For `'balance'`, same shape as parent. For `'free'`, insert the lesson and write a `free_lesson` marker row (amount 0) — no charge, no refund on cancel.
- `POST /parent/batch-bookings` (ADR 030) — sum per-lesson prices in the transaction under the balance lock, single `insufficient_balance` check, all-or-nothing. **One `lesson_charge` ledger row per lesson, never a single row for the batch total.** Each row's `lesson_id` points at exactly one lesson so refunds stay per-lesson: cancelling one lesson out of a batch of five reads that lesson's charge row and refunds exactly that amount, leaving the other four untouched. Covered by an integration test in Phase 4: book a 3-lesson batch at `priceForLesson(60, 1) × 3`, cancel the middle lesson, assert the ledger has one `refund_to_balance` for that lesson's price only and the other two charges remain.
- Cancellation (`DELETE /lessons/:id`), decline (`PATCH /lessons/:id` → declined), bulk-cancel (ADR 033), no-show (coach flow), expired-pending (cron) — each calls `refundLessonCharge(tx, lessonId, ...)` in the same transaction as the status change. Free-lesson rows naturally refund nothing (no `lesson_charge` row to invert).
- Reschedule (`PATCH /lessons/:id`) — time-only. No ledger movement. Duration or swimmer-set changes are rejected at the API with a hint pointing at cancel-and-rebook (existing decision; this is just a reminder that the price flow does not need to handle them).
- **No backfill.** Production launches empty per Jason's brief; dev data is test data. Any pre-existing lesson row with no `lesson_charge` row simply refunds $0 by design.

**Phase 5 — Parent UX**

- `/account/balance` page under `apps/web/src/content/AccountBalanceContent/`.
- Package cards with tier switcher (household count highlighted as default).
- "Add credit for one lesson" form (duration + swimmer count).
- Insufficient-funds modal on the booking screens (exact-shortfall CTA + package CTA).
- Successful-return route (`/account/balance?topup=success`) that re-reads balance from the DB and shows a toast. Does not write.

**Phase 6 — Coach UX**

- Household-detail balance panel.
- Coach booking "charge / free" radio.
- Coach-adjustment modal with **required** reason text.

**Phase 7 — Emails and FAQ**

- Reuse `lesson_email_outbox`; two new event types: `balance_funds_added`, `balance_adjusted`.
- Extend existing `lesson_canceled`, `lesson_declined`, bulk-cancel summary, and (if present) `lesson_expired` templates with the two refund-info lines.
- Templates reuse the same sender identity as existing transactional emails (no new sender).
- FAQ edits: credit-never-expires line, balance-model explainer, insufficient-funds explainer. Ages answer rewritten so it no longer says "20-minute bursts" — proposed copy: *"Little ones book 30 minutes, same as everyone else. In the water, Jason keeps the drills in short bursts so attention stays fresh."*

**Phase 8 — Account deletion integration**

This phase is the one the earlier migrations deliberately deferred. It has two parts; the first is unconditional and must land regardless of which §6 option Jason picks.

Part A — ledger anonymization (unconditional):

- **Relax the append-only trigger from migration 0077** to permit a narrow `UPDATE` that nulls `household_id`, `actor_id`, and (if the migration-0077 column set ever grows) any other explicit identity columns — nothing else. The trigger's `IS DISTINCT FROM` check on every column must gain an allowlist of nullable-identity columns whose transition from non-null to null is legal during the account-deletion transaction. Pattern: follow the session-variable / transaction-tag approach ADR 034 already established for the skills-ledger `DELETE` exception (`SET LOCAL app.account_deletion = 'on'` inside the deletion transaction; the trigger checks for the tag and permits the anonymization update only when it's set). New migration, not an edit to 0077.
- **Integrate the ledger scrub into the ADR 034 solo-deletion engine.** For the deleted household, run `UPDATE household_balance_ledger SET household_id = NULL, actor_id = NULL WHERE household_id = <deleted household>` inside the same transaction as the rest of the teardown. No DELETE — rows survive with amounts intact for tax retention.
- **Audit-log payloads referencing the deleted household's ledger rows** are already covered by ADR 034's audit-payload scrub rule; no new scrub needed.
- **`stripe_events` rows are not touched** — they carry no identifying data under this plan's data-minimization posture.

Part B — unused-balance path (depends on §6 outcome, pending Jason):

- If Option A: deletion-flow preflight; Jason-mediated refund via Stripe dashboard with a mirrored negative `coach_adjustment` row. Deletion blocks until balance = $0.
- If Option B: automatic-refund engine in the deletion job post-commit task walks `card_topup` + `package_purchase` rows most-recent-first and issues Stripe refunds until the remaining balance is zero, flagging any residual beyond Stripe's 180-day refund window for Jason.
- If Option C: forfeiture row (`coach_adjustment` with `amount_cents = -balance` and `reason = 'account_deletion_forfeit'`) written in the deletion transaction, plus the legal/copy work.

---

## 9. Open questions

### For Jason

1. **Unused-balance policy** — Option A, B, or C in §6. Recommendation: A.

### Calls I'm making myself (will proceed unless flagged)

- **Hosted Checkout, not Elements.** Covered in §3.
- **Charge at booking, refund on decline / expire / cancel / no-show / bulk-cancel.** Full refund any time, no cutoff.
- **Coach "charge balance" cannot go negative.** Free lesson covers the pool-deck "I'll sort it out later" case.
- **Batch bookings: all-or-nothing on total.**
- **Per-household advisory lock to serialize concurrent balance writes.**
- **Ledger entry types as listed in §1, including splitting `package_purchase` and `package_bonus` into two rows.**
- **No price-lock column on `lessons`.** Refunds read the matching `lesson_charge` ledger row by `lesson_id`.
- **Reschedule is time-only.** Duration/swimmer changes are cancel-and-rebook.
- **Append-only ledger enforced by trigger, with account deletion as the documented exception.** For payments, the exception is anonymize-not-delete — ledger rows survive with `household_id` nulled so Jason retains tax records.
- **`stripe_events` table carries only event id / type / session id / received_at / processed_at** — no `payload jsonb`.
- **Per-session UNIQUE on the ledger row** as the second layer of webhook idempotency.
- **Stripe keys on API only, never on Vercel, never `NEXT_PUBLIC_*`.**
- **No `household_email_outbox` table.** Reuse `lesson_email_outbox` with household-scoped rows for the two new balance events.
- **No separate refund email.** Refund info rides the existing cancellation/decline/bulk-cancel email templates.
- **No free-form "add any amount" field** anywhere. Balance page offers packages + "add credit for one lesson"; insufficient-funds offers exact shortfall + package.
- **Package tier switcher** lets parents buy any swimmer-count variant; household's active count is highlighted as the default.
- **Coach-adjustment reason is required.**
- **Stripe receipts stay on.** Same sender identity as existing emails for our outbox messages.
- **Legal review covers the Stripe data boundary, the anonymize-not-delete ledger scrub, the "full refund any time" policy copy, and the unclaimed-property question** before the first production charge.
