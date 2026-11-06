// Transactional outbox writer for coach push notifications. Called inside
// the same db.transaction() as the state change it records (CLAUDE.md's
// audit-log rule). See ADR 031 and docs/plans/coach-alerts.md.
//
// Nothing in this module performs HTTP, push transport, or external
// requests. The sender (./sender.ts) picks up rows after commit.

import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { requireLiveLocationId } from "../../db/liveLesson";
import * as schema from "../../db/schema";
import {
  bookingBatches,
  coachNotifications,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { getEnv } from "../../lib/env";
import { getDateInLA } from "../../lib/slots";
import { formatLessonTimeDisplay } from "../emails/format";
import { computeUrgency } from "./urgency";

// Monday of the LA date `yyyy-mm-dd`. Pure string math on UTC-noon so DST
// shifts never move the pivot day.
function mondayOfLADate(dateStr: string): string {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(Date.UTC(year, month - 1, day + offset, 12));
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
}
import type {
  AutoApprovedPayload,
  BookingRequestBatchPayload,
  BookingRequestLessonPayload,
  CalendarDisconnectedPayload,
  CoachNotificationCategory,
  CoachNotificationPayload,
  CoachNotificationUrgency,
  DailySummaryPayload,
  ParentChangeBatchPayload,
  ParentChangeLessonPayload,
  RequestExpiringSoonPayload,
} from "./types";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueueCoachNotificationInput {
  // The coach's profile id. Call sites that run inside a parent-triggered
  // transaction resolve this via getActiveCoachProfile() before opening
  // the tx and pass it in.
  coachProfileId: string;
  category: CoachNotificationCategory;
  // Set for per-lesson categories: booking_request, request_expiring_soon,
  // parent_change, auto_approved_summary.
  lessonId?: string;
  // Set for batch_* categories.
  batchId?: string;
  // Only used by category='parent_change'. 'canceled' | 'rescheduled' |
  // 'batch_canceled_remaining'.
  changeKind?: "canceled" | "rescheduled" | "batch_canceled_remaining";
  // Reschedule only. Lesson's starts_at BEFORE the update.
  previousStartsAt?: Date | null;
  // Explicit payload for categories with no lesson/batch context. For
  // calendar_disconnected and daily_summary, callers build the payload
  // themselves since there's no lesson row to derive it from.
  calendarDisconnectedPayload?: CalendarDisconnectedPayload;
  dailySummaryPayload?: DailySummaryPayload;
  // Expiring reminders set this to the lesson's expires_at wall display.
  expiresAtLocalDisplay?: string;
  // Override the computed push_next_attempt_at. Used by the expiring-
  // reminder cron pass to shift the first attempt earlier when the normal
  // time would fall inside quiet hours.
  pushNextAttemptAt?: Date;
  // For category='booking_request' with batchId: true when every lesson in
  // the batch was auto-approved (pendingCount === 0). Routes the click
  // target to the batch detail page instead of the dashboard's requests
  // card. Pending batches (at least one lesson awaiting approval) keep the
  // dashboard link so the coach can review from the existing card.
  allAutoApproved?: boolean;
}

export interface EnqueueCoachNotificationResult {
  // The id of the inserted row, or null when the partial unique index
  // dropped the write (idempotent).
  notificationId: string | null;
}

// Fetches an active coach profile id for background hooks that don't have
// a request context. Routes under /coach already know their coach id via
// req.profile — those should NOT call this helper. See lib/coachProfile.ts.
export async function resolveCoachForNotification(tx: Tx): Promise<string | null> {
  const rows = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "coach")))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Insert one `coach_notifications` row INSIDE the given transaction. The
 * partial unique indexes handle idempotency on the expiring-reminder path
 * and the daily-summary path.
 *
 * Returns `{ notificationId }` — null when the partial unique index drops
 * the insert (idempotent no-op).
 */
