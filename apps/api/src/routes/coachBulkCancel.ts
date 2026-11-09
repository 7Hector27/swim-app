// Coach bulk cancel (ADR 033). Preview + confirm. The transaction cancels
// approved lessons, declines pending requests, optionally writes a block
// artifact to prevent rebooking, and enqueues one `coach_bulk_cancel` email
// per affected family. Post-commit fans out `syncLessonToGoogle` per
// cancelled lesson and `sendLessonEmailOutboxRow` per family outbox row.

import { Router } from "express";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type {
  BulkCancelConfirmBody,
  BulkCancelConfirmResponse,
  BulkCancelPreviewBody,
  BulkCancelPreviewLesson,
  BulkCancelPreviewResponse,
} from "@swim-app/shared";
import {
  BULK_CANCEL_MESSAGE_MAX_LENGTH,
  BulkCancelConfirmBodySchema,
  BulkCancelPreviewBodySchema,
} from "@swim-app/shared";
import { db } from "../db/client";
import { requireLiveLessonFields } from "../db/liveLesson";
import {
  availabilityOverrides,
  blockedTimes,
  bulkCancellations,
  householdAuditLog,
  householdMembers,
  households,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../db/schema";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { getActiveCoachProfile } from "../lib/coachProfile";
import { getDateInLA, laToUtc } from "../lib/slots";
import { getEnv } from "../lib/env";
import {
  formatLessonTimeDisplay,
  LESSON_TIME_ZONE,
} from "../services/emails/format";
import type {
  BulkCancelEmailCancelledLesson,
  BulkCancelEmailDeclinedRequest,
  BulkCancelEmailPayload,
} from "../services/emails/bulkCancelTypes";
import type { LessonEmailLocation } from "../services/emails/types";
import { sendLessonEmailOutboxRow } from "../services/emails/sender";
import { syncLessonToGoogle } from "../services/googleCalendarSync";
import { refundLessonCharge } from "../services/balance";

export const coachBulkCancelRouter = Router();

// ── Preview ───────────────────────────────────────────────────────────────────

coachBulkCancelRouter.post(
  "/lessons/bulk-cancel/preview",
  validate({ body: BulkCancelPreviewBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as BulkCancelPreviewBody;
    const { startUtc, endUtc } = laRangeToUtcBounds(body.startDate, body.endDate);

    const whereClauses = [
      inArray(lessons.status, ["approved", "pending"]),
      gte(lessons.startsAt, startUtc),
      lt(lessons.startsAt, endUtc),
    ];
    if (body.locationId !== undefined) {
      whereClauses.push(eq(lessons.locationId, body.locationId));
    }

    const rows = await db
      .select({
        id: lessons.id,
        householdId: lessons.householdId,
        householdName: households.name,
        status: lessons.status,
        startsAt: lessons.startsAt,
        durationMinutes: lessons.durationMinutes,
        locationId: lessons.locationId,
        locationName: lessonLocations.name,
      })
      .from(lessons)
      .innerJoin(households, eq(households.id, lessons.householdId))
      .innerJoin(lessonLocations, eq(lessonLocations.id, lessons.locationId))
      .where(and(...whereClauses))
      .orderBy(asc(lessons.startsAt));

    let locationName: string | null = null;
    if (body.locationId !== undefined) {
      const locationRows = await db
        .select({ name: lessonLocations.name })
        .from(lessonLocations)
        .where(eq(lessonLocations.id, body.locationId))
        .limit(1);
      locationName = locationRows[0]?.name ?? null;
    }

    const swimmerRows = rows.length === 0
      ? []
      : await db
          .select({ lessonId: lessonSwimmers.lessonId, firstName: swimmers.firstName })
          .from(lessonSwimmers)
          .innerJoin(swimmers, eq(swimmers.id, lessonSwimmers.swimmerId))
          .where(inArray(lessonSwimmers.lessonId, rows.map((row) => row.id)))
          .orderBy(swimmers.firstName);
    const swimmerNamesByLesson = new Map<string, string[]>();
    for (const row of swimmerRows) {
      const list = swimmerNamesByLesson.get(row.lessonId) ?? [];
      list.push(row.firstName);
      swimmerNamesByLesson.set(row.lessonId, list);
    }

    const windowFilter =
      body.startTime !== undefined && body.endTime !== undefined
        ? { startTime: body.startTime, endTime: body.endTime }
        : null;
    // INNER JOINs on households and lessonLocations above guarantee both
    // identity columns are non-null at runtime; narrow the schema-level
    // widening per ADR 034.
    const inScope = rows.filter((row) =>
      lessonOverlapsWindow(row.startsAt, row.durationMinutes, windowFilter),
    ).map(requireLiveLessonFields);

    const items: BulkCancelPreviewLesson[] = inScope.map((row) => ({
      lessonId: row.id,
      householdId: row.householdId,
      householdName: row.householdName,
      status: row.status === "approved" ? "approved" : "pending",
      startsAt: row.startsAt.toISOString(),
      startsAtLocalDisplay: formatLessonTimeDisplay(row.startsAt),
      durationMinutes: row.durationMinutes as 30 | 45 | 60,
      locationId: row.locationId,
      locationName: row.locationName,
      swimmerFirstNames: swimmerNamesByLesson.get(row.id) ?? [],
    }));

    const approvedCount = items.filter((item) => item.status === "approved").length;
    const pendingCount = items.length - approvedCount;
    const householdCount = new Set(items.map((item) => item.householdId)).size;

    const payload: BulkCancelPreviewResponse = {
      startDate: body.startDate,
      endDate: body.endDate,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      locationId: body.locationId ?? null,
      locationName,
      approvedCount,
      pendingCount,
      householdCount,
      lessons: items,
    };
    res.json(payload);
  }),
);

// ── Confirm ───────────────────────────────────────────────────────────────────

// Sentinel thrown inside the confirm transaction when nothing in the range
// matches and no block was requested. Thrown (not returned) so the whole
// transaction rolls back and the bulk_cancellations parent row never leaks
// to disk. Caught at the route boundary, converted to a 422 response.
class EmptyConfirmError extends Error {
  constructor() {
    super("empty_confirm");
    this.name = "EmptyConfirmError";
  }
}

// Maximum selectable range for a single bulk cancel. 90 days is independent
// of `bookingMaxAdvanceWeeks` so a coach can still bulk-cancel coach-booked
// lessons that sit outside the parent booking window. See ADR 033.
const BULK_CANCEL_MAX_RANGE_DAYS = 90;

coachBulkCancelRouter.post(
  "/lessons/bulk-cancel",
  validate({ body: BulkCancelConfirmBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as BulkCancelConfirmBody;
    if (body.message !== undefined && body.message.length > BULK_CANCEL_MESSAGE_MAX_LENGTH) {
      res.status(422).json({ error: "message_too_long" });
      return;
    }
    const todayLaDate = getDateInLA(new Date());
    if (body.startDate < todayLaDate) {
      res.status(422).json({ error: "start_date_in_past" });
      return;
    }
    if (daysBetweenInclusive(body.startDate, body.endDate) > BULK_CANCEL_MAX_RANGE_DAYS) {
      res.status(422).json({ error: "range_too_large" });
      return;
    }

    const coachProfileId = req.profile.id;
    const message = body.message !== undefined && body.message.length > 0 ? body.message : null;

    const { startUtc, endUtc, laDates } = laRangeToUtcBounds(body.startDate, body.endDate);
    const siteUrl = getEnv().siteUrl;

    let transactionResult:
      | { kind: "block_only"; bulkCancellationId: string; blockApplied: boolean }
      | {
          kind: "done";
          bulkCancellationId: string;
          canceledLessonIds: string[];
          canceledLessonCount: number;
          declinedLessonCount: number;
          affectedHouseholdCount: number;
          outboxIds: string[];
          blockApplied: boolean;
        };
    try {
      transactionResult = await db.transaction(async (tx) => {
      // Deterministic lock order across every LA day in the range avoids
      // deadlocks against concurrent coach / parent writes that take the
      // same per-day advisory lock.
      for (const laDate of laDates) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"lesson-day:" + laDate}))`,
        );
      }

      // Insert the parent bulk_cancellations row first; outbox + audit rows
      // reference it inside this transaction. If the empty-case sentinel
      // throws below, this insert rolls back with the rest.
      const bulkInsert = await tx
        .insert(bulkCancellations)
        .values({
          coachProfileId,
          startDate: body.startDate,
          endDate: body.endDate,
          ...(body.locationId !== undefined && { locationId: body.locationId }),
          ...(body.startTime !== undefined && { startTime: body.startTime }),
          ...(body.endTime !== undefined && { endTime: body.endTime }),
          ...(message !== null && { message }),
        })
        .returning({ id: bulkCancellations.id });
      const bulkCancellationId = bulkInsert[0]!.id;

      const windowFilter =
        body.startTime !== undefined && body.endTime !== undefined
          ? { startTime: body.startTime, endTime: body.endTime }
          : null;

      const whereClauses = [
        inArray(lessons.status, ["approved", "pending"]),
        gte(lessons.startsAt, startUtc),
        lt(lessons.startsAt, endUtc),
      ];
      if (body.locationId !== undefined) {
        whereClauses.push(eq(lessons.locationId, body.locationId));
      }
      // Lock the broader LA-date range under the advisory per-day lock, then
      // filter by LA-wall-clock window overlap in memory. Rows outside the
      // window stay locked for the transaction but are not updated.
      const lockedRange = await tx
        .select()
        .from(lessons)
        .where(and(...whereClauses))
        .for("update");
      // SELECT ... FOR UPDATE on status IN ('approved','pending') lessons —
      // these are live by definition; narrow the schema-level widening so
      // household/location/actor fields read as non-null. ADR 034.
      const affected = lockedRange
        .filter((lesson) =>
          lessonOverlapsWindow(lesson.startsAt, lesson.durationMinutes, windowFilter),
        )
        .map(requireLiveLessonFields);

      if (affected.length === 0 && !body.blockRange) {
        // Throw so the whole transaction rolls back — the bulk_cancellations
        // parent row inserted above never commits.
        throw new EmptyConfirmError();
      }

      // Snapshot the coach's first name inside the transaction so a
      // concurrent profile rename can't race the payload we're about to
      // freeze into the per-household outbox rows.
      const coachFirstName = (await getActiveCoachProfile())?.firstName ?? null;

      const approvedToCancel = affected.filter((lesson) => lesson.status === "approved");
      const pendingToDecline = affected.filter((lesson) => lesson.status === "pending");
      const now = new Date();

      // Snapshot pre-bump sequences only for approved lessons (declined
      // pendings never had an invite, so no .ics / no sequence bump).
      const sequenceByLesson = new Map<string, number>();
      for (const lesson of approvedToCancel) {
        sequenceByLesson.set(lesson.id, lesson.calendarSequence);
      }
      const invitedIdSet = new Set(
        approvedToCancel
          .filter((lesson) => lesson.calendarInviteSentAt !== null)
          .map((lesson) => lesson.id),
      );

      if (approvedToCancel.length > 0) {
        await tx
          .update(lessons)
          .set({
            status: "canceled",
            canceledAt: now,
            canceledBy: coachProfileId,
            calendarSequence: sql`${lessons.calendarSequence} + 1` as unknown as number,
          })
          .where(inArray(lessons.id, approvedToCancel.map((lesson) => lesson.id)));
      }

      if (pendingToDecline.length > 0) {
        await tx
          .update(lessons)
          .set({
            status: "declined",
            declinedAt: now,
            declinedBy: coachProfileId,
            ...(message !== null && { declineReason: message }),
          })
          .where(inArray(lessons.id, pendingToDecline.map((lesson) => lesson.id)));
      }

      // ADR 036 §4: one refund_to_balance per affected lesson, in the
      // same tx as the status change. Acquire each household's balance
      // lock in a stable order (sorted by householdId) to keep the
      // global acquire order consistent — day locks first (above), then
      // balance locks. refundLessonCharge no-ops on free lessons and
      // pre-Phase-4 rows (nothing to invert). Decline + cancel both
      // qualify — ADR 036 §4 "cancellations, declines, bulk-cancels …
      // refund in full".
      const householdsToRefund = Array.from(
        new Set(affected.map((lesson) => lesson.householdId)),
      ).sort();
      for (const hid of householdsToRefund) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"household-balance:" + hid}))`,
        );
      }
      for (const lesson of affected) {
        await refundLessonCharge(tx, {
          householdId: lesson.householdId,
          lessonId: lesson.id,
          actorId: coachProfileId,
        });
      }

      // Block the cleared range so the slot engine refuses rebooking.
      let blockApplied = false;
      if (body.blockRange) {
        if (windowFilter !== null) {
          // Time window: one blocked_times row per LA day covering only the
          // window. Pool-scoped when a pool was picked, pool-agnostic (null
          // locationId) otherwise so every pool is blocked for that window.
          const rowsToInsert = laDates.map((laDate) => ({
            startsAt: laToUtc(laDate, windowFilter.startTime),
            endsAt: laToUtc(laDate, windowFilter.endTime),
            ...(body.locationId !== undefined && { locationId: body.locationId }),
            note: "Bulk cancel",
          }));
          await tx.insert(blockedTimes).values(rowsToInsert);
        } else if (body.locationId !== undefined) {
          // Whole-day, pool-scoped: one blocked_times row per LA day covering
          // midnight-to-midnight at that pool only.
          const rowsToInsert = laDates.map((laDate) => {
            const nextDay = addDaysToLaDate(laDate, 1);
            return {
              startsAt: laToUtc(laDate, "00:00"),
              endsAt: laToUtc(nextDay, "00:00"),
              locationId: body.locationId!,
              note: "Bulk cancel",
            };
          });
          await tx.insert(blockedTimes).values(rowsToInsert);
        } else {
          // Whole-day, every pool: one day_off override spanning the range.
          await tx.insert(availabilityOverrides).values({
            kind: "day_off",
            startDate: body.startDate,
            endDate: body.endDate,
            note: "Bulk cancel",
          });
        }
        blockApplied = true;
      }

      if (affected.length === 0) {
        // blockRange-only invocation: nothing to email or audit beyond the
        // block itself. The bulk_cancellations row stays as the audit trail.
        return {
          kind: "block_only" as const,
          bulkCancellationId,
          blockApplied,
        };
      }

      // Group lessons by household for the per-family audit + outbox rows.
      // Load per-lesson swimmers + the full location set once so each
      // household's payload can be composed cheaply.
      const affectedIds = affected.map((lesson) => lesson.id);
      const perLessonSwimmerRows = await tx
        .select({
          lessonId: lessonSwimmers.lessonId,
          firstName: swimmers.firstName,
        })
        .from(lessonSwimmers)
        .innerJoin(swimmers, eq(swimmers.id, lessonSwimmers.swimmerId))
        .where(inArray(lessonSwimmers.lessonId, affectedIds))
        .orderBy(swimmers.firstName);
      const firstNamesByLesson = new Map<string, string[]>();
      for (const row of perLessonSwimmerRows) {
        const list = firstNamesByLesson.get(row.lessonId) ?? [];
        list.push(row.firstName);
        firstNamesByLesson.set(row.lessonId, list);
      }

      const locationIds = Array.from(new Set(affected.map((lesson) => lesson.locationId)));
      const locationRows = await tx
        .select({
          id: lessonLocations.id,
          name: lessonLocations.name,
          address: lessonLocations.address,
          city: lessonLocations.city,
          state: lessonLocations.state,
          zip: lessonLocations.zip,
          householdId: lessonLocations.householdId,
        })
        .from(lessonLocations)
        .where(inArray(lessonLocations.id, locationIds));
      const locationById = new Map<string, LessonEmailLocation>(
        locationRows.map((row) => [
          row.id,
          {
            id: row.id,
            name: row.name,
            address: row.address,
            city: row.city,
            state: row.state,
            zip: row.zip,
            isHomePool: row.householdId !== null,
          },
        ]),
      );

      const filterLocationName =
        body.locationId !== undefined
          ? locationById.get(body.locationId)?.name ?? null
          : null;

      const householdIds = Array.from(new Set(affected.map((lesson) => lesson.householdId)));
      const memberRows = await tx
        .select({
          householdId: householdMembers.householdId,
          profileId: householdMembers.profileId,
        })
        .from(householdMembers)
        .where(
          and(
            inArray(householdMembers.householdId, householdIds),
            inArray(householdMembers.role, ["owner", "manager"]),
          ),
        );
      const recipientsByHousehold = new Map<string, string[]>();
      for (const row of memberRows) {
        const list = recipientsByHousehold.get(row.householdId) ?? [];
        list.push(row.profileId);
        recipientsByHousehold.set(row.householdId, list);
      }

      const perHouseholdOutboxIds: string[] = [];
      for (const householdId of householdIds) {
        const householdApproved = approvedToCancel.filter(
          (lesson) => lesson.householdId === householdId,
        );
        const householdPending = pendingToDecline.filter(
          (lesson) => lesson.householdId === householdId,
        );
        const cancelledLessons: BulkCancelEmailCancelledLesson[] = householdApproved
          .slice()
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((lesson) => {
            const endsAt = new Date(
              lesson.startsAt.getTime() + lesson.durationMinutes * 60_000,
            );
            return {
              lessonId: lesson.id,
              startsAtUtc: lesson.startsAt.toISOString(),
              endsAtUtc: endsAt.toISOString(),
              startsAtLocalDisplay: formatLessonTimeDisplay(lesson.startsAt),
              durationMinutes: lesson.durationMinutes as 30 | 45 | 60,
              swimmerFirstNames: firstNamesByLesson.get(lesson.id) ?? [],
              location: locationById.get(lesson.locationId)!,
              calendarSequence: sequenceByLesson.get(lesson.id)!,
              wasInvited: invitedIdSet.has(lesson.id),
            };
          });
        const declinedRequests: BulkCancelEmailDeclinedRequest[] = householdPending
          .slice()
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((lesson) => ({
            lessonId: lesson.id,
            startsAtLocalDisplay: formatLessonTimeDisplay(lesson.startsAt),
            durationMinutes: lesson.durationMinutes as 30 | 45 | 60,
            swimmerFirstNames: firstNamesByLesson.get(lesson.id) ?? [],
            location: locationById.get(lesson.locationId)!,
          }));

        const payload: BulkCancelEmailPayload = {
          bulkCancellationId,
          householdId,
          startDateLocal: formatLaDate(body.startDate),
          endDateLocal: formatLaDate(body.endDate),
          startTimeLocal: windowFilter !== null ? formatLaTime(windowFilter.startTime) : null,
          endTimeLocal: windowFilter !== null ? formatLaTime(windowFilter.endTime) : null,
          locationName: filterLocationName,
          message,
          coachFirstName,
          deepLink: buildDashboardLink(siteUrl),
          cancelledLessons,
          declinedRequests,
        };

        const recipientProfileIds = recipientsByHousehold.get(householdId) ?? [];
        const anyInvited = cancelledLessons.some((lesson) => lesson.wasInvited);

        const outboxInsert = await tx
          .insert(lessonEmailOutbox)
          .values({
            bulkCancellationId,
            householdId,
            lessonId: null,
            batchId: null,
            event: "coach_bulk_cancel",
            sequence: 0,
            recipientProfileIds,
            ...(anyInvited && { icsMethod: "CANCEL" as const, icsSequence: 0 }),
            payload,
          })
          .returning({ id: lessonEmailOutbox.id });
        perHouseholdOutboxIds.push(outboxInsert[0]!.id);

        await tx.insert(householdAuditLog).values({
          householdId,
          actorId: coachProfileId,
          action: "lessons_bulk_canceled_by_coach",
          payload: {
            bulkCancellationId,
            canceledLessonIds: householdApproved.map((lesson) => lesson.id),
            declinedLessonIds: householdPending.map((lesson) => lesson.id),
            invitedLessonIds: householdApproved
              .filter((lesson) => invitedIdSet.has(lesson.id))
              .map((lesson) => lesson.id),
          },
        });
      }

      return {
        kind: "done" as const,
        bulkCancellationId,
        canceledLessonIds: approvedToCancel.map((lesson) => lesson.id),
        canceledLessonCount: approvedToCancel.length,
        declinedLessonCount: pendingToDecline.length,
        affectedHouseholdCount: householdIds.length,
        outboxIds: perHouseholdOutboxIds,
        blockApplied,
      };
    });
    } catch (err) {
      if (err instanceof EmptyConfirmError) {
        res.status(422).json({ error: "no_lessons_in_range" });
        return;
      }
      throw err;
    }

    if (transactionResult.kind === "block_only") {
      const response: BulkCancelConfirmResponse = {
        bulkCancellationId: transactionResult.bulkCancellationId,
        canceledLessonCount: 0,
        declinedLessonCount: 0,
        affectedHouseholdCount: 0,
        blockApplied: transactionResult.blockApplied,
      };
      res.json(response);
      return;
    }

    // Post-commit fan-out. Google Calendar sync per cancelled lesson so each
    // coach-side event is deleted. One outbox send per family. No coach
    // notification: the coach performed the operation.
    for (const lessonId of transactionResult.canceledLessonIds) {
      queueMicrotask(() => { void syncLessonToGoogle(lessonId); });
    }
    for (const outboxId of transactionResult.outboxIds) {
      queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxId); });
    }

    const response: BulkCancelConfirmResponse = {
      bulkCancellationId: transactionResult.bulkCancellationId,
      canceledLessonCount: transactionResult.canceledLessonCount,
      declinedLessonCount: transactionResult.declinedLessonCount,
      affectedHouseholdCount: transactionResult.affectedHouseholdCount,
      blockApplied: transactionResult.blockApplied,
    };
    res.json(response);
  }),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function laRangeToUtcBounds(startDate: string, endDate: string): {
  startUtc: Date;
  endUtc: Date;
  laDates: string[];
} {
  const startUtc = laToUtc(startDate, "00:00");
  const nextDayAfterEnd = addDaysToLaDate(endDate, 1);
  const endUtc = laToUtc(nextDayAfterEnd, "00:00");
  const laDates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    laDates.push(cursor);
    cursor = addDaysToLaDate(cursor, 1);
  }
  return { startUtc, endUtc, laDates };
}

