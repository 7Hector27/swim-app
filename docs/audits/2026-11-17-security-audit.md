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

---

## Accounts and login

Auth stack confirmed: Supabase. Signup routes through `apps/api` (`POST /auth/signup` calls `supabase.auth.signUp`); login runs `supabase.auth.signInWithPassword` directly from the Vercel server action and never hits Express. No password-reset flow exists in the codebase today — only email confirmation via magic-link `GET /auth/confirm`. Invites are token-link only (no email sent).

### 8. Credential stuffing

- **Status:** issue (depends on Supabase dashboard settings to mitigate).
- **Evidence:** `apps/web/src/content/LoginContent/actions.ts:22` — `await supabase.auth.signInWithPassword(parsed.data)` runs directly from the server action. `apps/api/src/app.ts:157` mounts `authEmailLimiter` only on `POST /auth/signup`; login is never seen by Express. The per-email limiter itself is thoughtful (`apps/api/src/middleware/authEmailRateLimit.ts:43` — 5/hr, keyed on normalized email, runs before any DB lookup) and other sensitive routes have their own limiters (`accountDeletionRateLimit.ts`, `bookingRateLimit.ts`, `routes/integrationsGoogle.ts:33`, `routes/leaderboard.ts:32`).
- **Why it matters here:** All login throttling is whatever's on in the Supabase dashboard. There is no application-level guard against a credential-stuffing bot that rotates emails, and no CAPTCHA requirement on login in the app code.
- **Fix:** (a) In the Supabase dashboard enable sign-in / sign-up rate limits and turn on CAPTCHA (hCaptcha or Turnstile); wire the token into `signInWithPassword({ options: { captchaToken } })`. (b) Optionally move login through Express so `authEmailLimiter` covers it uniformly (M).
- **Size:** S for the dashboard + 1 action edit; M for the Express route move.

### 9. User enumeration

- **Status:** safe (one minor timing side-channel in Supabase; one optional tightening on invite GET).
- **Evidence:**
  - Login: `apps/web/src/content/LoginContent/actions.ts:25` — returns `"Email or password is incorrect."` for every failure, including Zod rejects.
  - Signup: `apps/api/src/app.ts:210` — `res.status(400).json({ error: "Could not create account" })` for any Supabase failure, including "user already exists."
  - Rate limiter has an explicit enumeration-safety test at `apps/api/src/__tests__/authEmailRateLimit.test.ts:117` proving 429 is byte-identical for registered vs new email.
  - Signup success UI (`apps/web/src/content/SignupContent/SuccessScreen.tsx`) shows "Check your email" regardless.
  - `apps/web/src/app/auth/confirm/route.ts:13,23` — bad link and failed verifyOtp both redirect to `/login?notice=link-expired`; shape-identical.
  - Invite accept: `apps/api/src/routes/invites.ts:40` — unauthenticated GET returns `{ householdName, status }` where `status` discriminates between `not_found` / `already_used` / `revoked` / `expired` (`:61,108,111,114`). The token itself is sha256-hashed in DB and secret, so knowing the token is required to see the status — not an email-enumeration surface.
- **Why it matters here:** The visible surface is well-handled. The one residual is timing: Supabase's `signInWithPassword` runs bcrypt/argon2 when a user exists and returns quickly when not — a side channel we can't fix at this layer. Low practical exploitability through internet jitter.
- **Fix:** Nothing required. Optional S fix: collapse the invite GET response to `{ valid: true | false }` for the unauthenticated view and move `already_used`/`revoked`/`expired` discrimination into the authenticated accept endpoint.
- **Size:** — (optional S).

### 10. Account pre-hijacking

- **Status:** issue.
- **Evidence:** `apps/api/src/app.ts:196` — `supabase.auth.signUp({ email, password })` creates a Supabase user; Supabase's default behavior depends on the dashboard "Confirm email" toggle. `apps/api/src/middleware/requireUser.ts:24` verifies the token via `supabase.auth.getUser(token)` and looks up `profiles`, checking `profile.disabledAt` (`:51`) and `profile.ageAttestedAt` (`:63`). It **does not** check `email_confirmed_at` (nor the mirrored `profile.emailVerifiedAt`). `apps/api/src/db/schema.ts:141` — `email_verified_at` is mirrored onto `profiles` and only used by the booking-email sender to decide deliverability (`docs/plans/parent-booking-emails.md:180`).
- **Why it matters here:** If Supabase issues any session (e.g. "Confirm email" is off in the dashboard, or the attacker completes verification themselves), `requireUser` will let the request through. The profile + household + default policies are already created by the `on_auth_user_created` trigger regardless of verification, so an attacker pre-registering with a victim's email can: create swimmers, view household data, buy balance, book lessons. If the real owner later tries to sign up they get "email in use."
- **Fix:** (a) In the Supabase dashboard set **"Confirm email" ON**. (b) In `apps/api/src/middleware/requireUser.ts`, after `getUser`, require `data.user.email_confirmed_at` to be non-null and return 403 with a "verify your email" code otherwise.
- **Size:** S for the middleware change + dashboard toggle.

