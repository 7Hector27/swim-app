# 029 — Coach booking on behalf of a family

**Date:** 2026-10-22
**Status:** Accepted

## Context

Today the only booking path is a parent submitting a request from their account. Jason routinely wants to book a lesson for a family himself — in response to a text, during a lesson, or when a parent asks him to schedule something that is outside the normal 16-hour notice window or outside his posted teaching hours. Four constraints shape the decision:

- The coach has already decided the lesson is happening. A pending-approval step would introduce a false "awaiting coach" state and a delay for no gain.
- A coach booking must still produce the same durable artifacts a parent booking produces: a confirmation email with an `.ics` invite, a Google Calendar event (when the integration is connected), and a trust row at that pool for future auto-approvals.
- Two lessons at times Jason cannot physically teach (same time, same place; or any direct time overlap given a single-coach app) must be impossible, even under an override. Everything else about his "custom time" (teaching hours, 16-hour notice, travel buffer, daily cap) is advisory to Jason himself and should be accept-able with a warning rather than blocked.
- The parent's experience of a coach-booked lesson must be indistinguishable from one they booked themselves: they can see it in their list, cancel it, and reschedule it under the same rules.

## Decision

**Coach-only entry points.** A "Book lesson" button on `/coach/schedule` (day and week views) and a pre-filled version on `/coach/swimmers/[id]`. No parent-facing surface. Mobile-first, since Jason uses this on the pool deck.

**Household and swimmer selection.** The coach searches a household by family name or by any swimmer's first/last name. Siblings never mix families — the swimmer picker is strictly scoped to the chosen household. Archived swimmers are skipped. One of two location choices: the household's active home pool (if set) or any named pool.

**Approved immediately, no pending step.** The lesson is written as `status = 'approved'`, `approved_by = <coach profile id>` (non-null, which ADR 021 reserves for coach approval as opposed to system auto-approval), `approved_at = now()`, `expires_at = null`. `requested_by = <coach profile id>` — the coach is the requester. No new column on `lessons`; the "booked by coach" signal is the audit-log row described below plus the role of the `requested_by` profile.

**Audit log in the same transaction.** Each coach booking writes a `household_audit_log` row with `action = 'lesson_booked_by_coach'`, `actor_id = <coach>`, `household_id = <booked family>`, and a `payload` jsonb carrying `{ lessonId, locationId, startsAt, durationMinutes, swimmerIds, override }`. The row is inserted inside the same `db.transaction()` as the lesson insert and the `lesson_swimmers` inserts, per CLAUDE.md's standing rule. If any of the three writes fails the whole thing rolls back.

**Trust counts.** A coach-booked approved lesson satisfies ADR 021's approval gate at that pool for that household. `needsApproval(householdId, locationId)` already checks `status IN ('approved', 'completed')` without inspecting `approved_by`, so this falls out of the existing predicate — no code change. Spelling it out here because it's a real policy decision: Jason booking a lesson for a new household counts the same as auto-approving their second booking at a pool he's already taught them at.

**Reuses the parent booking transaction and slot engine.** The `POST /coach/lessons` handler takes the same `pg_advisory_xact_lock(hashtext('lesson-day:' + laDate))` lock as `POST /lessons`, serializing concurrent writes on the LA calendar day across both paths. The lesson insert, `lesson_swimmers` insert, `household_audit_log` insert, and `lesson_email_outbox` insert all happen inside that one transaction. Non-override submissions call the same `computeAvailableSlots` under the lock and re-check that the chosen slot is still available. Custom-time submissions skip `computeAvailableSlots` and instead run a bare time-overlap check against pending/approved lessons — see below.

**Custom-time override rules.**

- **Hard reject: time overlap with another pending or approved lesson, at any location.** A single coach cannot be in two places at once. This is enforced by a `startsAt < existingEnd AND existingStartsAt < newEnd` predicate inside the transaction, after the advisory lock, and is not skippable by any flag. Direct overlap always returns `422 slot_unavailable`.
- **Warning: outside teaching hours.** Skippable with `overrideWindow: true` and a UI acknowledgment.
- **Warning: inside the 16-hour notice window.** Same.
- **Warning: travel-buffer insufficient between back-to-back lessons at different pools.** Jason may accept a shorter buffer.
- **Warning: daily lesson-minute cap exceeded.** Jason may teach more than `maxDailyLessonMinutes` on that day.
- **Warning: overlaps a blocked time Jason set himself.** The blocked time stays in place; the lesson lands on top of it.

Each warning the coach acknowledged is recorded on the audit log's `payload.override` object so an override can be audited later. Hard rejects do not need a payload — the lesson doesn't exist.

