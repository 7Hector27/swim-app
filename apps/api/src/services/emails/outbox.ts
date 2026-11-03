// Transactional outbox writer for parent booking emails. Called inside the
// same db.transaction() as the lesson change it records (CLAUDE.md's
// audit-log rule). See ADR 028 and docs/plans/parent-booking-emails.md.
//
// Nothing in this module performs HTTP, email render, or transport calls.
// The sender (./sender.ts) picks up rows after commit.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { DECLINE_REASON_MAX_LENGTH } from "@swim-app/shared";

import * as schema from "../../db/schema";
import {
  householdMembers,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../../db/schema";
import { getActiveCoachProfile } from "../../lib/coachProfile";
import { getEnv } from "../../lib/env";
import { buildDeepLink, formatLessonTimeDisplay } from "./format";
import type {
  EmailActorRole,
  IcsMethod,
  LessonEmailEvent,
  LessonEmailPayload,
} from "./types";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueueLessonEmailInput {
  lessonId: string;
  event: LessonEmailEvent;
  actorRole: EmailActorRole;
  // Who initiated the lesson. Only meaningful for event='lesson_confirmed'
  // (ADR 029). Omit for every other event; the stored payload field will be
  // null, and no template reads it.
  initiatedBy?: "parent" | "coach" | null;
  // Decline reason, if any. Only relevant for event='request_declined'.
  declineReason?: string | null;
  // For event='lesson_rescheduled': the lesson's starts_at BEFORE this
  // update, used to render the "Was: … / Now: …" block. The ics_sequence
  // bump happens here just like any other REQUEST.
  previousStartsAt?: Date | null;
  // Override which lesson state the payload describes. Used by the
  // approved→pending parent-reschedule case to emit a CANCEL row that
  // describes the OLD approved slot (status/startsAt/locationId from
  // before the UPDATE). When omitted, the helper describes the live row.
  describe?: {
    startsAt: Date;
    durationMinutes: number;
    locationId: string;
    expiresAt: Date | null;
  };
}

interface IcsDecision {
  method: IcsMethod | null;
  shouldMarkInviteSent: boolean;
}

// Events that always ship a METHOD:REQUEST invite.
const REQUEST_EVENTS = new Set<LessonEmailEvent>(["lesson_confirmed", "lesson_rescheduled"]);
// Events that ship METHOD:CANCEL iff a prior invite was issued (lessons.
// calendar_invite_sent_at IS NOT NULL). Pending-only variants send no .ics.
const CANCEL_IF_PRIOR_INVITE_EVENTS = new Set<LessonEmailEvent>([
  "lesson_canceled",
  "request_declined",
  "request_expired",
]);

/**
 * Insert one `lesson_email_outbox` row INSIDE the given transaction. Returns
 * the new row's id so the caller can hand it to a post-commit microtask
 * sender. Never throws except on true schema/DB failures — those bubble up
 * and roll the whole lesson transaction back, matching CLAUDE.md's
 * audit-log rule.
 */
export async function enqueueLessonEmail(
  tx: Tx,
  input: EnqueueLessonEmailInput,
): Promise<string> {
  // Fully live snapshot of the lesson row, needed for ics logic (sequence,
  // invite_sent_at) and payload (household/location). SELECT FOR UPDATE
  // guards against two concurrent writers both reading the same
  // calendar_sequence value and both using it.
  const lessonRows = await tx
    .select()
    .from(lessons)
    .where(eq(lessons.id, input.lessonId))
    .for("update")
    .limit(1);
  const lessonRow = lessonRows[0];
  if (!lessonRow) {
    throw new Error(`enqueueLessonEmail: lesson ${input.lessonId} not found`);
  }

  // Describe state: usually the live row, unless caller supplied an override.
  const describeStartsAt = input.describe?.startsAt ?? lessonRow.startsAt;
  const describeDurationMinutes = input.describe?.durationMinutes ?? lessonRow.durationMinutes;
  const describeLocationId = input.describe?.locationId ?? lessonRow.locationId;
  const describeExpiresAt =
    input.describe?.expiresAt !== undefined ? input.describe.expiresAt : lessonRow.expiresAt;

  const icsDecision = decideIcs(input.event, lessonRow.calendarInviteSentAt);

  // Snapshot calendar_sequence into ics_sequence and (if ics_method is
  // non-null) increment the lesson's counter in the same statement, so
  // the "next value to issue" semantics hold even under contention.
  let icsSequence: number | null = null;
  if (icsDecision.method !== null) {
    icsSequence = lessonRow.calendarSequence;
    const bumpUpdates: Partial<typeof lessons.$inferInsert> = {
      calendarSequence: sql`${lessons.calendarSequence} + 1` as unknown as number,
    };
    if (icsDecision.shouldMarkInviteSent && !lessonRow.calendarInviteSentAt) {
      bumpUpdates.calendarInviteSentAt = new Date();
    }
    await tx.update(lessons).set(bumpUpdates).where(eq(lessons.id, input.lessonId));
  }

  // Next (lesson_id, event) sequence for the outbox dedup key.
  const nextSequence = await nextOutboxSequence(tx, input.lessonId, input.event);

  // Household owner + manager recipient snapshot.
  const memberRows = await tx
    .select({ profileId: householdMembers.profileId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, lessonRow.householdId),
        inArray(householdMembers.role, ["owner", "manager"]),
      ),
    );
  const recipientProfileIds = memberRows.map((row) => row.profileId);

  // Swimmer first names (ordered to match the Google Calendar event title
  // in ADR 027 so a parent whose coach uses that integration sees matching
  // entries).
  const swimmerRows = await tx
    .select({ firstName: swimmers.firstName })
    .from(lessonSwimmers)
    .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
    .where(eq(lessonSwimmers.lessonId, input.lessonId))
    .orderBy(swimmers.firstName);
  const swimmerFirstNames = swimmerRows.map((row) => row.firstName);

  // Location detail for the LOCATION field + home-pool flag.
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
    .where(eq(lessonLocations.id, describeLocationId))
    .limit(1);
  const locationRow = locationRows[0];
  if (!locationRow) {
    throw new Error(
      `enqueueLessonEmail: location ${describeLocationId} not found for lesson ${input.lessonId}`,
    );
  }

  // Resolve the coach's first name once at write time via the shared helper
  // (same one Google Calendar sync uses). Snapshotting into the payload
  // means a rename or role change later never retroactively repaints a
  // scheduled email, and the renderer stays a pure function of the payload.
  // When multi-coach lands, the fix lives in lib/coachProfile.ts alone.
  const coachFirstName = (await getActiveCoachProfile())?.firstName ?? null;

  const endsAt = new Date(describeStartsAt.getTime() + describeDurationMinutes * 60_000);
  const siteUrl = getEnv().siteUrl;
  const payload: LessonEmailPayload = {
    lessonId: input.lessonId,
    startsAtUtc: describeStartsAt.toISOString(),
    endsAtUtc: endsAt.toISOString(),
    durationMinutes: describeDurationMinutes,
    startsAtLocalDisplay: formatLessonTimeDisplay(describeStartsAt),
    endsAtLocalDisplay: formatLessonTimeDisplay(endsAt),
    swimmerFirstNames,
    location: {
      id: locationRow.id,
      name: locationRow.name,
      address: locationRow.address,
      city: locationRow.city,
      state: locationRow.state,
      zip: locationRow.zip,
      isHomePool: locationRow.householdId !== null,
    },
    deepLink: buildDeepLink(siteUrl, input.lessonId),
    actorRole: input.actorRole,
    previousStartsAtUtc: input.previousStartsAt ? input.previousStartsAt.toISOString() : null,
    previousStartsAtLocalDisplay: input.previousStartsAt
      ? formatLessonTimeDisplay(input.previousStartsAt)
      : null,
    // Belt-and-braces cap. The request-level schema already bounds this,
    // but writing to the outbox is a persistence boundary — anything that
    // bypasses the schema (future callers, migrations, backfills) must not
    // park an unbounded blob of coach-entered text in payload.declineReason,
    // which lives up to 30 days before the retention scrub.
    declineReason:
      input.declineReason != null
        ? input.declineReason.slice(0, DECLINE_REASON_MAX_LENGTH)
        : null,
    expiresAtLocalDisplay:
      input.event === "booking_requested" && describeExpiresAt
        ? formatLessonTimeDisplay(describeExpiresAt)
        : null,
    expiryHoursBeforeStart:
      (input.event === "booking_requested" || input.event === "request_expired") && describeExpiresAt
        ? Math.max(
            0,
            Math.round(
              (describeStartsAt.getTime() - describeExpiresAt.getTime()) / (60 * 60 * 1000),
            ),
          )
        : null,
    coachFirstName,
    initiatedBy: input.initiatedBy ?? null,
  };

  const insertedRows = await tx
    .insert(lessonEmailOutbox)
    .values({
      lessonId: input.lessonId,
      event: input.event,
      sequence: nextSequence,
      recipientProfileIds,
      icsMethod: icsDecision.method,
      icsSequence,
      payload,
    })
    .returning({ id: lessonEmailOutbox.id });

  const insertedId = insertedRows[0]?.id;
  if (!insertedId) {
    throw new Error("enqueueLessonEmail: insert returned no id");
  }
  return insertedId;
}

