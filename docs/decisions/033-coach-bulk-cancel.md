# 033 — Cancellation policy and coach bulk cancel

**Date:** 2026-11-02
**Status:** Accepted

## Context

Two threads come together here.

The first is policy. Today the API lets anyone with household-manager rights on a lesson, and the coach on any lesson, call `DELETE /lessons/:id` or `PATCH /lessons/:id` at any time before the lesson starts. There is no cutoff and no late-cancel concept. The audit at `docs/reference/coach-controls-audit.md` recorded this but did not endorse it, and payments do not exist yet. Jason wants the posture written down: an open-ended cancel window is the rule, not an oversight, and when payments ship a cancelled lesson will be fully refunded.

The second is operations. Jason loses pool access for a day or a week (bad weather, pool maintenance, a trip) and today has to open every affected lesson and cancel it one at a time. Each click costs a transaction, an outbox write, a Google Calendar sync, and one email per lesson for the family. For a two-day closure with ten families that is twenty emails nobody wants to send and twenty inboxes that have to piece back together what actually happened. A one-shot "cancel every lesson in this range" with one summary email per family is the shape he asked for.

Three constraints frame the design:

- The cancel transaction must stay all-or-nothing across every affected lesson, every affected family's audit row, every outbox row, and the optional "block this time" artifact. If any insert fails the whole operation rolls back; nothing is partially cancelled.
- The parent inbox cost of a bulk cancel is O(1) per family, not O(1) per lesson. One email per household lists every one of their cancelled lessons and every one of their declined pending requests with the coach's message, and carries CANCEL calendar invites for the lessons that had been invited.
- Google Calendar sync stays its existing one-way shape (ADR 027). The post-commit fan-out invokes `syncLessonToGoogle` once per lesson, which does the right thing because each lesson's row is already in its final state.

## Decision

### Policy — no cancellation cutoff

- Parents and the coach may cancel any lesson that has not already started. There is no minimum-notice window, no "late cancel" flag, and no fee. `DELETE /lessons/:id` and the bulk endpoint defined below enforce only that `starts_at > now()` on the parent path; the coach path can cancel until the lesson's end time to clean up a no-show, and that distinction is kept.
- Cancelled lessons will be fully refunded once payments exist. This ADR locks that in now so the eventual billing design cannot drift into "late cancels forfeit the fee." If Jason later wants a late-cancel policy, it ships as a new ADR, not as a quiet rule in a payments ADR.
- Reschedules follow the same posture: no cutoff, no penalty. A reschedule is a cancel plus a book with calendar-sequence continuity, and both halves are free of fees.
- The parent-facing policy copy that eventually lands on the dashboard says: "Any lesson can be cancelled or moved up to the start time. If payment has been taken, the lesson is fully refunded."

### Architecture — coach bulk cancel

**One coach-only entry point.** `POST /coach/lessons/bulk-cancel/preview` and `POST /coach/lessons/bulk-cancel` live on the coach router with the existing `requireUser + requireCoach` chain. No parent-facing surface and no reuse of `DELETE /lessons/:id` logic; the bulk path is a distinct transaction that handles cross-family batching the single-lesson delete was never built for.

**A new `bulk_cancellations` table owns the operation.** One row per invocation records `(id, coach_profile_id, start_date, end_date, location_id, message, created_at)`. Dates are LA calendar dates; `location_id` is nullable (null means "every pool"); `message` is nullable and capped at the same `DECLINE_REASON_MAX_LENGTH = 500` already used for decline reasons. This row is the parent of every outbox row and every audit row the operation writes. Nothing on `lessons` references it directly, because a cancelled lesson's end state (`status = 'canceled'`, `canceled_at`, `canceled_by`) is already in its row; the bulk_cancellations row answers "why this cluster of cancellations" without borrowing identifiers from `lessons` or `booking_batches`.