**Emails use the existing `lesson_confirmed` event with an `initiatedBy` payload field.** No new outbox event, no new email template file. The `lesson_confirmed` React Email template (per ADR 028) reads `payload.initiatedBy` and branches its copy: for `'coach'` it says "Jason scheduled a lesson for you" and for `'parent'` it keeps the current "Your lesson is confirmed." All other fields of the payload are unchanged. The outbox row is written inside the same transaction as the lesson, per ADR 028's rule. `.ics` method is `REQUEST`, `SEQUENCE` is `0` for a new lesson (ADR 028's monotonic counter semantics).

**Calendar sync hook fires after commit.** `queueMicrotask(() => void syncLessonToGoogle(newLesson.id))` after `res.json()`, identical to every other lesson route. `syncLessonToGoogle` is approve/update/delete-idempotent per ADR 027. This path (coach-booked approved) is **added to the list of lesson-change paths in ADR 027 and ADR 028** when this plan lands.

**Parents can cancel and reschedule coach-booked lessons.** No new code and no new rule: the existing `DELETE /lessons/:id` and `PATCH /lessons/:id` already allow household managers/owners to act on any lesson that belongs to their household. A coach-booked lesson is their lesson. The cancel path writes a `lesson_canceled` outbox row (with the `CANCEL` `.ics` since `calendar_invite_sent_at` is non-null after the booking email went out) in the cancel's own transaction; the reschedule path emits `lesson_rescheduled`. Both are covered by ADR 028's existing rules.

**Explicitly out of scope:** recurring lessons, booking for families without an account, payments and packages. These are deferred.

## Alternatives considered

- **Reuse `POST /lessons` with a role branch.** Rejected. The parent handler enforces `requireParent`, scopes everything to the caller's household, and runs the approval gate — three behaviors that would need to be defeated. A separate coach handler at `POST /coach/lessons` keeps each role's path linear and the authorization rules obvious at the route level.
- **Create coach-booked lessons as `pending` and auto-approve immediately with a background job.** Rejected. The parent would see "Pending" for anywhere from a tick to seconds, and the pending state would briefly block the slot with a 16-hour expiry that will immediately be nullified. No benefit, extra state transition, extra outbox row (`booking_requested` would need to be suppressed), extra audit row.
- **A separate "coach override reason" free-text field.** Rejected for v1. The structured `payload.override` boolean set is enough signal for later auditing, and a free-text field is a privacy footgun (we strip free-text from logs; the audit log would be the one place a stray detail could linger). The ADR open-question flags this for Jason — if he asks for a reason field, it's a straightforward add.
- **Let the coach-booking path overlap another lesson with an explicit override.** Rejected. Jason is one person. Two overlapping lessons would be a bug a human-visible UI couldn't recover from without reshuffling swimmers. The travel buffer / daily cap being overridable models "Jason is willing to be late or work a long day"; a direct overlap models "Jason is willing to be in two places" which is impossible.
- **A different Google Calendar event summary for coach-booked lessons (e.g. a visual tell like "📘 Swim lesson: Alex").** Deferred. The data boundary is unchanged either way — it would only be a UX nicety on Jason's calendar grid. Keeping the ADR 027 title shape identical for both paths is the default; the plan flags this as an open question for Jason.
- **A boolean `coach_booked` column on `lessons`.** Rejected. Everything about the mechanism (coach as `approved_by`, coach as `requested_by`, audit row with `action = 'lesson_booked_by_coach'`) is already in the row or in the audit log. A dedicated boolean would be redundant and would need to stay consistent with the other three signals under every reschedule / cancel transition — an invariant we don't want to maintain.

## Consequences

- One new API endpoint: `POST /coach/lessons`. One supporting endpoint: `GET /coach/households?q=<string>` for the search picker. Both Zod-validated via `packages/shared/src/schemas/booking.ts`.
- No database migration. The new `household_audit_log.action` string is free-text and does not require a schema change; the existing `payload jsonb` column carries the override detail. `lesson_email_outbox.payload` is already jsonb and absorbs the new `initiatedBy` field without a migration — only the shared Zod payload schema (`LessonConfirmedPayloadSchema`) grows a field.
- ADR 027 and ADR 028 lesson-change-path lists grow by one bullet. The follow-up PR that adds this feature updates both ADRs in a single doc commit.
- The parent-facing booking surface is unchanged. The only new thing a parent experiences is a confirmation email whose copy says "Jason scheduled this for you" when the `initiatedBy` payload field is `'coach'`.
- Jason gains a path to override his own teaching rules. The audit log is the record of each override, so if he ever wants to see "which lessons did I book outside my hours" the query is a `household_audit_log` filter on `action = 'lesson_booked_by_coach' AND payload->'override'->>'outsideHours' = 'true'`.
- Stacked on `feature/parent-booking-emails`. The email outbox and `lesson_confirmed` template that this ADR extends land first; this branch depends on them. Google Calendar sync (ADR 027) is already on `main` and does not block.