export async function enqueueCoachNotification(
  tx: Tx,
  input: EnqueueCoachNotificationInput,
): Promise<EnqueueCoachNotificationResult> {
  const siteUrl = getEnv().siteUrl.replace(/\/+$/, "");
  let payload: CoachNotificationPayload;
  let clickUrl: string;
  let tag: string;
  let urgency: CoachNotificationUrgency = "standard";
  let lessonIdForRow: string | null = null;
  let batchIdForRow: string | null = null;

  if (input.category === "booking_request") {
    if (input.lessonId) {
      const built = await buildLessonBookingPayload(tx, input.lessonId);
      payload = built.payload;
      clickUrl = `${siteUrl}/coach/lessons/${input.lessonId}`;
      tag = `lesson:${input.lessonId}`;
      urgency = computeUrgency(built.startsAt);
      lessonIdForRow = input.lessonId;
    } else if (input.batchId) {
      const built = await buildBatchBookingPayload(tx, input.batchId);
      payload = built.payload;
      // Pending batches land on the dashboard with that batch's grouped
      // card auto-expanded (BookingRequestsCard reads ?batch=…) so the
      // coach can approve/decline each lesson. Fully auto-approved
      // batches have nothing to review there, so they go straight to the
      // batch detail page instead.
      clickUrl = input.allAutoApproved
        ? `${siteUrl}/coach/batches/${input.batchId}`
        : `${siteUrl}/dashboard?batch=${input.batchId}`;
      tag = `batch:${input.batchId}`;
      urgency = built.earliestStartsAt ? computeUrgency(built.earliestStartsAt) : "standard";
      batchIdForRow = input.batchId;
    } else {
      throw new Error("enqueueCoachNotification: booking_request needs lessonId or batchId");
    }
  } else if (input.category === "auto_approved_summary") {
    if (!input.lessonId) {
      throw new Error("enqueueCoachNotification: auto_approved_summary needs lessonId");
    }
    const built = await buildLessonPayloadForAutoApproved(tx, input.lessonId);
    payload = built.payload;
    // Per-lesson confirmation: route to that lesson's coach page, same
    // as new-request / cancellation / reschedule.
    clickUrl = `${siteUrl}/coach/lessons/${input.lessonId}`;
    tag = `lesson:${input.lessonId}`;
    urgency = computeUrgency(built.startsAt);
    lessonIdForRow = input.lessonId;
  } else if (input.category === "parent_change") {
    if (input.lessonId) {
      if (
        input.changeKind !== "canceled" &&
        input.changeKind !== "rescheduled"
      ) {
        throw new Error(
          "enqueueCoachNotification: parent_change (lesson) needs changeKind='canceled'|'rescheduled'",
        );
      }
      const built = await buildLessonParentChangePayload(
        tx,
        input.lessonId,
        input.changeKind,
        input.previousStartsAt ?? null,
      );
      payload = built.payload;
      clickUrl = `${siteUrl}/coach/lessons/${input.lessonId}`;
      tag = `lesson:${input.lessonId}`;
      urgency = computeUrgency(built.startsAt);
      lessonIdForRow = input.lessonId;
    } else if (input.batchId) {
      if (input.changeKind !== "batch_canceled_remaining") {
        throw new Error(
          "enqueueCoachNotification: parent_change (batch) needs changeKind='batch_canceled_remaining'",
        );
      }
      const built = await buildBatchParentChangePayload(tx, input.batchId);
      payload = built.payload;
      // Batch cancel-remaining opens the schedule's week view at the
      // Monday of the first canceled lesson's LA date so the coach lands
      // on the week with the gap.
      const weekDate = built.earliestStartsAt
        ? mondayOfLADate(getDateInLA(built.earliestStartsAt))
        : null;
      clickUrl = weekDate
        ? `${siteUrl}/coach/schedule?view=week&date=${weekDate}`
        : `${siteUrl}/coach/schedule?view=week`;
      tag = `batch:${input.batchId}`;
      urgency = built.earliestStartsAt ? computeUrgency(built.earliestStartsAt) : "standard";
      batchIdForRow = input.batchId;
    } else {
      throw new Error("enqueueCoachNotification: parent_change needs lessonId or batchId");
    }
  } else if (input.category === "request_expiring_soon") {
    if (!input.lessonId || !input.expiresAtLocalDisplay) {
      throw new Error(
        "enqueueCoachNotification: request_expiring_soon needs lessonId + expiresAtLocalDisplay",
      );
    }
    const built = await buildLessonExpiringPayload(
      tx,
      input.lessonId,
      input.expiresAtLocalDisplay,
    );
    payload = built.payload;
    clickUrl = `${siteUrl}/coach/lessons/${input.lessonId}`;
    tag = `lesson:${input.lessonId}`;
    urgency = computeUrgency(built.startsAt);
    lessonIdForRow = input.lessonId;
  } else if (input.category === "calendar_disconnected") {
    if (!input.calendarDisconnectedPayload) {
      throw new Error("enqueueCoachNotification: calendar_disconnected needs its payload");
    }
    payload = input.calendarDisconnectedPayload;
    clickUrl = `${siteUrl}/account`;
    tag = `calendar-disconnected:${input.coachProfileId}`;
    urgency = "urgent";
  } else {
    // daily_summary
    if (!input.dailySummaryPayload) {
      throw new Error("enqueueCoachNotification: daily_summary needs its payload");
    }
    payload = input.dailySummaryPayload;
    clickUrl = `${siteUrl}/coach/schedule`;
    tag = `daily-summary:${input.dailySummaryPayload.dateLocal}`;
    urgency = "standard";
  }

  const inserted = await tx
    .insert(coachNotifications)
    .values({
      profileId: input.coachProfileId,
      category: input.category,
      urgency,
      lessonId: lessonIdForRow,
      batchId: batchIdForRow,
      payload,
      clickUrl,
      tag,
      ...(input.pushNextAttemptAt ? { pushNextAttemptAt: input.pushNextAttemptAt } : {}),
    })
    .onConflictDoNothing()
    .returning({ id: coachNotifications.id });

  return { notificationId: inserted[0]?.id ?? null };
}