### 11. Reset / confirmation link host

- **Status:** safe.
- **Evidence:** `apps/api/src/app.ts:190-194` builds the redirect from `env.siteUrl`: `const confirmBase = ${env.siteUrl}/auth/confirm`, then `emailRedirectTo` combines that with an `isSafeReturnTo`-validated `returnTo`. `apps/api/src/lib/env.ts:54,185` — `SITE_URL` is required, must be a valid URL, and the env validator rejects localhost in `APP_ENV=dev|prod` at boot. `apps/web/src/app/auth/confirm/route.ts:28` — the server-side consume also validates `returnTo` through `isSafeReturnTo(returnToRaw, publicEnv.siteUrl)`. Grep for `req.headers.host` / `req.protocol` in `apps/` returns zero hits.
- **Why it matters here:** Host-header poisoning is a classic phishing escalator on password-reset flows. The app can't be tricked because no code path reads the request's host when building email redirects.
- **Fix:** None. Sanity: confirm `SITE_URL` (Railway) and `NEXT_PUBLIC_SITE_URL` (Vercel) point at the real prod domain.
- **Size:** —.

### 12. Weak secrets

- **Status:** issue (several missing min-length / shape validators).
- **Evidence:** From `apps/api/src/lib/env.ts`:

| Secret | Line | Validator | Status |
|---|---|---|---|
| `CRON_SECRET` | `:188` | `≥ 32 chars` on dev/prod | safe |
| `GOOGLE_OAUTH_STATE_SECRET` | `:308,:350` | `≥ 32 chars` on dev/prod | safe |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `:276,:343` | base64 decoding to exactly 32 bytes | safe (strong) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `:420,:437-443` | base64url charset only, no length | **issue** — a truncated key passes |
| `VAPID_SUBJECT` | `:423,:446` | `mailto:` / `https:` regex | safe |
| `STRIPE_SECRET_KEY` | `:249` | must start with `sk_`, no length check | needs manual check (Stripe keys are long by construction, low risk) |
| `STRIPE_WEBHOOK_SECRET` | `:254` | must start with `whsec_`, no length check | needs manual check |
| `SUPABASE_SERVICE_ROLE_KEY` | `:200` | non-empty only | **issue** — no length / JWT-shape check |
| `SUPABASE_PUBLISHABLE_KEY` | `:47` | `.min(1)` only | low risk (it's public) |
| `SUPABASE_URL` | `:46` | `.url()` | safe |
| `DATABASE_URL` | `:45` | `.min(1)` | low risk (Supabase-provided) |
| `RESEND_API_KEY` | `:398` | must start with `re_`, no length check | needs manual check |
| `EMAIL_FROM` | `:390` | RFC 5322 + prod-domain match | safe |

The API never reads `SUPABASE_JWT_SECRET` directly — token verification goes through `supabase.auth.getUser(token)` round-tripping to Supabase, so rotation/expiry are dashboard-only concerns.

- **Why it matters here:** Boot succeeds with a truncated or stub paste; the failure is deferred until first use (first push send, first service-role call during account deletion). Operationally that's a lost hour debugging what should be a boot-time rejection. The service-role key is the biggest risk — a weak or pasted-partial value boots cleanly and only breaks when `apps/api/src/services/accountDeletion/deletion.ts` tries to delete the auth user.
- **Fix:** In `apps/api/src/lib/env.ts`, add length / shape asserts: `.min(32)` or 43 / 87 char constants for VAPID keys (ECDH P-256 private key is 32 bytes = 43 chars base64url; public is 65 bytes = 87 chars); `.min(100)` or a JWT-shape regex (`^ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\..+$`) on the service-role key. Optional belt-and-suspenders `.min(32)` on Stripe and Resend keys.
- **Size:** S (handful of lines in one file).

---

## Requests and redirects

### 13. Open redirect

- **Status:** safe.
- **Evidence:** A single validator — `packages/shared/src/lib/isSafeReturnTo.ts:9-25` — rejects protocol-relative (`//`), backslash variants, `%5C`, control chars, newline injection, null-byte, and anything whose parsed `origin !== siteOrigin`. It has its own test suite at `packages/shared/src/__tests__/isSafeReturnTo.test.ts:16-36`. Every user-supplied redirect target is gated through it:
  - `apps/web/src/app/auth/confirm/route.ts:27`
  - `apps/web/src/content/SignupContent/actions.ts:15`
  - `apps/web/src/content/LoginContent/actions.ts:29`
  - `apps/web/src/content/PolicyUpdatedContent/PolicyUpdatedContent.tsx:43` (`safeNext = isSafeReturnTo(next, siteUrl) ? next : "/dashboard"`)
  - `apps/web/src/app/coach/swimmers/[id]/evaluate/page.tsx:91`
  - `apps/web/src/content/EvaluateContent/actions.ts:199`
  - `apps/api/src/app.ts:192` (`emailRedirectTo`)
  Stripe `success_url` / `cancel_url` at `apps/api/src/services/stripe/checkout.ts:47-48` are built from `input.siteUrl` + `body.successReturnTo`, where the Zod schema forbids schemes/hosts. `window.location.href = result.url` assignments in `BookCalendarContent:1333`, `AccountBalanceContent:300,505`, `InsufficientBalanceModal:259` consume the Stripe-returned Checkout session URL (originates from Stripe server-side, not from the browser).
- **Why it matters here:** Open redirects enable phishing landing-page swaps on the auth flow and OAuth token theft. The universal gate makes the failure mode visible — a future redirect that forgets `isSafeReturnTo` would stand out in review.
- **Fix:** None.
- **Size:** —.

### 14. Clickjacking / frame-ancestors

- **Status:** issue (web); safe (api).
- **Evidence:** `apps/api/src/app.ts:58` — `app.use(helmet())`; Helmet's defaults send `X-Frame-Options: SAMEORIGIN` and a CSP with `frame-ancestors 'self'` on API responses (but the API is JSON-only, so this mostly doesn't matter in practice). `apps/web/next.config.ts` has no `headers()`, no CSP, no `X-Frame-Options`. Grep for `Content-Security-Policy|frame-ancestors|X-Frame-Options` across `apps/web` returned zero matches. No `middleware.ts` injects security headers.
- **Why it matters here:** Without frame-ancestors, any attacker-controlled page can `<iframe>` `axiomaquatics.io` for UI-redress on authenticated pages — particularly dangerous on `/dashboard/book`, `/me/deletion`, and `/dashboard/balance` where a mis-click moves money or deletes an account.
- **Fix:** Add a `headers()` block in `next.config.ts` emitting at minimum `Content-Security-Policy: frame-ancestors 'none'` (or `'self'`) and `X-Frame-Options: DENY`. Co-land with the item 18 CSP for a single header configuration.
- **Size:** S (headers only) / M (full CSP — see item 18).