**The email outbox gets `bulk_cancellation_id` + `household_id` as a third scope.** The existing `lesson_id` / `batch_id` pair becomes `lesson_id` / `batch_id` / `bulk_cancellation_id`. The `scope_exactly_one` CHECK is extended to the three-column OR. A new partial unique index on `(bulk_cancellation_id, household_id, event, sequence) WHERE bulk_cancellation_id IS NOT NULL` enforces one row per family per operation and gives the drain the same dedup key shape it already has for the other two scopes. The debug index gets a mirror on `(bulk_cancellation_id, created_at desc)`. `household_id` is added as a nullable column on the outbox and populated only for bulk-cancellation rows; the lesson and batch scopes still derive the recipient household implicitly from `lessons.household_id` or `booking_batches.household_id`. Reusing `lesson_id` for one of the N lessons in the operation, or reusing a lesson's `batch_id` for the operation, were both considered and rejected — a bulk cancel is neither a lesson's event nor a parent batch's event, and borrowing either id would break the dedup / supersede rules that keyed row identity to those parents in ADR 028 and ADR 030.

**One new email event: `coach_bulk_cancel`.** Payload per family carries `{ bulkCancellationId, householdId, coachFirstName, startDateLocal, endDateLocal, locationName, message, cancelledLessons: [...], declinedRequests: [...] }`. Each `cancelledLessons` entry has `{ lessonId, startsAtUtc, endsAtUtc, startsAtLocalDisplay, durationMinutes, swimmerFirstNames, location, calendarSequence, wasInvited }`. Each `declinedRequests` entry has `{ lessonId, startsAtLocalDisplay, durationMinutes, swimmerFirstNames, location }` — no `wasInvited` because pending lessons never had an invite. The payload is frozen at write time per ADR 028. The React Email template `CoachBulkCancel.tsx` renders two sections: "Cancelled lessons" (always) and "Requests that couldn't be confirmed" (only when `declinedRequests` is non-empty), with the coach's `message` above both and a plain-text fallback. The payload also carries the three legacy fields the sender's shared contract requires (actorRole, coachFirstName, deepLink) so the outbox sender does not need a scope-aware branch.

**No `request_declined` email is enqueued for pending lessons that fall inside the range.** The pending rows still move to `status = 'declined'` with `declined_at`, `declined_by`, and `decline_reason = <coach message or null>`, and the household's single `coach_bulk_cancel` row covers both the cancellations and the declines. This is a specific carve-out from ADR 028's "every decline writes a `request_declined` row" rule, mirrored by the audit record so the pending state transition is still visible.

**ICS is one VCALENDAR per family with one METHOD:CANCEL VEVENT per invited cancelled lesson.** Only the `cancelledLessons` entries with `wasInvited: true` produce a VEVENT; declined pendings and never-invited approved lessons do not. The outbox row carries `icsMethod = 'CANCEL'` when at least one VEVENT exists, otherwise `null`. The row does not carry `icsSequence`; per-lesson calendar sequences live inside the payload's `cancelledLessons[].calendarSequence` snapshots, each bumped alongside its lesson in the transaction, and the ICS builder reads them from there. The `ics_pair` CHECK still holds because for bulk rows the top-level `icsSequence` is `null` when `icsMethod` is `null` (zero invited lessons), and the single sequence slot is irrelevant when the ICS carries N events — moving the sequence into the payload is the architectural response. Google Calendar sync on the coach side continues to delete per-lesson events through the existing `syncLessonToGoogle` fan-out; the aggregated ICS is only for family-side mail clients that are not Google Calendar.

**ICS `LOCATION` includes the full home-pool address today, same as the single-lesson parent ICS.** The recipient family is the same household that owns the home pool, so there is no cross-household disclosure (per `apps/api/src/services/emails/types.ts` which documents this is safe in emails). The projection from `BulkCancelEmailCancelledLesson` into `BulkCancelIcsFilteredLesson` carries `isHomePool` through even though the current builder doesn't branch on it; this lets a future redaction (mirroring the ADR 027 Google Calendar carve-out) land as a one-line change inside the builder without re-plumbing the shape, pending the kids'-data legal review flagged in `docs/accounts.md`.