// ─── Payload builders ────────────────────────────────────────────────────

interface BuiltLesson {
  payload: BookingRequestLessonPayload;
  startsAt: Date;
}

async function buildLessonBookingPayload(tx: Tx, lessonId: string): Promise<BuiltLesson> {
  const base = await loadLessonBase(tx, lessonId);
  const payload: BookingRequestLessonPayload = {
    kind: "booking_request_lesson",
    listTitle: "New booking request",
    lessonId,
    swimmerFirstNamesWithInitial: base.swimmerFirstNamesWithInitial,
    swimmerFullNames: base.swimmerFullNames,
    startsAtLocalDisplay: base.startsAtLocalDisplay,
    locationName: base.locationName,
  };
  return { payload, startsAt: base.startsAt };
}

async function buildLessonPayloadForAutoApproved(
  tx: Tx,
  lessonId: string,
): Promise<{ payload: AutoApprovedPayload; startsAt: Date }> {
  const base = await loadLessonBase(tx, lessonId);
  const payload: AutoApprovedPayload = {
    kind: "auto_approved",
    listTitle: "Booking auto-approved",
    lessonId,
    swimmerFirstNamesWithInitial: base.swimmerFirstNamesWithInitial,
    swimmerFullNames: base.swimmerFullNames,
    startsAtLocalDisplay: base.startsAtLocalDisplay,
    locationName: base.locationName,
  };
  return { payload, startsAt: base.startsAt };
}

async function buildLessonParentChangePayload(
  tx: Tx,
  lessonId: string,
  changeKind: "canceled" | "rescheduled",
  previousStartsAt: Date | null,
): Promise<{ payload: ParentChangeLessonPayload; startsAt: Date }> {
  const base = await loadLessonBase(tx, lessonId);
  const payload: ParentChangeLessonPayload = {
    kind: "parent_change_lesson",
    listTitle: changeKind === "canceled" ? "Lesson canceled" : "Lesson moved",
    lessonId,
    changeKind,
    swimmerFirstNamesWithInitial: base.swimmerFirstNamesWithInitial,
    swimmerFullNames: base.swimmerFullNames,
    startsAtLocalDisplay: base.startsAtLocalDisplay,
    previousStartsAtLocalDisplay: previousStartsAt
      ? formatLessonTimeDisplay(previousStartsAt)
      : null,
    locationName: base.locationName,
  };
  return { payload, startsAt: base.startsAt };
}

async function buildLessonExpiringPayload(
  tx: Tx,
  lessonId: string,
  expiresAtLocalDisplay: string,
): Promise<{ payload: RequestExpiringSoonPayload; startsAt: Date }> {
  const base = await loadLessonBase(tx, lessonId);
  const payload: RequestExpiringSoonPayload = {
    kind: "request_expiring_soon",
    listTitle: "Request expiring soon",
    lessonId,
    swimmerFirstNamesWithInitial: base.swimmerFirstNamesWithInitial,
    swimmerFullNames: base.swimmerFullNames,
    startsAtLocalDisplay: base.startsAtLocalDisplay,
    expiresAtLocalDisplay,
    locationName: base.locationName,
  };
  return { payload, startsAt: base.startsAt };
}

interface LessonBase {
  startsAt: Date;
  startsAtLocalDisplay: string;
  locationName: string;
  swimmerFirstNamesWithInitial: string[];
  swimmerFullNames: string[];
}

