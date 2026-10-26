# Plan: Recurring lessons and multi-lesson batch booking

**Status:** **Shelved.** Superseded by [docs/plans/batch-booking.md](./batch-booking.md) and [ADR 030 — Parent multi-lesson batch booking](../decisions/030-parent-batch-booking.md). "Weekly repeat for N weeks" ships as a batch mode, not as a continuous `lesson_series` rule — no cron extension, no `generated_through_date`, no this-and-future, nothing beyond the booking window. Keep this file for reference if a true open-ended series rule is ever needed.
**Replaces:** The "PR 9 — Recurring lessons (TBD)" stub in `docs/plans/phase-2-booking.md`.

---

## Context

The original PR 9 stub predates the three ADRs that have landed since:

- **ADR 027 — Google Calendar sync.** Every lesson-change path funnels through `syncLessonToGoogle(lessonId)`, idempotent on the lesson's current state. Approved and completed lessons exist on the coach's calendar; cancels/declines/expires remove them. The sync hook fires after `res.json()` via `queueMicrotask`, isolated from the booking transaction.
- **ADR 028 — Parent booking emails.** Every lesson-state change writes exactly one `lesson_email_outbox` row inside the same `db.transaction()` as the state change. Confirmed and rescheduled rows attach an `.ics` with `METHOD:REQUEST` and a monotonic `SEQUENCE` snapshotted from `lessons.calendar_sequence`. Cancels/declines/expires-after-approval attach `METHOD:CANCEL`. A claim-before-send protocol and Resend's `Idempotency-Key` close the duplicate-send window. The sender runs post-commit as a microtask and is drained again by `cron/tick`.
- **ADR 029 — Coach booking on behalf of a family.** `POST /coach/lessons` writes an approved lesson in one transaction with its audit row and outbox row. Overlap with another lesson is a hard reject; teaching-hours / travel-buffer / daily-cap / blocked-time / max-advance are server-computed warnings the coach can acknowledge. **The 16-hour notice window does not apply to the coach** (`coachBypassNotice=true` on the slot picker, `skipMinAdvance=true` on reschedule rechecks).

The old stub proposed `recurrence_groups` plus a nullable `recurrence_group_id` on `lessons`. The direction is right; the shape needs an update to fit the three ADRs:

- Series approval cannot be a side effect of generated rows (it needs the series-level audit row, series-level email, series-level trust decision).
- `.ics` has to use the per-lesson UID that ADR 028 already enforces (`${lesson.id}@axiomaquatics.io`) so per-occurrence reschedules and cancels keep working; a single UID for the series is not an option.
- The generation window has to respect `bookingMaxAdvanceWeeks` and be extended by the existing `POST /internal/cron/tick`, not by a parallel scheduler.
- The coach path has to inherit ADR 029's no-notice rule and server-computed-warning model.

This plan supersedes the PR 9 stub. The stub is reduced to a pointer at the end of this document's rollout.

---

## Scope

**In — recurring lessons (Part 1):**
- A `lesson_series` row describing the recurrence rule (location, swimmer set, weekday or weekdays, time-of-day, duration, series start/end, series type).
- A `lessons.series_id` nullable FK linking generated rows back to the series.
- Pre-booking conflict preview covering every candidate occurrence in the submitted range.
- Series-level approval that applies to all currently-generated rows plus any rows the cron adds later from the same series.
- One series-level confirmation email with a multi-event `.ics` (one `VEVENT` per currently-generated occurrence, each carrying its own per-lesson UID).
- Per-occurrence reschedule / cancel on existing lesson routes (no series API involvement; one email per changed occurrence).
- This-and-future reschedule / cancel on a new series API (updates the rule and the already-generated rows at or after a date).
- Cron-driven generation window extension: as time advances, the cron tick generates new occurrences for active series up to `now + bookingMaxAdvanceWeeks`.

**In — multi-lesson batch booking (Part 2):**
- One submission that writes N independent lesson rows in a single transaction.
- Shared slot preview across all picked slots.
- No series row, no rule. Each lesson is standalone from the moment it is written.

**Out of this plan:**
- Monthly / N-th-weekday / "every other week" recurrence. First release is weekly only (Jason to confirm — see open questions).
- Across-the-summer-split series. First release treats the school-year ↔ summer transition as a hard series boundary.
- Package pricing specific to series. Series inherits ADR 029's and the balance-events plan's pricing rules unchanged.
- Automatic reschedule-around-blocked-time ("if a holiday falls on your Tuesday, Jason picks a replacement day"). The parent or coach reschedules manually.
- Any RRULE-based `.ics` (we ship multi-`VEVENT` instead; see the ics subsection).

---

## Open questions (Jason, please)

Ordered. Everything downstream depends on **Q1**.

