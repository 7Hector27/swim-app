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

_(Pending.)_

## Phase 5 — Code quality

_(Pending.)_