**Pool-scoped blocked_times via a nullable `location_id` FK.** Blocked times today have no pool dimension; adding one lets a block mean "Jason is not at this pool during this time" rather than always "Jason is unreachable." The slot engine's `blockedTimes` filter runs per-query already, so the change is a `where location_id IS NULL OR location_id = <requested>` added at the query that feeds `computeAvailableSlots`. Rows with `location_id = NULL` keep the existing "every pool" semantics; new rows the bulk-cancel flow writes when a pool is picked carry that pool's `location_id`. The coach availability UI gets a per-row pool label (or "All pools" for null) and the create form gets an optional pool dropdown so the plumbing has a non-bulk user as well. This is a one-column migration plus a slot-engine filter line; no data backfill needed because the column defaults to `NULL` which is the current behavior.

**The "block this time" option.** When the coach confirms with `blockRange: true` (the UI default) the same transaction writes availability artifacts covering the range. The rule:

- No pool filter → one `availability_overrides` row with `kind = 'day_off'`, `start_date = range start`, `end_date = range end`, `note = 'Bulk cancel'`. One row covers the entire range because `day_off` already accepts a multi-day span.
- Pool filter present → one `blocked_times` row per LA calendar day in the range, each spanning that day's midnight-to-midnight LA window with `location_id = <picked pool>` and `note = 'Bulk cancel'`. One row per day rather than one row for the whole range because `blocked_times.(starts_at, ends_at)` is UTC and crossing DST inside a single row makes "a day" fuzzy; one row per LA day keeps the semantics clear and the slot-engine queries unchanged.

Both artifacts write before the lesson updates inside the same transaction, so the slot engine sees them in the same instant it sees the cancelled lessons.

**Transaction shape.**

1. Open `db.transaction(async (tx) => { ... })`.
2. Take `pg_advisory_xact_lock(hashtext('lesson-day:' + laDate))` for each unique LA calendar day in the range, in ascending date order. This matches `POST /coach/lessons` and `POST /lessons` deterministic ordering, so a bulk cancel and a concurrent single booking on an overlapping day cannot deadlock.
3. Insert the `bulk_cancellations` row.
4. Select every `lessons` row with `status IN ('approved', 'pending')`, `starts_at` inside the LA calendar range translated to UTC, and (if `location_id` is set) matching `locations.id`, `FOR UPDATE`.
5. Partition into `approvedToCancel` and `pendingToDecline`. Snapshot each row's pre-bump `calendar_sequence` into a map keyed by lesson id.
6. Bulk update `approvedToCancel`: `status = 'canceled'`, `canceled_at = now()`, `canceled_by = <coach>`, `calendar_sequence = calendar_sequence + 1`.
7. Bulk update `pendingToDecline`: `status = 'declined'`, `declined_at = now()`, `declined_by = <coach>`, `decline_reason = message ?? null`.
8. If `blockRange: true`: insert the day-off override or the per-day blocked_times rows per the rule above.
9. Group affected lessons by `household_id`. For each household:
    - Load that household's current owner + manager profile ids (same recipient snapshot ADR 028 uses).
    - Load swimmer first names per lesson, location rows, and sort both lists chronologically.
    - Insert one `household_audit_log` row with `action = 'lessons_bulk_canceled_by_coach'` and payload `{ bulkCancellationId, canceledLessonIds, declinedLessonIds, invitedLessonIds }`.
    - Insert one `lesson_email_outbox` row with `event = 'coach_bulk_cancel'`, `bulk_cancellation_id = <id>`, `household_id = <id>`, `lesson_id = NULL`, `batch_id = NULL`, `sequence = 0`, `recipient_profile_ids = <snapshot>`, `ics_method = 'CANCEL' iff any wasInvited`, `payload = <per-family payload>`.