// Inclusive day count between two LA calendar dates: start=end → 1,
// adjacent dates → 2, etc. Used to enforce BULK_CANCEL_MAX_RANGE_DAYS.
function daysBetweenInclusive(startDate: string, endDate: string): number {
  const parse = (dateStr: string): number =>
    Date.UTC(
      Number(dateStr.slice(0, 4)),
      Number(dateStr.slice(5, 7)) - 1,
      Number(dateStr.slice(8, 10)),
    );
  const diffMs = parse(endDate) - parse(startDate);
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

function addDaysToLaDate(dateStr: string, days: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  asUtc.setUTCDate(asUtc.getUTCDate() + days);
  const y = asUtc.getUTCFullYear().toString().padStart(4, "0");
  const m = (asUtc.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = asUtc.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatLaDate(dateStr: string): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LESSON_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(anchor);
}

function buildDashboardLink(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/dashboard`;
}

// Overlap check for the optional LA wall-clock window. Null `window` means
// "every time counts" (whole-day mode). When set, resolves windowStart/End
// to the lesson's LA calendar date so DST transitions are handled correctly
// (each day's window is anchored to that day's offset). Lesson boundary
// touching the window edge is NOT an overlap — matches the slot engine's
// strict-less-than overlap convention for blocked times.
function lessonOverlapsWindow(
  startsAt: Date,
  durationMinutes: number,
  window: { startTime: string; endTime: string } | null,
): boolean {
  if (window === null) return true;
  const laDate = getDateInLA(startsAt);
  const windowStartUtc = laToUtc(laDate, window.startTime);
  const windowEndUtc = laToUtc(laDate, window.endTime);
  const lessonStartMs = startsAt.getTime();
  const lessonEndMs = lessonStartMs + durationMinutes * 60_000;
  return lessonStartMs < windowEndUtc.getTime() && windowStartUtc.getTime() < lessonEndMs;
}

// "4:00 PM" style LA time label. Input is "HH:MM" (24h).
function formatLaTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => Number.parseInt(n, 10));
  const hour = h ?? 0;
  const minute = m ?? 0;
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const paddedMinute = minute.toString().padStart(2, "0");
  return `${displayHour}:${paddedMinute} ${period}`;
}
