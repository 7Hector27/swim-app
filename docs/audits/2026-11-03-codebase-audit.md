# Codebase audit — 2026-11-03

Branch: `chore/codebase-audit` (off `dev`).
Scope: read-only. No code changes.

Finding format: `**severity** — file:line — what — why — fix — effort`.
Severities: `bug` (wrong or silent behavior a user can hit today), `high`, `medium`, `low`.
Effort: S / M / L.

Already tracked elsewhere and skipped unless new info is found: separate test database, destructive-git hook, Dependabot critical vulns, branch protection, audit rows for season/availability changes, GitHub Actions versions and migrations connection timeout, amber warning token, CLAUDE.md consolidation, Node 20 deprecation warnings, parent account deletion, prod setup, Calendly switch-off, kids' data legal review, payments.

---

## Summary

_(Filled in after all phases.)_

### Counts by severity

_(Pending.)_

### Top 10 (impact / effort)

_(Pending.)_

### Verdict

_(Pending.)_

---

## Phase 1 — Silent failures in apps/api

Scope note. The email/notification outbox + sender stack (`services/emails/*`, `services/notifications/*`), the cron tick (`routes/internal.ts`), the Google Calendar reconcile (`services/googleCalendarSync.ts`), and `lib/lessonApproval.ts` are **well-engineered**: every async hand-off has a top-level catch that logs and finalizes to a terminal state, backoff is bounded, claim leases exist, supersede guards are explicit, and ADRs 028/030/031 document the invariants. No silent-failure findings there. Microtask fire-and-forget patterns (`queueMicrotask(() => { void syncLessonToGoogle(id) })` etc.) across `routes/lessons.ts`, `coachLessons.ts`, `coachBulkCancel.ts`, `internal.ts`) are safe because the inner functions each have a top-level catch.

### Findings

- **medium** — `apps/api/src/middleware/errorHandler.ts:9` — logs the whole `err` object (includes `.message` and `.stack`) — Postgres unique/FK-violation messages can echo back column values, and Supabase / web-push errors can echo recipient emails. `docs/accounts.md` forbids names, birth dates, emails, or notes in logs. Drain code already redacts (see `drain.ts` `errorName(err)` and `sender.ts` `redactEmails`); the catch-all handler doesn't. Fix: switch to `err.name` plus a `redactEmails`-passed message, truncated. Effort S.

- **medium** — `apps/api/src/routes/evaluations.ts:891-892` — `GolfScoreCategorySchema.safeParse(category); if (!parsedCategory.success) continue;` — iterating DB-sourced category keys; a value the Zod enum doesn't know about is silently dropped from the response so the parent/coach sees the skill with fewer categories than it has. Breaks on any catalog additions whose enum hasn't been bumped. Fix: log a warn with `swimmerId` + `category` so sync drift surfaces, or treat as 500 if invariant. Effort S.

- **medium** — `apps/api/src/index.ts:23` — `app.listen(env.port, cb)` has no `.on("error", …)` and no SIGTERM/SIGINT handler. A port conflict dies via Node's default handler with no structured log; Railway redeploys cut in-flight requests mid-write. Fix: attach `.on("error", …)` and wire a SIGTERM handler that closes the server + DB pool (see Phase 4). Effort S.

- **medium** — `apps/api/src/app.ts:78` — `express.json()` uses the default 100 kB limit with no explicit `limit:` setting and no error-shape hook; the 413 that fires surfaces as a 500 via `errorHandler`. Set `express.json({ limit: '64kb' })` (or whatever the biggest legitimate request is — batch POSTs are the ceiling) and emit a 413 cleanly. Effort S.