**Q1. Who can create a lesson series — parents, Jason, or both?**
Three options, each with implications:
- *Parents only.* Simplest UI story. The series is a "please run this every week" request; Jason approves it once at the series level, same approval ergonomics as a single-lesson request. Coach-created series endpoint not needed.
- *Jason only.* Easier for the first release — Jason uses `/coach/book` with a weekday toggle. All series are coach-booked, inherit the no-notice rule, auto-approve, and bypass the warning acknowledgement for the whole run (one warning set per occurrence? or series-wide?). No parent-facing series flow in v1.
- *Both.* Design handles both paths. Parent-created series goes through pending → approved at the series level; coach-created series is approved on write. Twice the UI surface. Possibly the right end state, but a bigger first release.

**Q2. What recurrence shapes are supported in v1?**
Weekly on one weekday is the baseline. Options to confirm or defer:
- Weekly on multiple weekdays (e.g., Tue + Thu at 4:30 PM): yes/no for v1?
- Every-other-week: yes/no for v1?
- "Every weekday for two weeks" (school break mode): yes/no — this blurs the line between a series and a batch (Part 2).

**Q3. How is the end of the series defined?**
Three mutually exclusive options:
- *Fixed end date.* "Through June 10."
- *Occurrence count.* "10 lessons."
- *Open-ended.* Rolls forward with the cron until the parent / coach stops it.

**Q4. What should happen when a generated occurrence falls on a blocked time, outside teaching hours, or in a future season gap?**
- *Skip silently.* Omit that occurrence; parent sees a flag in the app and the series email lists skipped dates.
- *Prompt the parent to pick a replacement.* Breaks the "generate ahead" model; introduces a pending-replacement state.
- *Reject the whole series submission.* Only applies at submission time; the cron-extension case still needs an answer.

**Q5. If a specific occurrence is rescheduled (per-occurrence change), does the series rule still "own" it?**
- *Detach.* The row sets `series_id = null` and future rule changes don't touch it.
- *Keep linked.* Future this-and-future changes also move the already-moved row; its `starts_at` drifts in sync with the rule.
We lean toward *detach*: rescheduling a single occurrence is an exception, and letting a this-and-future rule change silently un-reschedule it is surprising.