async function loadLessonBase(tx: Tx, lessonId: string): Promise<LessonBase> {
  const lessonRows = await tx
    .select({
      startsAt: lessons.startsAt,
      locationId: lessons.locationId,
    })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  const rawLesson = lessonRows[0];
  if (!rawLesson) throw new Error(`enqueueCoachNotification: lesson ${lessonId} not found`);
  // ADR 034: coach notifications are only enqueued for live lessons; narrow.
  const lesson = requireLiveLocationId(rawLesson);

  const locationRows = await tx
    .select({ name: lessonLocations.name })
    .from(lessonLocations)
    .where(eq(lessonLocations.id, lesson.locationId))
    .limit(1);
  const locationName = locationRows[0]?.name ?? "the pool";

  const swimmerRows = await tx
    .select({ firstName: swimmers.firstName, lastName: swimmers.lastName })
    .from(lessonSwimmers)
    .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
    .where(eq(lessonSwimmers.lessonId, lessonId))
    .orderBy(swimmers.firstName);

  const swimmerFirstNamesWithInitial = swimmerRows.map((row) =>
    row.lastName.length > 0
      ? `${row.firstName} ${row.lastName.charAt(0)}.`
      : row.firstName,
  );
  const swimmerFullNames = swimmerRows.map(
    (row) => `${row.firstName} ${row.lastName}`.trim(),
  );

  return {
    startsAt: lesson.startsAt,
    startsAtLocalDisplay: formatLessonTimeDisplay(lesson.startsAt),
    locationName,
    swimmerFirstNamesWithInitial,
    swimmerFullNames,
  };
}

async function buildBatchBookingPayload(
  tx: Tx,
  batchId: string,
): Promise<{ payload: BookingRequestBatchPayload; earliestStartsAt: Date | null }> {
  const summary = await loadBatchSummary(tx, batchId);
  const payload: BookingRequestBatchPayload = {
    kind: "booking_request_batch",
    listTitle: "New batch request",
    batchId,
    lessonCount: summary.lessonCount,
    pendingCount: summary.pendingCount,
    approvedCount: summary.approvedCount,
    firstStartsAtLocalDisplay: summary.firstStartsAtLocalDisplay,
    lastStartsAtLocalDisplay: summary.lastStartsAtLocalDisplay,
    locationName: summary.locationName,
  };
  return { payload, earliestStartsAt: summary.earliestStartsAt };
}

async function buildBatchParentChangePayload(
  tx: Tx,
  batchId: string,
): Promise<{ payload: ParentChangeBatchPayload; earliestStartsAt: Date | null }> {
  const summary = await loadBatchSummary(tx, batchId);
  const payload: ParentChangeBatchPayload = {
    kind: "parent_change_batch",
    listTitle: "Batch canceled",
    batchId,
    changeKind: "batch_canceled_remaining",
    lessonCount: summary.lessonCount,
    locationName: summary.locationName,
  };
  return { payload, earliestStartsAt: summary.earliestStartsAt };
}

interface BatchSummary {
  lessonCount: number;
  pendingCount: number;
  approvedCount: number;
  firstStartsAtLocalDisplay: string;
  lastStartsAtLocalDisplay: string;
  locationName: string;
  earliestStartsAt: Date | null;
}

async function loadBatchSummary(tx: Tx, batchId: string): Promise<BatchSummary> {
  const batchRows = await tx
    .select({ householdId: bookingBatches.householdId })
    .from(bookingBatches)
    .where(eq(bookingBatches.id, batchId))
    .limit(1);
  if (!batchRows[0]) throw new Error(`enqueueCoachNotification: batch ${batchId} not found`);

  const batchLessons = await tx
    .select({
      startsAt: lessons.startsAt,
      status: lessons.status,
      locationId: lessons.locationId,
    })
    .from(lessons)
    .where(eq(lessons.batchId, batchId))
    .orderBy(lessons.startsAt);

  const lessonCount = batchLessons.length;
  const pendingCount = batchLessons.filter((row) => row.status === "pending").length;
  const approvedCount = batchLessons.filter((row) => row.status === "approved").length;
  const earliest = batchLessons[0]?.startsAt ?? null;
  const latest = batchLessons[batchLessons.length - 1]?.startsAt ?? null;

  let locationName = "the pool";
  const locationId = batchLessons[0]?.locationId;
  if (locationId) {
    const locationRows = await tx
      .select({ name: lessonLocations.name })
      .from(lessonLocations)
      .where(eq(lessonLocations.id, locationId))
      .limit(1);
    locationName = locationRows[0]?.name ?? locationName;
  }

  return {
    lessonCount,
    pendingCount,
    approvedCount,
    firstStartsAtLocalDisplay: earliest ? formatLessonTimeDisplay(earliest) : "",
    lastStartsAtLocalDisplay: latest ? formatLessonTimeDisplay(latest) : "",
    locationName,
    earliestStartsAt: earliest,
  };
}

// Re-export inArray for callers that need to seed/clean notifications in
// tests without re-importing drizzle-orm here.
export { inArray };