### 15. SSRF

- **Status:** safe.
- **Evidence:** `grep "fetch(" apps/api/src/routes` returns no matches. `apps/api/src/services/` only has gaxios / `google-auth-library` references at `googleCalendarClient.ts:169,353` and `googleCalendarSync.ts:62,483` — no raw user-URL `fetch`. `apps/api/src/routes/integrationsGoogle.ts:62` — `googleClient.getAuthorizeUrl(env.googleOAuth, state)` builds the URL from server env; the callback at `:72-77` reads `code` / `state` from a Zod-validated schema and redirects to a fixed `/account`. Stripe, Resend, Google Calendar outbound calls use their official SDK clients whose URLs are not user-controlled.
- **Why it matters here:** SSRF could reach Supabase admin, Stripe, or Railway metadata. None of that risk is present.
- **Fix:** None.
- **Size:** —.

### 16. Path traversal

- **Status:** safe.
- **Evidence:** Grep across `apps/` for `path.join|path.resolve|fs.readFile|fs.writeFile|fs.createReadStream`: all `path.join` / `path.resolve` calls are build/boot constants rooted at `__dirname` (`apps/web/next.config.ts:34`, `apps/web/vitest.config.ts:10,14`, `apps/api/src/db/migrate.ts:15`, `apps/api/src/db/predev.ts:42`). Every other `issue.path.join(".")` match is a Zod `issue.path` array join, not filesystem. No route handler reads a file whose path originates from `req.query`, `req.params`, or `req.body`.
- **Why it matters here:** Classic path-traversal requires user input flowing into `fs`. Absent.
- **Fix:** None.
- **Size:** —.