function decideIcs(event: LessonEmailEvent, calendarInviteSentAt: Date | null): IcsDecision {
  if (REQUEST_EVENTS.has(event)) {
    return { method: "REQUEST", shouldMarkInviteSent: true };
  }
  if (CANCEL_IF_PRIOR_INVITE_EVENTS.has(event)) {
    if (calendarInviteSentAt) {
      return { method: "CANCEL", shouldMarkInviteSent: false };
    }
    return { method: null, shouldMarkInviteSent: false };
  }
  // booking_requested, or any future event with no invite semantics.
  return { method: null, shouldMarkInviteSent: false };
}

// Returns the next (lesson_id, event) occurrence counter. No explicit lock
// is needed on this read: every outbox write happens inside a transaction
// that has already taken `SELECT ... FOR UPDATE` on the lesson row (see
// the start of enqueueLessonEmail), and every lesson-mutating route holds
// the same row lock. That serializes all outbox writes PER LESSON, so two
// concurrent callers can never read `max(sequence)` for the same lesson
// and race. The `UNIQUE (lesson_id, event, sequence)` constraint is the
// backstop for any unexpected path that bypasses the lesson lock.
async function nextOutboxSequence(tx: Tx, lessonId: string, event: LessonEmailEvent): Promise<number> {
  const rows = await tx
    .select({ max: sql<number | null>`max(${lessonEmailOutbox.sequence})` })
    .from(lessonEmailOutbox)
    .where(and(eq(lessonEmailOutbox.lessonId, lessonId), eq(lessonEmailOutbox.event, event)));
  const current = rows[0]?.max ?? 0;
  return current + 1;
}