**Q6. Does the whole series approval decision survive a reschedule to a different location?**
If the series was approved at Pool A but a parent reschedules one occurrence to Pool B where they have no trust, does that occurrence revert to pending (per the existing single-lesson rule in ADR 021 and the parent-booking-emails plan's row 4 reschedule rules)? Default: yes, apply the same rule — the series approval is pool-scoped like all approvals.

**Q7. Price lock on generated occurrences — at generation time, at completion time, or at series approval time?**
Current single-lesson rule is "price in effect when Jason marks the lesson complete." Series inheriting that rule means a parent is quoted a price when they book, but the final total can drift if Jason raises rates mid-series. Options:
- Keep the single-lesson rule (price at completion).
- Lock price at series creation on all generated and future-generated occurrences.
- Lock price at series approval (same effect as creation for coach-created / auto-approved series).

**Q8. Multi-lesson batch (Part 2): coach power-user only, or available to parents?**
If parents can submit a batch (e.g., "book these three dates I just picked on the calendar"), the UX is close to the series flow but without the rule. If it's coach-only, Part 2 is a short add to `/coach/book`.

**Q9. On series approval, do manager and viewer accounts receive the series confirmation email?**
Today's single-lesson confirm email goes to owner + manager (viewers never). The series email follows the same rule unless Jason wants different behavior.

**Q10. Should the cron that extends the generation window send a quiet "N more occurrences scheduled" email when a batch rolls into the window?**
Default: no — the original series email already said "weekly through <date>." Rolling the window forward is background bookkeeping. Flag so Jason can veto if he wants parents informed.

**Q11. If Jason is the one creating a series on behalf of a family, do the per-occurrence warnings (outsideHours, dailyCapExceeded, etc.) acknowledge once at the series level, or once per occurrence that fires them?**
Depends on Q1 but worth answering independently.

**Q12. Can a series straddle summer start (June 1) or ISL Championships end?**
Default per Scope above: no — the season boundary is a hard series end. If Jason wants series to be season-aware, that's a larger design change (two rules per series, one per season).

---

## Decisions already fixed (not open)

These flow from the three ADRs and are not re-litigated here:

- Each generated occurrence is a full `lessons` row. The series row is a rule, not a copy.
- Each generated occurrence has its own per-lesson `.ics` UID (`${lesson.id}@axiomaquatics.io`) and its own `calendar_sequence`. Per-occurrence reschedules / cancels keep working through the existing outbox events (`lesson_rescheduled`, `lesson_canceled`) and the existing `SEQUENCE:N` increment.
- Trust is pool-scoped per ADR 021. `needsApproval(householdId, locationId)` is run once at series creation; subsequently-generated rows inherit the series's approval status, see "Approval model" below.
- Google Calendar sync is per-occurrence. `syncLessonToGoogle(id)` fires once per generated row via `queueMicrotask` after the series transaction commits. No new sync surface. ADR 027's "approved or completed → event exists" rule is unchanged.
- The parent 16-hour notice applies to parent-created series submission; coach-created series submission uses `coachBypassNotice=true` on the slot engine per ADR 029. No new flag.
- Overlap with any pending/approved lesson at any pool, for any occurrence, is a hard reject. The series submit must either resolve those conflicts (skip, pick a different time) or fail. Not acknowledgeable, same rule as ADR 029.
- Audit log rule: the series create, series approve, series this-and-future reschedule, series this-and-future cancel, and any coach-override on series submission each write a `household_audit_log` row inside the same transaction as the data change. (Same rule as single-lesson paths; see ADR 029's audit entry for the shape.)

---

## Part 1 — Recurring lessons

### Shape

A `lesson_series` row is the authoritative rule. It carries:
- Household, swimmer set, location, duration, type (`private` or `family`).
- Recurrence rule: start weekday(s), local start time, start date, end date (or null / count, per Q3).
- Series lifecycle status: `pending`, `approved`, `canceled` (series-level cancel = cancel the rule and all future-dated unlanded occurrences).
- Approval provenance: `requested_by`, `approved_by` (coach for coach-approved; `null` for system-trust auto-approval; coach for coach-created series per ADR 029 semantics).
- `generated_through_date` — the LA date up to which the cron has materialized `lessons` rows for this series. Advances as the cron extends.
- Timestamps and audit metadata.

A `lessons.series_id uuid NULL FK → lesson_series.id` links each generated row to its series. Nullable because single-lesson bookings (both parent and coach) do not populate it, and because a per-occurrence reschedule may detach the row from the rule (Q5).

### Series lifecycle

1. **Submit a preview.** Client sends the proposed rule and the submission mode (parent vs. coach) to the preview endpoint. Server computes every candidate occurrence in `[seriesStart, min(seriesEnd, now + bookingMaxAdvanceWeeks)]` and returns a per-occurrence slot state (see "Conflict preview" below). No DB writes. No lock. Cheap, re-runnable.
2. **Submit the series.** Client sends the rule plus `acknowledgedSkips` (dates the user has agreed to drop) and, for coach submissions, `overrideWindow` and `acknowledgedWarnings` per ADR 029. Server:
   - Acquires the LA-day advisory lock for each occurrence day in the first-generated batch (or a series-level lock — see "Locking" below).
   - Re-runs the slot engine for each occurrence under the lock. Any newly-conflicting occurrence outside `acknowledgedSkips` fails the whole submission.
   - Resolves `needsApproval(householdId, locationId)` once for the series.
   - Writes `lesson_series`, N `lessons` rows (for occurrences inside the current window and not in `acknowledgedSkips`), N `lesson_swimmers` rows, one `household_audit_log` row for `lesson_series_created`, and either zero or one outbox row (depending on approval path — see "Series email" below). Everything inside one transaction.
   - After `res.json()`, schedules one `syncLessonToGoogle` microtask per generated row (ADR 027 pattern applied N times).
3. **Approval (if needed).** If `needsApproval` was true at submit time and the submitter is not the coach (per Q1), the series is created in `status='pending'`, with every generated lesson row also in `status='pending'`. The coach approves at the series level via `PATCH /coach/lessons/series/:id/approve`, which in one transaction: flips the series to `approved`; flips every generated `pending` row to `approved` with `approved_by = <coach>`, `approved_at = now()`, `expires_at = null`; writes a `lesson_series_approved` audit row; writes **one** `lesson_series_confirmed` outbox row carrying all currently-generated occurrence payloads; sets `calendar_invite_sent_at = now()` on each lesson. Post-commit microtasks fire `syncLessonToGoogle` per row.
4. **Runtime.** As time passes:
   - The cron tick extends the generation window (see below).
   - Per-occurrence changes (reschedule, cancel, no-show, completion) go through the existing single-lesson routes and emit per-occurrence outbox rows exactly as today.
   - This-and-future changes go through series routes and emit per-occurrence rows for every affected generated lesson (not a single series-level email — see "Why not one email for this-and-future").
5. **Series end.** When the rule's `end_date` is reached or an occurrence count is exhausted or the series is canceled, the series row transitions to a terminal state. Historical lessons are untouched.

### Conflict preview

`POST /lessons/series/preview` (parent) and `POST /coach/lessons/series/preview` (coach, if Q1 includes coach-created). Request body carries the rule and (for coach) `coachBypassNotice=true` is implied. Response is an ordered list:

```ts
type SeriesPreviewOccurrence = {
  date: string;                     // yyyy-MM-dd LA date
  startsAt: string;                 // ISO
  state:
    | "available"
    | "unavailable"                 // another pending/approved lesson overlaps
    | "too_soon"                    // inside bookingMinAdvanceHours (parents only)
    | "past"                        // startsAt < now
    | "not_open_yet"                // beyond bookingMaxAdvanceWeeks — deferred to the cron
    | "outside_teaching_hours"      // coach-only warning that fires per-occurrence
    | "blocked_time"
    | "day_closed";
  // When the state is `available`, this field is omitted.
  reason?: string;                  // short code for client i18n
};

type SeriesPreviewResponse = {
  needsApproval: boolean;           // once per request, same as the range endpoint
  occurrences: SeriesPreviewOccurrence[];
};
```

Rules:
- The preview covers only occurrences inside `[seriesStart, now + bookingMaxAdvanceWeeks]`. Occurrences in `[now + bookingMaxAdvanceWeeks, seriesEnd]` surface as `not_open_yet` with a count so the UI can tell the parent "N more will land as the window advances." They are not detailed per occurrence; the cron is where they land.
- The preview is a pure read. No lock, no row writes. The parent / coach uses it to shape the submission.
- The submit endpoint re-runs the same slot computation under the day lock. The preview can disagree with the submit under a race (another lesson lands between preview and submit); the submit's recomputation wins.

### Approval model

- One call to `needsApproval(householdId, locationId)` at submit time.
- `needsApproval = false` → series created `status='approved'`, every generated row `status='approved'` with `approved_by = null` (system trust) and `approved_at = now()`. Series confirmation email emitted at submit time (one email, multi-event `.ics`).
- `needsApproval = true` and submitter is a parent → series `status='pending'`, every generated row `status='pending'`, standard `expires_at = starts_at − 16h` on every row (same as single-lesson pending). A `lesson_series_requested` outbox row goes to the parent (no `.ics`, by analogy with `booking_requested`). The coach gets a request to approve at the series level.
- `needsApproval = true` and submitter is the coach → series `status='approved'`, same as `needsApproval = false`. Series confirmation emitted immediately. The coach's booking is itself the approval, per ADR 029.
- After coach approval of a parent-submitted series, every generated row flips to approved under one `lesson_series_confirmed` outbox row. New rows added later by the cron inherit the series's approved status.
- First-time trust: the family inherits trust at that pool after the series is approved — subsequent single-lesson bookings at the same pool auto-approve under ADR 021 unchanged (`needsApproval` reads the lesson table and the series's rows are regular lessons).

### Generation and the booking window

- At submit, the server generates `lessons` rows for every occurrence in `[seriesStart, now + bookingMaxAdvanceWeeks]` that is not `not_open_yet`, `past`, or in `acknowledgedSkips`. `generated_through_date` is set to the latest LA date that was materialized.
- The cron tick extends the window. On every tick, for each series where `status IN ('approved')` and `generated_through_date < min(seriesEnd, today + bookingMaxAdvanceWeeks)`:
  - Compute the next batch of candidate occurrence dates up to the new window edge.
  - For each candidate, run the slot engine with the series's rule parameters.
  - For candidates that resolve `available`: insert a `lessons` row with `status='approved'`, `approved_by = <series.approved_by>`, `approved_at = series.approved_at`, `calendar_sequence = 0`, `series_id = <series.id>`, `requested_by = <series.requested_by>`.
  - For candidates that resolve to anything else: record a skip under the series (new table `lesson_series_skips` with `(series_id, date, reason)`) and move on.
  - Advance `generated_through_date` to the batch edge.
- Each successfully-inserted row gets a `syncLessonToGoogle` microtask after the transaction commits.
- **No cron-generated email** by default (see Q10). The series's confirmation email, sent at approval time, already announced the recurrence rule. Skips surface in the app and in the audit log but not in the inbox.

The cron pass is written in the same style as the existing expiry / auto-complete / email-drain blocks in `POST /internal/cron/tick`. It caps per-tick work to `100` candidate inserts (across all series) so a backlog doesn't blow a single tick's budget; the drain is self-healing because `generated_through_date` only advances when a batch commits.

### Locking

Two options for the series submit transaction, to be chosen in implementation:
1. **Per-day advisory locks.** Take `pg_advisory_xact_lock(hashtext('lesson-day:' + laDate))` for every unique LA date in the first-generated batch. Highest fidelity, matches the single-lesson rule, but a 10-week series takes ~10 locks and lock ordering must be deterministic (sorted ascending) to avoid deadlock with a concurrent single-lesson booking.
2. **One series-level lock.** `pg_advisory_xact_lock(hashtext('series:' + householdId + ':' + locationId))` protects the whole submit against another series submit for the same household + pool but does *not* protect against a single-lesson booking at the same slot. Combine with per-day locks for the specific days being written, or rely on the re-check-after-lock pattern — which the single-lesson path also uses.

The cron pass takes per-day locks the same way, one occurrence at a time inside its own small transaction, so the two lock styles never need to coexist within a single transaction.

### Series email and multi-event `.ics`

- One outbox row per series approval: `event = 'lesson_series_confirmed'`.
- `payload` carries: the rule, the full list of generated occurrences (`[{ lessonId, startsAt, durationMinutes, locationName, locationAddress, calendarSequence }]`), swimmer first names, location, deep link to a series detail route in the web app.
- `ics_method = 'REQUEST'` and the outbox row stores the lesson ids and sequences; the renderer builds one `VCALENDAR` with one `VEVENT` per occurrence. Each `VEVENT` carries:
  - `UID:${lessonId}@axiomaquatics.io` — the per-lesson UID is preserved so a later per-occurrence reschedule or cancel can supersede its own `VEVENT` via `SEQUENCE:N`.
  - `SEQUENCE:0` — this is the first `REQUEST` for every one of these lessons.
  - `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION` per ADR 028's existing rules (including the home-pool privacy rule and the swimmer-first-name rule).
- The row has `ics_sequence = 0` *for the series email itself* — unused by the renderer (each `VEVENT` reads its own lesson's sequence) but keeps the paired-nullability CHECK happy and reads consistently.
- `lessons.calendar_sequence` on each generated row goes from `0 → 1` inside the series approval transaction (same snapshot-then-increment rule as single-lesson confirms). `calendar_invite_sent_at = now()` on each row in the same transaction.
- The sender's claim-before-send and supersede guards (ADR 028) apply unchanged: Resend's `Idempotency-Key` is still the outbox id, duplicate-send window is still closed.
- **No `RRULE`.** The initial draft of this document considered emitting an `RRULE` in a single master `VEVENT`. Rejected because (a) our DB stores each occurrence as a row, so an `RRULE` would describe the rule but not the actual rows the parent will see in the app; (b) per-occurrence reschedules require `RECURRENCE-ID` overrides to supersede specific instances, which is heavier to generate and parse than `SEQUENCE:N` on independent `VEVENT`s; (c) multi-`VEVENT` is universally supported.

#### Why not one email for a this-and-future change

A this-and-future reschedule rewrites multiple existing lessons' `starts_at`. Each lesson's `VEVENT` is identified by its per-lesson UID; each new `starts_at` requires `METHOD:REQUEST` with `SEQUENCE:N+1` on that UID so the invite in the parent's calendar is superseded, not duplicated. A single `.ics` with multiple superseding `VEVENT`s is technically legal, but — and this is the practical issue — the parent's calendar client, inbox client, and the "update the single event you clicked on" pattern are built around per-event invites. Grouping them in one email also makes error recovery per-row harder: if Resend accepts the message, we have no row-granular retry. The simpler model: one email per occurrence for runtime changes, same as a single-lesson reschedule or cancel. The series confirmation email is a one-time welcome at the top of the series's life.

### Per-occurrence changes (standard lesson routes)

- `DELETE /lessons/:id` — standard single-lesson cancel path. The outbox emits `lesson_canceled` with `METHOD:CANCEL` and `SEQUENCE:N+1`. If `series_id` is set, the lesson row is simply canceled; the series rule is unaffected.
- `PATCH /lessons/:id` — standard reschedule. Emits `lesson_rescheduled` per ADR 028 rules. If `series_id` is set, per Q5 default we **detach**: set `series_id = null` on this row, so a future this-and-future rule change doesn't disturb the already-rescheduled occurrence.
- No new API surface for these.

### This-and-future changes

New endpoints under `/lessons/series/:id/`:

- `PATCH /lessons/series/:id/future` — body carries `fromDate` plus the rule-level fields to update (`startTime`, `durationMinutes`, `locationId`, maybe `weekday` — gated by Q2). Transaction:
  - Lock the series + per-day locks for all affected generated rows on or after `fromDate`.
  - Validate the new rule against the slot engine for every affected row.
  - On success, update `lesson_series` and `UPDATE lessons SET starts_at = …, moved_at = now(), previous_starts_at = starts_at WHERE series_id = :id AND series_id IS NOT NULL AND starts_at >= :fromDate`. For each affected row, emit a `lesson_rescheduled` outbox row (standard shape, `METHOD:REQUEST`, `SEQUENCE:N+1`) and bump `calendar_sequence`.
  - Write a `lesson_series_rescheduled` audit row at series level.
  - After commit, schedule `syncLessonToGoogle` per affected row.
- `DELETE /lessons/series/:id/future` — body carries `fromDate`. Transaction:
  - Cancel the series (`status='canceled'`) if `fromDate <= series.start_date`; otherwise shorten `end_date` to `fromDate - 1 day` and leave status `approved`.
  - `UPDATE lessons SET status='canceled', canceled_at=now(), canceled_by=<actor> WHERE series_id=:id AND starts_at >= :fromDate AND status IN ('approved','pending')`.
  - For each canceled row, emit `lesson_canceled` with `METHOD:CANCEL` (per ADR 028's rules).
  - Write a `lesson_series_canceled` audit row.
  - After commit, schedule `syncLessonToGoogle` per canceled row.
- Permissions: owner / manager on the parent side, coach on the coach side. Viewers always rejected (same as single-lesson routes).

### Coach booking integration

- Coach-created series (gated by Q1) is `/coach/lessons/series/*`, mirroring `/coach/lessons`. The slot engine runs with `skipMinAdvance=true` for every occurrence (no 16-hour rule for the coach, per ADR 029).
- Per-occurrence warnings (`outsideHours`, `travelBufferViolated`, `dailyCapExceeded`, `blockedTimeOverlap`, `maxAdvanceExceeded`): depending on Q11, either the coach acknowledges once at the series level (ergonomic but hides which specific occurrences fired) or the preview returns per-occurrence warnings and the coach acknowledges each (verbose but precise). The audit record in `household_audit_log.payload.override` is the server-computed, per-occurrence truth either way.
- Hard rejects (overlap with existing pending/approved lesson, past start time) apply per-occurrence. One hard reject fails the whole submit; the client re-renders the preview with the conflict highlighted.
- Coach cancellation / reschedule at this-and-future scope uses the same endpoints as parents, with role-based permission (owner/manager OR coach).

### Google Calendar integration

Already handled by ADR 027 at the lesson row level. No new surface:
- Each generated `approved` lesson that lands in a series's create / approve / cron-extension pass gets `syncLessonToGoogle(id)` scheduled post-commit.
- A this-and-future reschedule emits one `syncLessonToGoogle(id)` per moved row — same pattern as a single-lesson reschedule, N times.
- A this-and-future cancel emits one `syncLessonToGoogle(id)` per canceled row — same pattern. Each call deletes the event because the lesson's status is no longer `approved`/`completed`.
- The full and light passes already cover series-generated rows because they filter on status + window, not on `series_id`.

Capacity note: the series create pass can queue up to `bookingMaxAdvanceWeeks × weekdays` microtasks at once (10 weeks × 1 weekday = 10 sync calls today). The service's existing 100ms sequential gap keeps that under Google's quota comfortably.

### Trust

Series-generated rows affect trust the same way single-lesson rows do: `needsApproval(householdId, locationId)` reads `status IN ('approved','completed')` without inspecting `approved_by` or `series_id`, so the first approved series lesson at a pool satisfies trust for every subsequent lesson there (including non-series bookings). No code change.

### Cron tick extensions

The `POST /internal/cron/tick` already runs: expiry pass, auto-complete pass, Google-sync light pass + 24-hour full pass, email outbox drain, retention scrubs. This plan adds **one** block to the same handler:

```
Series window extension pass
  For each lesson_series with status='approved'
                  AND generated_through_date < min(end_date, today_LA + bookingMaxAdvanceWeeks):
    - Compute the next candidate occurrence dates up to the new window edge
    - For each candidate: slot check → insert or skip
    - Advance generated_through_date
    - Schedule syncLessonToGoogle per inserted row (post-tick microtasks)
  Hard cap of 100 inserts per tick total across all series.
```

Same style as the existing passes: single sequential loop, bounded, resumable, logs each pass's counts. The cron tick cadence (every 5 minutes per ADR 027 note) is unchanged. One extra block does not change the tick's complexity.

---

## Part 2 — Multi-lesson batch booking

A separate, smaller feature. Lets a parent or coach (per Q8) pick N arbitrary slots in one submission and have them written in one transaction. No rule, no series row, no runtime extension.

### Shape

- Client calls a preview endpoint with an array of `(startsAt, durationMinutes, locationId, swimmerIds)` triples.
- Server returns a per-slot state (same enum as the series preview, minus `not_open_yet` because batch submissions are always inside the current booking window).
- Client calls the submit endpoint with the array and (for coach) override acknowledgements.
- Server takes per-day advisory locks for every unique LA day in the submission, sorted ascending (deterministic ordering avoids deadlocks).
- Server re-runs the slot engine under lock; writes N `lessons` rows, N `lesson_swimmers` rows, N `household_audit_log` rows (one per lesson, `action = 'lesson_booked'` or `'lesson_booked_by_coach'`), N outbox rows (one `lesson_confirmed` per approved lesson, one `booking_requested` per pending — same mix as today).
- Partial failure handling: if any slot fails hard rejects, the whole submit fails. If a slot would trigger an acknowledgeable warning and the acknowledgements set doesn't cover it (coach path only), the whole submit fails with the server-computed warning set per lesson.
- Post-commit: one `syncLessonToGoogle(id)` microtask per approved lesson.

### Email story (batch)

Unlike the series flow, each lesson in a batch produces its own confirmation email, same as a single-lesson booking. We considered a "you have N confirmed lessons" summary email for batch, but it adds a new template file, a new outbox event, a new render path, and parents still need per-lesson `.ics` files for their calendars. Decision: no summary email; one email per lesson. (Flag for Jason: if he wants a summary instead of per-lesson emails, this is a straightforward add — one new outbox event and template.)

### Approval and trust (batch)

- `needsApproval(householdId, locationId)` runs once per unique location in the batch (because trust is pool-scoped). Within one submission, mixing locations is permitted but each lesson's approval state is computed against its own pool.
- If the household lacks trust at a given pool, the lessons at that pool land as `pending` and expire per the standard 16-hour rule. Lessons at a trusted pool land as `approved`. Coach batch submissions auto-approve everything per ADR 029.

### Why batch is not a special series with `recurrence_count=N`

Batch slots are chosen one at a time by the parent (or coach). There's no rule to extend into the future, no "generate N more as the window advances" semantic, no notion of "this and future." Trying to shoehorn batch into the series model would require (a) a null-rule series row (meaningless), (b) a `generated_through_date` that equals the latest slot date and never advances (dead field), and (c) a this-and-future endpoint that applies to a non-rule (nonsense). Keeping batch standalone is cheaper and clearer.

---

## Integration summary (changes to existing systems)

### Outbox events (ADR 028)

New events:
- `lesson_series_requested` — parent submitted a series that needs coach approval. No `.ics`. Analogous to `booking_requested`.
- `lesson_series_confirmed` — series is approved (either on submit for auto-approved / coach-created, or on coach approve for parent-requested). Carries a multi-`VEVENT` `.ics` with `METHOD:REQUEST` and `SEQUENCE:0` per included lesson. **One row per series, not per occurrence.**

Existing events unchanged for series-generated lessons:
- `lesson_rescheduled`, `lesson_canceled`, `request_expired` (if a series-generated row is still pending when it expires) all behave per ADR 028.

Dedup key `(lesson_id, event, sequence)` holds for both new events too: the series-level row uses the series's approval moment as a logical key. If we need a cleaner dedup, extend to `(lesson_id, series_id, event, sequence)` — a one-line migration later. Flag in open questions if Jason wants this.

### Cron tick

New block for the series window extension pass (described above). No new cron, no new worker, no new secret. The tick is already the single place for "work that happens over time."

### Google sync (ADR 027)

No new paths. The post-commit `syncLessonToGoogle(id)` microtask fires N times for N affected rows in series create / approve / this-and-future / batch write / cron-extend passes. ADR 027's list of lesson-change paths grows by: `/lessons/series`, `/lessons/series/*/approve`, `/lessons/series/*/future` (patch and delete), the cron series-extension pass, and `/lessons/batch` (plus the coach variants if Q1 and Q8 widen them). The follow-up PR that implements this plan updates ADR 027's lesson-change-path bullet list in the same commit as the code.

### Coach booking (ADR 029)

Coach-created series paths bypass the 16-hour notice window identically to the single-lesson coach path (`coachBypassNotice=true`, `skipMinAdvance=true`). Per-occurrence overlap rejects apply identically. Server-computed warnings on coach series submissions: see Q11.

### APP_ENV, email allowlist, logging

Nothing new. Series emails go through the same transport, verification, and logging rules as single-lesson emails (ADR 028). Swimmer names and addresses in the payload follow the same privacy rules — in particular, home-pool full addresses are only sent to the owning household.

---

## Data model (preview)

Final column names and types are deferred to implementation PRs. The shape:

- **New table `lesson_series`** — one row per series rule. Columns include `id`, `household_id`, `location_id`, `type`, `duration_minutes`, recurrence fields (per Q2), `start_date`, `end_date` or `occurrence_count` (per Q3), status enum (`pending`, `approved`, `canceled`), `requested_by`, `approved_by`, `approved_at`, `generated_through_date`, timestamps.
- **New table `lesson_series_skips`** — `(series_id, date, reason)`. Written by the cron extension pass and the submit path when a candidate occurrence resolves to anything other than `available`. Readable in the app so Jason / parents can see which Tuesdays got dropped.
- **New column `lessons.series_id uuid NULL FK → lesson_series.id`.** Nullable, no cascade (series deletions are not supported; terminal series rows are preserved for audit).
- **Possibly a new column `lesson_series.rule_version integer`** if we need to allow this-and-future rule changes to be re-run against the right rule. Defer until Q5 resolves.
- No column added to `lesson_email_outbox` for Part 1. The `payload jsonb` absorbs the series's occurrence list without a schema change. Dedup key stays `(lesson_id, event, sequence)` — the series-confirmation row uses the series's `lesson_series.id` wherever it needs a key (e.g. for the audit log) but still carries the first generated lesson's id as `lesson_id` so the existing outbox foreign key holds. If this gets awkward, migrate the outbox FK to a `(lesson_id NULL, series_id NULL, CHECK lesson_id IS NOT NULL OR series_id IS NOT NULL)` shape — flagged in Open Questions for a design review before implementation.
- No new columns on `lessons` beyond `series_id`. `calendar_sequence`, `calendar_invite_sent_at`, `google_calendar_event_id`, `calendar_sync_status` all apply unchanged.

Final SQL + Drizzle migration + snapshot generation is deferred to the implementation PR per CLAUDE.md (never hand-write migrations).

---

## API (preview)

Rough endpoint list; final shapes and Zod schemas live in `packages/shared/src/schemas/booking.ts` under the implementation PR.

Parent-side (gated by Q1):
- `POST /lessons/series/preview` — pure read, no writes.
- `POST /lessons/series` — submit a series.
- `PATCH /lessons/series/:id/future` — this-and-future reschedule.
- `DELETE /lessons/series/:id/future` — this-and-future cancel.
- `GET /lessons/series/:id` — detail with the rule and all currently-generated occurrences.
- `GET /lessons/series/mine` — list the household's active series.

Coach-side (gated by Q1):
- `POST /coach/lessons/series/preview` and `POST /coach/lessons/series` — same shape, server runs with `skipMinAdvance=true`.
- `PATCH /coach/lessons/series/:id/approve` — approve a parent-submitted series.
- `PATCH /coach/lessons/series/:id/future` and `DELETE /coach/lessons/series/:id/future` — coach-side this-and-future.

Batch (Part 2, gated by Q8):
- `POST /lessons/batch/preview`
- `POST /lessons/batch`
- Coach variants if Q8 includes coach.

Everything else (per-occurrence reschedule, cancel, approve, decline, no-show, complete) stays on the single-lesson routes.

---

## Testing concerns worth flagging

- **Determinism of occurrence generation under the LA / DST calendar.** Series spanning a DST transition must emit lessons at the correct local wall-clock time, not the UTC-shifted time. The slot engine already handles this per `coach-availability-editor.md`; the series generator must call through the same resolver.
- **Advisory lock ordering.** Multi-day submits must sort LA dates ascending before taking locks to avoid deadlock with a concurrent single-lesson booking that locks a day the series also touches.
- **Cron idempotency when a tick crashes partway through a series extension.** `generated_through_date` only advances when a batch commits; a crash mid-batch leaves the next tick to pick up the same work. Verify this with an integration test that panics mid-pass.
- **The 2-minute outbox claim window with the series-confirmation row.** The row renders N `VEVENT`s. Rendering happens inside the sender's 2-minute window; verify that render time stays well under that even at `bookingMaxAdvanceWeeks × 7` occurrences.
- **Audit log coverage.** Each series mutation writes one `household_audit_log` row (series create, approve, this-and-future reschedule, this-and-future cancel). Verify the audit covers every path.
- **The "newer row already sent" supersede guard** interaction with the series-confirmation row. The series confirmation precedes any per-occurrence row, so the supersede logic should never trip on it — but add an explicit test anyway.
- **Google Calendar quota under the extension cron.** 10 syncs per tick per series × many series could cross Google's user quota (max 500 per 100 seconds). The light-pass cap of 50 rows per tick already caps the drain; the series extension pass's cap of 100 inserts per tick caps the generation side. Composed, these are safely under the quota but should be verified in integration tests before enabling the pass in production.

---

## Rollout order (once questions resolve)

1. **PR A — Schema and read endpoints.** `lesson_series`, `lessons.series_id`, `lesson_series_skips`, `/lessons/series/:id` and `/lessons/series/mine`. No writes beyond the test fixtures. Pure read path exercise.
2. **PR B — Preview endpoints.** `POST /lessons/series/preview` (and coach variant per Q1). Still no writes.
3. **PR C — Submit, approve, generate.** `POST /lessons/series`, `PATCH /coach/lessons/series/:id/approve`, the series-confirmation outbox event + template, the multi-`VEVENT` renderer, the audit rows. First time real rows land.
4. **PR D — This-and-future.** `PATCH/DELETE /lessons/series/:id/future`. Per-occurrence outbox events on every affected row.
5. **PR E — Cron extension pass.** New block in `POST /internal/cron/tick`.
6. **PR F — Multi-lesson batch.** `POST /lessons/batch/preview` and `POST /lessons/batch`. Smaller, no series touching.
7. **Doc updates (same PR as code):** `docs/data-model.md` entries; ADR 027 + ADR 028 lesson-change-path lists extended; this plan's status flipped to Shipped; the PR-9 pointer in `docs/plans/phase-2-booking.md` removed in favor of a link to this doc.

Each PR is independently reviewable and shippable. Nothing above requires a backfill or a destructive migration.

---

## Why this supersedes the PR 9 stub

The stub's `recurrence_groups` had three columns short of what approval, cron extension, and series email need: no series-level approval state, no `generated_through_date`, no `requested_by`/`approved_by`. The stub's `DELETE .../future` is the right shape but was missing the audit, outbox, and sync hooks. This document extends the stub into a complete plan that composes with ADR 027/028/029 cleanly. The replacement is behavioral too: generated lesson rows are the source of truth for availability, Google sync, and emails, just like today's single lessons — the series rule is a template, not a parallel data path.