### 17. Subdomain takeover

- **Status:** needs manual check.
- **Evidence:** Domain inventory extracted from `docs/deployment.md:7-34,70` and `apps/api/src/__tests__/env.test.ts:31-55`. Hand this to DNS:

  - [ ] `axiomaquatics.io` (apex) — Vercel (prod web). Confirm A/ALIAS still points to Vercel.
  - [ ] `www.axiomaquatics.io` — Vercel (prod web).
  - [ ] `api.axiomaquatics.io` — Railway (prod API). Verify CNAME resolves to Railway and the TLS cert is live.
  - [ ] `dev.axiomaquatics.io` — Vercel (dev web).
  - [ ] `api-dev.axiomaquatics.io` — Railway (dev API).
  - [ ] `send.axiomaquatics.io` — Resend sender domain (SPF/DKIM/DMARC). **Highest-value target**: if the Resend domain is ever deleted without deleting the DNS records, an attacker can reclaim it and send DKIM-aligned mail as the business.
  - [ ] Apex MX — Google Workspace per `docs/deployment.md:7`. Keep intact.
  - [ ] No references to `axiomaquatics.com`, `axiom-aquatics.*`, or `*.vercel.app` / `*.up.railway.app` preview subdomains in code.
  - [ ] Supabase project domain (`<project>.supabase.co`) — Supabase-owned, no action.

- **Why it matters here:** A CNAME pointing at a no-longer-claimed Vercel / Railway / Resend tenant is the classic takeover vector. `send.axiomaquatics.io` is the highest-risk subdomain because mail from a reclaimed tenant is DKIM-aligned and trivially phishes staff + families.
- **Fix:** DNS audit by Hector; no code change.
- **Size:** S (walking the checklist).

### 18. Third-party scripts / CSP

- **Status:** issue (no CSP; small external surface makes adding one easy).
- **Evidence:**
  - `apps/web/src/app/layout.tsx:3` — `import { Fraunces, Figtree } from "next/font/google";`. `next/font/google` self-hosts the font files at build time (downloads into the `.next` bundle, serves same-origin). No runtime request to Google.
  - No `next/script` usage — only the `next/font/google` hit.
  - No Stripe.js in `apps/web/package.json`; checkout happens via a full-page navigation (`window.location.href = result.url` → `checkout.stripe.com`), not an embedded SDK.
  - `@supabase/supabase-js` calls `NEXT_PUBLIC_SUPABASE_URL` (`<project>.supabase.co`) directly from the browser.
  - External `https://…` references in `apps/web/src`: `instagram.com/swimcoach_jason` (`siteLinks.ts:10`), `venmo.com/u/Jason-Guzman-18` (`siteLinks.ts:16`), `www.google.com/maps/search/` (`LessonDetailContent.tsx:487`). All are plain navigation links. Every `target="_blank"` carries `rel="noopener noreferrer"` or `rel="noreferrer"` (e.g. `LessonDetailContent.tsx:171`).
  - No `dangerouslySetInnerHTML` outside tests.
  - No CSP: `grep "Content-Security-Policy"` across `apps/web` returned zero matches. The API's Helmet default CSP only covers JSON responses.
- **Why it matters here:** The browser's only runtime cross-origin destinations are `<project>.supabase.co`, `api(-dev)?.axiomaquatics.io`, and `checkout.stripe.com` (navigation only). A tight CSP would therefore be short and low-risk. Without it, any future dependency compromise that lands an inline exfil script runs to completion.
- **Fix:** Add a `headers()` block in `next.config.ts` with the CSP below plus `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Start in `Content-Security-Policy-Report-Only` for one deploy, promote after dev doesn't trip violations.

  ```
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';          /* Tailwind v4 injects runtime styles */
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' https://*.supabase.co https://api.axiomaquatics.io https://api-dev.axiomaquatics.io;
  frame-ancestors 'none';
  form-action 'self' https://checkout.stripe.com;
  base-uri 'self';
  object-src 'none';
  ```

- **Size:** M.
