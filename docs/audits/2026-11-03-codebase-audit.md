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

_(Pending.)_

## Phase 3 — CLAUDE.md compliance sweep

_(Pending.)_

## Phase 4 — Launch essentials

_(Pending.)_

## Phase 5 — Code quality

_(Pending.)_