10. Commit.

**Post-commit fan-out.**

- One `syncLessonToGoogle(lessonId)` microtask per approved-cancelled lesson. Pending-cancelled lessons do not sync because pending lessons never had a Google event.
- One `sendLessonEmailOutboxRow(outboxId)` microtask per household outbox row.
- No `coachNotifications` row is written. The coach performed the operation and the response payload already summarizes it.

**Hard-reject cases.** All but the empty-case check run before the transaction opens; the empty case throws inside the transaction so the `bulk_cancellations` parent row rolls back with everything else.

- `start_date` before today's LA calendar date: `422 start_date_in_past`. The coach can't rewrite history; cancelling an already-past lesson is a per-row operation on the lesson detail page (cancel / mark-no-show), not a range submission.
- Range longer than 90 calendar days (end_date − start_date + 1 > 90): `422 range_too_large`. This cap is independent of `bookingMaxAdvanceWeeks` because coach-booked lessons (ADR 029 override) can legally sit outside the parent booking window; tying the cap to that window would prevent cancelling a legitimately-booked block of lessons on the far side of it. 90 days covers a full trimester with headroom and still prevents an accidental "cancel the next year" submission.
- `end_date < start_date`: `422 invalid_range`.
- Zero affected lessons AND `blockRange: false`: `422 no_lessons_in_range`. The preview endpoint shows the empty count already, so this is a belt-and-braces reject on submit. The route throws `EmptyConfirmError` inside the transaction so the `bulk_cancellations` insert (and the advisory locks) all unwind; nothing persists.
- Zero affected lessons AND `blockRange: true`: allowed. The coach is pre-blocking a quiet range.

**Response.** 200 with `{ bulkCancellationId, canceledLessonCount, declinedLessonCount, affectedHouseholdCount, blockApplied: boolean }`. No "list of lessons" — the preview endpoint owns that shape.

## Alternatives considered

- **Keep the per-lesson cancel path and loop it client-side.** Rejected. Each loop iteration opens its own transaction, so a partial failure leaves half the day cancelled and half still on the schedule, and each iteration enqueues a separate email per lesson per family. Both constraints at the top of this ADR fail.
- **Reuse `booking_batches` to group the bulk cancel.** Rejected. `booking_batches` is a parent-authored artifact (`booking_batches.mode in ('manual','weekly')`, per ADR 030); the row is created by the parent batch endpoint and references a single household + single location. A coach bulk cancel spans N households, is not a "booking," and would require widening the batch table's columns and uniqueness assumptions to accommodate a non-booking actor. A dedicated `bulk_cancellations` table is cheaper than overloading `booking_batches`.
- **Fan out N `lesson_canceled` outbox rows per family and merge at send time.** Rejected. The sender today picks one row and sends one email; a merge-at-send path adds a second claim protocol, a cross-row dedup, and new failure modes (what if one of the four merged rows failed to render?). Writing one row per family at the moment of the transaction keeps the sender's shape unchanged.
- **Issue a `request_declined` row for each pending in range, in addition to the family's bulk email.** Rejected. The parent inbox cost goes back to O(N), and the decline email duplicates information the bulk email already renders in its "Requests that couldn't be confirmed" section. The audit row keeps the state transition visible, which is what ADR 028's rule was ultimately protecting.
- **Add a `location_id` column to `lessons` by indirect join and skip blocked_times changes.** Already there — `lessons.location_id` exists and is what we filter on for the "pool filter" selection. The schema change in this ADR is only on `blocked_times`, so a pool-scoped block can be written without a parallel structure.

## Open questions

- Should the "block this time" default be user-configurable (per-coach preference), or is "always on" fine? Leaving it on in v1; revisit if Jason disables it on most invocations.
- Should the bulk email include a one-tap "re-book these at a new time" link for the parent? Deferred. The dashboard already lets them re-book; a bespoke CTA is a reasonable follow-up but not a launch blocker.
