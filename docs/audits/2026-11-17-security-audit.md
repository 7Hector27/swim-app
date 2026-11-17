# Security audit — 2026-11-17

Branch: `chore/security-audit` (off `dev`).
Scope: read-only. No code changes.

Finding format per item:
- **Status** — `safe` / `issue` / `not applicable` / `needs manual check`
- **Evidence** — `file:line` or config path
- **Why it matters here** — one or two sentences tying the generic class to this app
- **Fix** — concrete action
- **Size** — S / M / L

Deployment context: `apps/web` is Next.js 15 on Vercel; `apps/api` is Express on Railway; Supabase provides Postgres + auth. Domain inventory per `docs/deployment.md:7-34`.

---

## Summary

### Counts by status

| Status | Count |
|---|---|
| issue | 7 |
| needs manual check | 1 |
| safe | 9 |
| not applicable | 3 |
| **total** | **20** |

### Top issues ranked by risk

1. **Item 10 — `requireUser` does not enforce `email_confirmed_at`.** Pre-hijacking surface: anyone who gets a Supabase session (whether the dashboard's "Confirm email" is on or off) can reach any `requireUser`-gated route. Needs both a dashboard toggle and a middleware line.
2. **Item 4 — `household_invites` has no RLS enable.** Defense-in-depth gap: every other table has `ENABLE ROW LEVEL SECURITY`, this one slipped through at migration 0008. One-line custom migration.
3. **Item 12 — Secret-strength validators missing.** `SUPABASE_SERVICE_ROLE_KEY`, VAPID keys, and Stripe / Resend keys have no min-length / shape check in the env Zod schema. A truncated paste boots cleanly and only breaks at first use.
4. **Item 18 — No CSP on the web app.** XSS + supply-chain mitigation gap. Attack surface is small (self-hosted fonts, no third-party scripts, Stripe via full-page nav), so a tight CSP is quick to land.
5. **Item 14 — No `X-Frame-Options` / `frame-ancestors` on the web app.** Any site can `<iframe>` `axiomaquatics.io` for UI-redress on authenticated pages (book-lesson, delete-account, top-up).
6. **Item 8 — Login has no app-side rate limit.** Login runs `supabase.auth.signInWithPassword` directly from a Vercel server action; the Express `authEmailLimiter` never sees it. Protection is whatever's configured in the Supabase dashboard.
7. **Item 1 — `X-Powered-By: Next.js` header.** Low-signal framework fingerprinting, but a one-line fix.

### Manual checks for Hector (no code changes)

- **Supabase dashboard — Auth settings.** Confirm each of these before relying on items 8, 10, 12:
  - Providers → Email → **Confirm email: ON** (gates item 10 from the user-creation side).
  - Rate Limits → sign-ins, sign-ups, OTP verifies, token refreshes all set to sensible numbers.
  - **CAPTCHA (hCaptcha / Turnstile)** enabled for sign-in and sign-up.
  - Sessions → **JWT expiry** ≤ 1 h, **Refresh token rotation** on with short reuse-interval.
  - Email → **OTP length ≥ 6**, OTP expiry ≤ 15 min.
  - **Secure email change: ON**.
  - **Rotate the service role key** if it was ever pasted into a shell history, PR, screenshot, or chat.
- **DNS verification (item 17).** Walk the subdomain checklist in the Requests & redirects section. `send.axiomaquatics.io` is the highest-value target (DKIM-aligned mail).
- **Production response headers.** After any fix lands, `curl -sI https://axiomaquatics.io` to confirm `X-Powered-By` is gone, CSP is present, and `X-Frame-Options`/frame-ancestors are set. `curl -sI https://axiomaquatics.io/.git/config` should return 404 (item 2 sanity check).
- **No source maps in prod bundle.** After any build, `find apps/web/.next -name "*.map"` should return nothing on Vercel's deployed output as well.

---

## Info leaks

### 1. X-Powered-By / version headers

- **Status:** issue (web); safe (api).
- **Evidence:** `apps/web/next.config.ts:33-37` — `const config: NextConfig = { outputFileTracingRoot: ... };`. No `poweredByHeader: false`, so Next.js emits `X-Powered-By: Next.js` by default. API side: `apps/api/src/app.ts:58` — `app.use(helmet())`. Helmet's defaults call `app.disable("x-powered-by")`, so Express's header is stripped.
- **Why it matters here:** The prod domain advertises the framework to CVE-matched scanners. Low signal for this app since there are no exploitable public Next.js CVEs in the pinned version right now, but free to remove.
- **Fix:** Add `poweredByHeader: false` to the `NextConfig` object in `apps/web/next.config.ts`.
- **Size:** S.

### 2. `.git` folder exposure

- **Status:** safe.
- **Evidence:** `apps/web/public/` contains only `icons/`, `images/`, `logos/`, `social/`, `sw.js` — no `.git`, no dotfiles. `apps/api/src/app.ts` has no `express.static()` call. No `vercel.json` / `railway.toml` at repo root that would serve arbitrary paths. `.gitignore` top level already excludes build outputs.
- **Why it matters here:** Not an Apache/PHP-style static host, so `.git/*` cannot be served. The historical concern (full repo clone, including historical secrets) doesn't apply to Vercel/Railway's deployment model.
- **Fix:** None. Sanity-check on prod with `curl -I https://axiomaquatics.io/.git/config` returning 404.
- **Size:** —.

### 3. Source maps in production

- **Status:** safe.
- **Evidence:** `apps/web/next.config.ts` — `productionBrowserSourceMaps` is not set (Next 15 default is `false`). `apps/web/tsconfig.json:7` — `"noEmit": true` with no `sourceMap` key; `tsc` emits nothing. After the last clean build, `find apps/web/.next -name "*.map"` returned zero results; only `.js` chunks in `.next/static/chunks/`.
- **Why it matters here:** Shipped maps would expose server action names, Zod schemas, and auth flow internals.
- **Fix:** None. Keep `productionBrowserSourceMaps` unset.
- **Size:** —.

---

## Data access

### 4. RLS on every table

- **Status:** issue.
- **Evidence:** Every `pgTable` in `apps/api/src/db/schema.ts` has a matching `ENABLE ROW LEVEL SECURITY` migration, with one exception: `household_invites`. `apps/api/src/db/migrations/0008_add_household_invites.sql:11` creates the table without any RLS enable, and no subsequent migration adds one. Schema definition at `apps/api/src/db/schema.ts:285`.
- **Why it matters here:** All data access goes through `apps/api` using the service role key (which bypasses RLS), so there is no production exploit path *today*. But every other table is RLS-enabled, so this breaks the invariant that a future direct-from-web query path, a leaked anon key, or a Supabase Advisor sweep would depend on. `household_invites` holds `token_hash` and household/profile pointers — exactly the rows you don't want browsable with a leaked key.
- **Fix:** `pnpm db:generate --custom --name=enable_rls_household_invites`, then write `ALTER TABLE "household_invites" ENABLE ROW LEVEL SECURITY;` into the generated SQL. No policies are needed; RLS-on-with-no-policy is "deny all to non-service-role," which is the intended posture.
- **Size:** S.

Separate finding in the same item: the web app never queries Supabase directly for data (`grep "supabase.from(" apps/web/src` returns zero). All `createClient` sites import from `@/lib/supabase/server.ts` and only call `supabase.auth.getUser()` / `getSession()` / `signOut()`. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is used server-side only by `src/lib/supabase/server.ts:8` and `src/lib/supabase/updateSession.ts:9` for session management. Safe.

### 5. Supabase storage

- **Status:** not applicable.
- **Evidence:** Grep across the entire repo for `.storage`, `supabase.storage.from(`, `storage/v1/object/public/` returns no matches.
- **Why it matters here:** Nothing to audit; no buckets exist.
- **Fix:** —.
- **Size:** —.

### 6. Price from the browser

- **Status:** safe.
- **Evidence:** Every money-moving endpoint computes amounts server-side from `packages/shared` pricing or from stored ledger / household state. Nothing trusts an inbound `amountCents`:
  - Parent booking `POST /lessons`: `apps/api/src/routes/lessons.ts:710` — `const priceCents = priceForLesson(durationMinutes, swimmerCount);`.
  - Reschedule reprice: `apps/api/src/routes/lessons.ts:2597`.
  - Batch booking: `apps/api/src/routes/lessons.ts:1428,1491` compute per-pick inside the batch tx.
  - Coach booking: `apps/api/src/routes/coachLessons.ts:1884`.
  - Coach reschedule reprice: `apps/api/src/routes/coachLessons.ts:1377`.
  - Stripe checkout session: `apps/api/src/services/stripe/checkout.ts:104` — `priceForLesson(...) * quantity`.
  - Stripe webhook credit: `apps/api/src/services/stripe/webhook.ts:332` — recomputes from metadata before crediting.
  - Checkout body schemas in `packages/shared/src/schemas/payments.ts:96-120` are `.strict()` and carry only `durationMinutes`, `swimmerCount`, `quantity`, `packageTier` — no `amountCents`.
  - Cash-out execution (`apps/api/src/services/balance/cashOut.ts:204`) is invoked with no body amount; refund figures are derived entirely from the ledger.
  - Coach-adjust balance (`apps/api/src/routes/coachHouseholds.ts:628`) is the one endpoint that accepts an inbound `amountCents` via `CoachAdjustBalanceBodySchema`. This is expected — coach-initiated signed adjustment — and the task spec excludes it.
  - Other `amountCents` appearances in shared schemas (`payments.ts:47,141,298,330`) are all on response / outbound types (`LedgerEntrySchema`, `BalanceHistoryEntrySchema`, `NeedsManualRefundJobSchema`, `CashRefundNeedsAttentionEntrySchema`), never on inbound bodies.
- **Why it matters here:** This is the whole premise of the balance ledger — if any money route trusted a client amount, a parent could book a lesson for one cent. The ledger would reconcile out of sync and the audit log would record the correct actor. Server-side pricing closes that loop.
- **Fix:** None.
- **Size:** —.

### 7. Race conditions on read-then-write paths

- **Status:** safe on every path audited. Every money-move / stateful write runs inside `db.transaction()`, with either `pg_advisory_xact_lock(...)` serialization, row-level `SELECT … FOR UPDATE`, or a unique constraint.

| Path | Protection | Evidence |
|---|---|---|
| Parent booking (`POST /lessons`) | `db.transaction()` + `lesson-day:<laDateStr>` advisory lock + `household-balance:<householdId>` advisory lock; slots re-validated inside the lock | `apps/api/src/routes/lessons.ts:713-725` |
| Batch booking | `db.transaction()`, locks future-dated pending/approved rows, throws `BatchPicksConflictError` on conflict | `apps/api/src/routes/lessons.ts:1311,1915` |
| Balance debit on booking | Household advisory lock inside the same tx as the lesson insert | `apps/api/src/services/balance/ledger.ts:259-261,458` |
| Balance refund on cancel | `db.transaction()` + per-household balance lock (ADR 036 §4) | `apps/api/src/routes/lessons.ts:2299-2302` |
| Balance refund on decline | `db.transaction()` + row `FOR UPDATE` + balance lock | `apps/api/src/routes/coachLessons.ts:1063,1186,1328,1366` |
| Balance refund on expire (cron) | `db.transaction()` + `FOR UPDATE` + outbox-under-same-tx | `apps/api/src/routes/coachLessons.ts:561` |
| Cash-out execution | Caller-owned tx; cash-refund-jobs rows have `uniqueIndex idempotency_key` and `ledger_id .unique()`; drain uses `FOR UPDATE SKIP LOCKED` | `apps/api/src/services/balance/cashOut.ts:204-222`, `cashRefundDrain.ts:164,239`, `schema.ts:1759,1770` |
| Coach balance adjustment | Household advisory lock via `applyLedgerEntry` | `apps/api/src/routes/coachHouseholds.ts:660` |
| Household invite accept | `db.transaction()` + `household_invites.token_hash` UNIQUE + check constraint preventing revoked+accepted | `apps/api/src/routes/invites.ts:96`, `migrations/0008_add_household_invites.sql:14` |
| Policy acceptance | `db.transaction()` + `user_policy_acceptances_user_slug_version_uniq` | `apps/api/src/routes/policies.ts:78`, `schema.ts:1916` |
| Account deletion (ADR 034 solo teardown) | `db.transaction()` + `account-deletion:<profileId>` advisory lock + `FOR UPDATE` on household + balance advisory lock | `apps/api/src/routes/accountDeletion.ts:60,164`, `services/accountDeletion/deletion.ts:286,340,590` |
| Lesson approve (coach) | `db.transaction()` + `FOR UPDATE` on the lesson row | `apps/api/src/routes/coachLessons.ts:746` |
| Lesson decline (coach) | `db.transaction()` + `SELECT ... FOR UPDATE` on live pending lessons | `apps/api/src/routes/coachLessons.ts:854-862` |
| Stripe webhook credit | `db.transaction()` + balance advisory lock + `balance_ledger_stripe_session_uq` unique index (webhook-idempotent per session) | `apps/api/src/services/stripe/webhook.ts:135,251`, `schema.ts:1706` |

- **Why it matters here:** The balance ledger is append-only (trigger at `apps/api/src/db/migrations/0076_loose_sunspot.sql`). Audit and outbox rows co-transact with the business change they record. Together those make every money path recoverable by replay; losing a row on crash is the failure mode that these locks and transactions prevent.
- **Fix:** None.
- **Size:** —.