- **low** — `apps/api/src/app.ts:87-98` — `/health` always SELECTs `1` even for lightweight pings (a liveness probe doesn't need DB). Not a silent failure, but every Railway probe costs a round-trip; split `/health` (liveness) vs `/health?deep=1` (readiness w/ DB). Effort S.

- **low** — `apps/api/src/routes/swimmers.ts:201-215` and `apps/api/src/routes/lessons.ts:2157-2219` — `newSwimmer!.id`, `existingLesson!.status`, etc. — non-null assertions on values whose non-null-ness is only guaranteed by a check 20+ lines earlier. Not a bug today, but a future refactor that moves or removes the check will fail at the `!` with `TypeError: cannot read properties of undefined` surfacing as a 500 instead of a controlled branch. Replace with an early `if (!x) throw new Error(...)` narrow. Effort S.

- **low** — `apps/api/src/services/emails/drain.ts:118-124` — TODO about account-deletion clearing outbox rows is already tracked, but the comment points at `docs/accounts.md` — add a check-list wire so the parent-deletion branch can't ship without hitting it. Known issue; recording for the Top 10's dependency surface. Effort S (coordination).

Items that were considered and ruled out: the `.catch(() => {})` in `lib/lessonApproval.ts:20` is safe because the inner work IIFE already logged in its own catch (lines 46–54); the `return null` in `lib/env.ts:194`, `lib/oauthState.ts:113`, `services/googleCalendarClient.ts:370` are deliberate failure-signaling patterns and callers all handle the null; `rows[0]!` on `.returning()` is correct when an insert is unconditional. The `coachCalendar.ts:184` audit-outside-tx is an explicit ADR 027 deviation and documented in the comment.

## Phase 2 — Silent failures in apps/web

Scope note. Server actions (`content/*/actions.ts`) are consistently disciplined: every one checks `response.status === 401 → redirect("/api/signout")` and non-ok → `return { status: "error", message: ... }` with a toast-ready message. The PushSubscriptionManager handles permission, subscription, and test-send failures and surfaces each with a visible `role="alert"` message. The findings below are not about those code paths — they are about the data-loading layer.

### Findings

- **bug** — pattern across `apps/web/src/app/**/page.tsx` — server pages fail-soft on data-load errors. On `coach/swimmers/[id]/page.tsx:62-74`, `coach/swimmers/[id]/progress/page.tsx:48-61`, `dashboard/swimmers/[id]/page.tsx:34-75`, and others, every secondary fetch (`skillsResult`, `timelineResult`, `golfScoreTrendsResult`, `progressResult`, `scoreHistoryResult`, `swimsResult`, `evaluationsResult`, etc.) collapses to `[]` / `{}` / `{ ok: false }` when the API fails. The page then renders a UI that looks identical to the empty state. Coach opening a swimmer whose /sessions endpoint 500s today sees "No evaluations" and could enter conflicting new ones or conclude the record is lost. Fix: distinguish `{ ok: false }` all the way into the content component and render a reload CTA (or throw and let `error.tsx` catch). Effort M.

- **bug** — `apps/web/src/lib/api/clubs.ts:8,12-14`, `apps/web/src/lib/api/coachBooking.ts:22,33,54,65`, `apps/web/src/lib/api/coachAvailability.ts:66,89,106` — client fetch helpers collapse both `!response.ok` and `catch` into `return []` / `return null`, with no error logged and no distinguishing return shape. Add Swimmer page shows an empty club list, Coach Book Lesson shows no locations/households, Availability editor shows no seasons — in each case a transient API failure looks like "nothing exists yet." Fix: return a discriminated `{ ok: true; data } | { ok: false; reason }` and surface in the UI. Effort M.

- **high** — no `apps/web/src/app/global-error.tsx` — the existing `app/error.tsx` is the per-tree error boundary, not the root-layout fallback. An error thrown inside `app/layout.tsx` (ThemeProvider, nav, requireAuth cookie read) will render Next.js's default white error page with no branding and no recovery copy. Fix: add `global-error.tsx` wrapping `<html>/<body>` with the design-system shell. Effort S.

- **high** — no `not-found.tsx` anywhere in the tree. `notFound()` is called from six pages (`coach/lessons/[id]`, `coach/swimmers/[id]`, `dashboard/swimmers/[id]`, `coach/batches/[id]`, `coach/meets/[id]`, `dashboard/lessons/[id]`) and every one falls through to Next.js's default gray 404 — no logo, no nav, no "back to dashboard" link. A parent who taps a stale booking link lands on an unbranded page. Fix: `app/not-found.tsx` with the brand shell plus a return CTA. Effort S.

- **medium** — `apps/web/src/content/AccountContent/NotificationsSection/PushSubscriptionManager.tsx:62-68` — `refreshSubscriptions` only sets state on `result.ok` but always flips `loadingList` to `false`. If the initial fetch fails (API down, token expired silently), the UI renders "Notifications are off on this account. Tap … to enable this device." — identical to a legitimately unsubscribed account. Fix: add an error branch above the empty-state branch. Effort S.

- **medium** — no `apps/web/public/manifest.json`. The push copy at `PushSubscriptionManager.tsx:199-212` tells iPhone parents to "Add to Home Screen" — but without a manifest, iOS has no app icon or name to use, and iOS 16.4+ requires a manifest for web push to work at all from the home-screen app. Fix: ship a manifest with name, icons, start_url, display=standalone. Effort S.

- **medium** — `apps/web/src/app/error.tsx` is named with export `GlobalError` while actually being the per-route error.tsx — confusing for the next contributor and risks someone assuming root-layout errors are covered when they aren't. Rename the export to `RouteError` (or split into two files once `global-error.tsx` lands). Effort S.

- **medium** — no per-route `error.tsx` for `coach/*` or `dashboard/*`. A throw inside any nested page bubbles to `app/error.tsx`, which replaces the whole shell (sidebar, bottom nav) with the error screen and loses the parent's navigation context. Fix: add `dashboard/error.tsx` and `coach/error.tsx` that preserve the layout chrome. Effort S.

- **low** — `apps/web/src/content/EvaluateContent/actions.ts:107` — `deleteDraft` is fire-and-forget with `.catch(() => null)`; if the delete fails, the user's "Undo discard" flow silently fails. The retention cron eventually cleans up, but a parent viewing drafts could see a draft they thought they deleted. Fix: await, return `{ ok }`, show toast on failure. Effort S.

- **low** — `apps/web/src/lib/logout.ts:12` — `catch { /* ... */ }` on signOut is intentional (comment says so), but the client is left thinking logout succeeded when the server-side cookie may still be set. Not a bug if you always bounce through `/api/signout` on next protected load, but worth a request-ID-tagged log. Effort S.

Items considered and ruled out: the `.catch(() => null)` pattern on `response.json()` is correct (empty / 204 bodies). Server actions returning `status: "error"` surface to `useActionState` correctly across every form I sampled. The PushSubscriptionManager's permission / enable / test-send flows handle every failure with a visible `role="alert"` message.

## Phase 3 — CLAUDE.md compliance sweep

Clean against most rules — the enforcement is strong. Scorecard:

- **Audit log in same `db.transaction()`** — ✅ 20+ `tx.insert(householdAuditLog)` / `tx.insert(coachAuditLog)` sites all inside transactions. The one exception, `apps/api/src/routes/coachCalendar.ts:184`, is `db.insert(coachAuditLog)` outside a tx — but that is a documented ADR 027 deviation with an explicit comment (lines 177–183). Not a violation.
- **Append-only ratings and balance ledger** — ✅ Everywhere `skillRatings` is written, reads use `isNull(voidedAt) && isNull(supersededAt)`; supersedes-chain fields are respected. No `UPDATE skill_ratings` statements found outside the explicit void/supersede paths.
- **"use server" files export only async functions** — ✅ All 22 `content/*/actions.ts` begin with `"use server";` and every top-level `export` is `async function`. Zero non-function exports (grepped `^export\s+(?!async\s+function)` and got no hits).
- **Client components never import `@/lib/env`** — ✅ The nine `@/lib/env` imports are all in server files (layout, account/page, auth/confirm/route, evaluate/page, and five server-action files). Zero hits in `"use client"` files.
- **Design tokens only, no hex / no Tailwind default palette** — ✅ The only hex values are in `apps/web/src/styles/tokens.css`. Zero hits on `gray-500`, `red-500`, etc. in components.
- **No Python** — ✅ `find . -name "*.py"` returns nothing.
- **Server→client props plain data** — ✅ Spot-checked `dashboard/page.tsx`, `coach/swimmers/[id]/page.tsx`, `coach/lessons/[id]/page.tsx`; no `Date`, `function`, or class-instance props pass across the RSC boundary. Dates are serialized via `.toISOString()`.

### Findings

- **medium** — single-letter callback parameters, pervasive — CLAUDE.md states "Never abbreviate or use single-letter names, including callback parameters." 115 matches across 30 files covering `.map((s) => …)`, `.filter((p) => …)`, `.find((c) => …)`, `.sort((a, b) => …)`, `onChange={(e) => …}`. Highest-signal production files: `apps/api/src/lib/slots.ts:128,163,279`, `apps/api/src/lib/leaderboard.ts:91,127`, `apps/api/src/lib/coachBookingWarnings.ts` (5), `apps/api/src/services/emails/sender.ts` (4), `apps/web/src/content/CoachAvailabilityContent/CoachAvailabilityContent.tsx` (8 hits), `apps/web/src/content/BookCalendarContent/BookCalendarContent.tsx:396,995`, `apps/web/src/content/CoachBulkCancelContent/CoachBulkCancelContent.tsx:595`, `apps/web/src/content/CoachDashboardContent/BookingRequestsCard.tsx:114`, `apps/web/src/content/CoachMeetsContent/CoachMeetsContent.tsx:87,102,116` (`(e) =>` on inputs), `apps/web/src/content/LoginContent/LoginContent.tsx:52`. Tests (`__tests__/`) account for another ~70 hits; CLAUDE.md doesn't exempt tests. Fix: add an ESLint rule forbidding single-letter callback args, or codemod + review. Effort M (lots of mechanical renames, the lint rule is the one-time cost). Low priority individually but real as a convention gap.

- **low** — `apps/api/src/routes/coachCalendar.ts:184` audit-log outside transaction is documented as an ADR 027 exception, but the rule's intent ("audit row absence is recoverable only because `retry-failed` flows the sync-outcome state into the lesson rows themselves") lives in a single comment. Suggest moving the exemption into `CLAUDE.md` so it survives a refactor that doesn't read `coachCalendar.ts:177-183`. Effort S.

Items considered and ruled out: no cross-boundary `Date` props detected; no non-async exports from `actions.ts`; no `console.*` in `apps/api/src` (CLAUDE.md's "never use console in apps/api" rule). No manually declared types in `packages/shared` outside `z.infer<>` (spot-checked a sample).

## Phase 4 — Launch essentials

Matrix of what's present / partial / missing. Findings for the gaps follow.

| Area | State | Note |
|---|---|---|
| Health endpoint | **present** | `GET /health` with DB probe, 503 on failure (`app.ts:84-99`). |
| Structured logging + request IDs | **present** | `requestId` middleware + `pino-http`; `x-request-id` header is read or minted and echoed back (`middleware/requestId.ts`). |
| Env validation at startup | **present** | `getEnv()` + `validateVapidAtStartup()` called in `index.ts:5-16`; fail-boot on invalid config. |
| Security headers | **present** | `helmet()` default (`app.ts:49`). |
| CORS | **present** | env-driven allowlist; dev fallback with warn log (`app.ts:55-67`). |
| Outbox idempotency | **present** | Resend Idempotency-Key = outbox row id; `FOR UPDATE SKIP LOCKED` claim; supersede guard (ADR 028). |
| Outbox retry/backoff with dead-letter | **present** | Exponential backoff capped at 30 min; `abandoned` terminal state after 7 days (`drain.ts`). |
| Rate limiting | **partial** | Only `/integrations/google/*` (60/min, `integrationsGoogle.ts:33`) and `/leaderboard` (60/min). `POST /auth/signup`, auth endpoints, `/lessons` booking, `/invites/[token]` have none. |
| Error monitoring (Sentry/equivalent) | **missing** | No Sentry/Rollbar/Datadog. Pino logs are structured but there's no error aggregator; a `uncaughtException` would land in Railway logs only. |
| Graceful shutdown | **missing** | No `SIGTERM`/`SIGINT` handler; `index.ts:23` just calls `app.listen`. Rolling deploys cut in-flight requests. |
| DB pool settings | **missing** | `db/client.ts:6` constructs `postgres(url)` with no `{ max, idle_timeout, connect_timeout }`. Uses postgres-js defaults (max=10, idle_timeout=0). |
| Outbound call timeouts | **missing** | No `AbortController` / `AbortSignal` around Resend or Google Calendar calls. If Resend or Google hangs, claim lease (2 min) expires and the row re-enters drain, but a request-path call (e.g. the OAuth callback) can hang for the underlying SDK's default. |
| Cron overlap protection | **partial** | Drain uses `FOR UPDATE SKIP LOCKED`, so parallel drains are safe. But `enqueueExpiringRequestReminders` and `composeDailyCoachSummary` depend on unique indexes for idempotency (no advisory lock). Documented in comments; works, but implicit. |
| PII in logs | **partial** | Drains + senders use `errorName`/`redactEmails` (good); global `errorHandler` logs full `err` object (Phase 1 finding). |
| Authz on all routes | **present** | Every router mounts `requireUser` + role middleware (spot-check `coach.ts`, `households.ts`, `lessons.ts`); the only public route, `/leaderboard`, is intentional and rate-limited; `/integrations/google/callback` is state-token-bound. |
| Pagination | **partial** | Evaluations list uses cursor pagination. Lessons / swims / meets / batches list endpoints apply `.limit(50)` or similar internal caps but don't expose `cursor`/`nextCursor` to clients — fine for Jason's current volume, won't scale. |
| Timezone | **present** | `America/Los_Angeles` hardcoded, noted in ADR 027 with "TODO: per-coach timezone if we ever expand beyond LA" — correct for Irvine. |
| Accessibility on booking + evaluate | **present** | BookCalendarContent has 49 `role=`/`aria-*` hits across 8 files; evaluate page has `role="alert"` on errors, descriptive labels, keyboard-reachable grading UI. Spot-check only; not a full audit. |
| Backups | **external** | Supabase handles DB backups on their side (depends on plan tier). Not visible in repo. |
| Migration safety | **present** | drizzle-kit snapshot files guard against drift (CLAUDE.md "never write migrations by hand"); prod migrations are manual per CLAUDE.md. |
| PWA manifest | **missing** | See Phase 2. Blocks iOS add-to-home-screen push. |
| `global-error.tsx` / `not-found.tsx` | **missing** | See Phase 2. |

### Findings

- **high** — `apps/api/src/index.ts:23` — no graceful shutdown. On `SIGTERM` (Railway deploy) the process exits immediately; in-flight requests get cut and the Postgres pool doesn't close cleanly (pending transactions leak until connection timeout). Fix: wrap `const server = app.listen(...)`, add `process.on("SIGTERM", async () => { server.close(); await pool.end(); process.exit(0); })`, and expose `pool` from `db/client.ts`. Effort S.

- **high** — `apps/api/src/db/client.ts:6` — `postgres(databaseUrl)` with no pool config. Default `max=10` is fine for a single coach + ~50 parent accounts but the real issue is `idle_timeout=0` (connections never close), which strains Supabase's connection cap under restart churn; and no `connect_timeout`, so a transient DB outage hangs every request until Node's default. Fix: pass `{ max: 10, idle_timeout: 30, connect_timeout: 10 }`. Effort S.

- **high** — no rate limit on `POST /auth/signup` or on `POST /lessons*` booking routes. A single IP can create signups or spam booking requests until Supabase throttles. Fix: add an `express-rate-limit` policy (e.g. 10 signups/hour per IP, 60 booking submits/hour per household); the package is already installed. Effort S.

- **high** — no error monitoring hook. A silent bug in a deployed route (e.g. a 500 hitting the global `errorHandler`) lands in Railway logs with no page, aggregation, or release correlation. Fix: add Sentry (`@sentry/node` on API, `@sentry/nextjs` on web), attach as a pino transport, call `Sentry.captureException(err)` from `errorHandler` and from each sender's top-level catch. Effort M.

- **medium** — `apps/api/src/services/emails/transport.ts` and `services/googleCalendarClient.ts` — no explicit timeout on outbound calls. Resend's SDK has a default (~30s), but the Google OAuth SDK does not expose one and will hang on a stuck TCP. Fix: wrap each call in `Promise.race` against a 10s `AbortSignal.timeout(10_000)`; map the timeout to the appropriate `TransportError` kind. Effort S.

- **medium** — advisory locks for cron ticks are implicit. Two overlapping ticks (Railway deploy mid-cron) could both run `enqueueExpiringRequestReminders` and rely on the unique index to drop duplicates. Works, but a misbuilt migration could remove the invariant silently. Fix: add `pg_try_advisory_lock(hashtext('cron/tick'))` at the top of the handler and bail with 409 if taken. Effort S.

- **medium** — pagination surface. `GET /lessons/upcoming`, `GET /coach/swimmers/:id/sessions`, `GET /meets/:id/swims` all return the full list. Fine for Jason (< a few hundred per request today), degrades on year-one data. Fix: add Zod `limit`/`cursor` params to the schemas, mirroring the pattern in `routes/evaluations.ts:683-711`. Effort M.

- **low** — no readiness/liveness split. `/health` always probes DB. Railway/k8s typically want a cheap liveness probe. See Phase 1 note. Effort S.

Items considered and ruled out: TLS, Supabase RLS setup, and Supabase backups all live outside this repo (Railway/Supabase dashboard config); they're worth a one-page runbook but aren't code findings. Trusted-proxy config is wired through `TRUST_PROXY` env (`app.ts:47`). CSP is not set beyond helmet's default, which is acceptable for a Next.js app on a verified sending domain.

## Phase 5 — Code quality

Overall shape is healthy. Test suite is substantial: 161 test files, 30 integration tests, strong coverage on booking (`lessons.integration`, `parentBatchBooking`, `coachBooking`), availability (`coachAvailability` + `rangeAvailability`), evaluations (`evaluations.integration` + `editSession`), outbox (`parentBookingEmails.integration`), coach alerts (`coachAlerts.integration`), and Google Calendar sync (`coachGoogleCalendarSync.integration`). Only 4 TODOs in the entire monorepo — unusually clean.

### Findings

- **medium** — file size outliers. Several files are well over 300 lines of orchestration code that mixes concerns:
  - `apps/web/src/content/BookCalendarContent/BookCalendarContent.tsx:2170` — parent booking calendar; single `"use client"` orchestrator holding slot picking, batch picks, recurring mode, bottom bar wiring, review sheet state, prefetch, and more. Split by concern (one file per mode, lift state into a reducer).
  - `apps/api/src/routes/lessons.ts:2382` — one router file with the full parent lesson surface. Break into `routes/lessons/book.ts`, `reschedule.ts`, `cancel.ts`, etc., keeping the mounted path.
  - `apps/api/src/routes/coachLessons.ts:1814`, `apps/api/src/routes/evaluations.ts:1860`, `apps/api/src/routes/coachAvailability.ts:1236` — same pattern.
  - `apps/api/src/services/emails/sender.ts:1210` — holds four sender paths (lesson, batch, coach booking backup, bulk cancel). Each is self-contained; splitting into `sender/lesson.ts`, `sender/batch.ts`, etc. cuts the cognitive cost of a one-line fix. Effort M per file; individually none are a bug.

- **medium** — `formatLessonTime` is implemented four times.
  - `apps/web/src/content/SwimmerProfileContent/helpers.ts:46 formatLessonTime`
  - `apps/web/src/content/CoachBookLessonContent/helpers.ts:84 formatLessonTimeDisplay`
  - `apps/web/src/content/CoachRescheduleContent/CoachRescheduleContent.tsx:69 formatLessonTimeRange`
  - `apps/api/src/services/emails/format.ts formatLessonTimeDisplay`
  These compute similar strings against `America/Los_Angeles`. Drift is likely — a locale or format tweak won't land everywhere. Fix: consolidate into `packages/shared/src/formatLessonTime.ts` and re-export; API `services/emails/format.ts` can wrap it to preserve its comment about `formatToParts` quirks. Effort S.

- **medium** — `"America/Los_Angeles"` appears in 112 lines across 66 files. Every date-format call hardcodes the zone, so the TODO in `googleCalendarSync.ts:28` ("per-coach timezone if we ever expand beyond LA") is a 66-file refactor the next time it comes up. Fix: a single exported constant in `packages/shared/src/time.ts` (e.g. `LESSON_TIMEZONE`) imported everywhere. Effort S (codemod).

- **low** — no explicit test for the cron tick orchestrator (`routes/internal.ts` POST `/cron/tick`). The constituent passes (`drainLessonEmailOutbox`, `releaseHeldCoachNotifications`, `scrubLessonEmailPayloads`, etc.) are each covered through integration tests, but there's no test that asserts the handler composes them in the right order or that one failing pass doesn't abort the others (the per-pass try/catch pattern is load-bearing). Fix: one integration test hitting `/internal/cron/tick` with mock failures injected into two passes. Effort S.

- **low** — no concurrent-cron test. `routes/internal.ts:170-234` has five back-to-back `try { await …() }` blocks; the comment on `drain.ts` claims FOR UPDATE SKIP LOCKED makes two overlapping ticks safe, but there's no test asserting that. Fix: a single integration test that fires `/cron/tick` twice via `Promise.all` and asserts no duplicate `sent` rows. Effort S.

- **low** — `apps/web/src/content/HomepageContent/LeaderboardSection.tsx:20` TODO "replace with real API data (filter by public_profile = true)" — the homepage leaderboard is still hardcoded/stubbed. Noted here because it's parent-facing. Effort S once the data exists.

- **low** — four TODOs total, all contextualised. Not a problem; recording for completeness: `services/googleCalendarSync.ts:28`, `services/googleCalendarClient.ts:24`, `services/emails/drain.ts:118`, `web/content/HomepageContent/LeaderboardSection.tsx:20`.

Items considered and ruled out: No unused dependencies spotted in `apps/api/package.json` or `apps/web/package.json` (every import has a matched usage: `nodemailer` for Mailpit in local, `express-rate-limit` on `/integrations/google` and `/leaderboard`, `web-push` on push transport, `@googleapis/calendar` + `google-auth-library` on calendar client). No stale `.old`, `.backup`, or `_deprecated` files. No commented-out blocks of code of concern. Old-vs-new pattern drift: Phase 0/1 code and Phase 2 code appear consistent — same `requireUser` + `validate(…)` middleware chain, same outbox shape pattern reused for coach alerts.
