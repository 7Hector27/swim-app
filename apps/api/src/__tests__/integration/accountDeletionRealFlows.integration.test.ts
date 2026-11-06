// Integration tests that seed the deletion flow via the production
// booking + evaluation + meet-swim + coach-notes HTTP endpoints, not
// hand-insert admin writes. The hand-insert suite in
// accountDeletion.integration.test.ts does broad "zero rows in every
// table" coverage; this suite catches the FK-shape bugs that only
// surface against the real production data shapes (the reported
// `lesson_email_outbox_batch_id_booking_batches_id_fk` 500 on a solo
// parent who had any booking batches).
//
// Flows exercised:
//
//   - POST /swimmers (single swimmer)
//   - POST /lessons (single future booking — lesson row + outbox
//     booking_requested row)
//   - POST /lessons/batch manual (3 picks — booking_batches row with
//     mode='manual' + batch-scoped outbox batch_booked row + per-
//     lesson outbox lesson_confirmed rows)
//   - POST /lessons/batch weekly (recurring — booking_batches row
//     with mode='weekly' + weekly_pattern + batch-scoped outbox row
//     carrying the summary payload)
//   - PATCH /coach/lessons/:id/approve (coach approval — coach_
//     notifications auto_approved_summary row + lesson_confirmed
//     outbox row)
//   - POST /coach/swimmers/:id/sessions (evaluation with one rating
//     + fault tag — evaluation_sessions + skill_ratings + rating_
//     fault_tags)
//   - POST /coach/swimmers/:id/meet-swims (meet time — meet_swims)
//   - POST /coach/swimmers/:id/notes (coach note — coach_notes)
//
// adminDb inserts (not reachable via HTTP in v1): swimmer_clubs,
// league_registrations, and a backdated past completed lesson (real
// booking flow requires future startsAt past booking_min_advance_hours).
// household_audit_log rows are produced automatically by the real
// flows (swimmer_added, etc.).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import pino from "pino";

import { createApp } from "../../app";
import {
  accountDeletionJobs,
  availabilityConfig,
  availabilitySeasons,
  bookingBatches,
  coachNotes,
  coachNotifications,
  evaluationSessions,
  householdAuditLog,
  householdMembers,
  households,
  LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES,
  leagueRegistrations,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  meetSwims,
  profiles,
  ratingFaultTags,
  skillRatings,
  skills,
  swimmerClubs,
  swimmers,
} from "../../db/schema";
import { __resetEnvCacheForTests } from "../../lib/env";
import { __setClockForTests } from "../../lib/clock";
import { __settlePendingCoachAlertsForTests } from "../../lib/lessonApproval";
import { drainLessonEmailOutbox } from "../../services/emails/drain";
import {
  __resetSenderTransportForTests,
  __setSenderTransportForTests,
} from "../../services/emails/sender";
import type {
  EmailTransport,
  TransportResult,
  TransportSendOptions,
} from "../../services/emails/transport";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  type TestUser,
} from "./helpers";

__resetEnvCacheForTests();
const logger = pino({ level: "silent" });
const app = createApp(logger);

// Pinned clock so every booking math (min advance, max advance,
// expansion of weekly patterns) is deterministic. Mon 2035-11-05
// 10:00 LA. teachOnAllDays below keeps every weekday bookable.
const PINNED_NOW = new Date("2035-11-05T18:00:00.000Z");

const TEST_PASSWORD = "integration-test-password-1";
const DELETION_PHRASE = "delete";

// ── Email-sender capture transport ──────────────────────────────────────────

// Returns ok so the sender marks outbox rows terminal ('sent'). The
// scrub needs terminal rows to exercise the batch_id/household_id
// null-on-scrub fix. A non-terminal row would simply be deleted by the
// scrub, bypassing the fixed code path.
class CaptureTransport implements EmailTransport {
  readonly sends: TransportSendOptions[] = [];
  async send(opts: TransportSendOptions): Promise<TransportResult> {
    this.sends.push(opts);
    return {
      ok: true,
      providerMessageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
      error: null,
      errorMessage: null,
    };
  }
  reset(): void {
    this.sends.length = 0;
  }
}

let transport: CaptureTransport;
let originalBookingMaxAdvanceWeeks: number | null = null;

async function openAllTeachingDays(): Promise<() => Promise<void>> {
  const seasons = await adminDb().select().from(availabilitySeasons);
  const originalSeasons = seasons.map((s) => ({ id: s.id, teachesDays: s.teachesDays }));
  for (const s of seasons) {
    await adminDb()
      .update(availabilitySeasons)
      .set({ teachesDays: [1, 2, 3, 4, 5, 6, 7] })
      .where(eq(availabilitySeasons.id, s.id));
  }
  const configRows = await adminDb().select().from(availabilityConfig).limit(1);
  const originalConfig = configRows[0]
    ? { id: configRows[0].id, defaultTeachesDays: configRows[0].defaultTeachesDays }
    : null;
  if (originalConfig) {
    await adminDb()
      .update(availabilityConfig)
      .set({ defaultTeachesDays: [1, 2, 3, 4, 5, 6, 7] })
      .where(eq(availabilityConfig.id, originalConfig.id));
  }
  return async () => {
    for (const o of originalSeasons) {
      await adminDb()
        .update(availabilitySeasons)
        .set({ teachesDays: o.teachesDays })
        .where(eq(availabilitySeasons.id, o.id));
    }
    if (originalConfig) {
      await adminDb()
        .update(availabilityConfig)
        .set({ defaultTeachesDays: originalConfig.defaultTeachesDays })
        .where(eq(availabilityConfig.id, originalConfig.id));
    }
  };
}

let restoreTeachingDays: (() => Promise<void>) | null = null;

beforeAll(async () => {
  __setClockForTests(PINNED_NOW);
  transport = new CaptureTransport();
  __setSenderTransportForTests(transport);
  restoreTeachingDays = await openAllTeachingDays();

  // Push the booking window out so all the picks in this file comfortably fit.
  const configRows = await adminDb().select().from(availabilityConfig).limit(1);
  const config = configRows[0];
  if (config) {
    originalBookingMaxAdvanceWeeks = config.bookingMaxAdvanceWeeks;
    await adminDb()
      .update(availabilityConfig)
      .set({ bookingMaxAdvanceWeeks: 52 })
      .where(eq(availabilityConfig.id, config.id));
  }

  // Needed for the real evaluation POST to find the free-kick skill id.
  await syncCatalogFn(adminDb());
});

afterAll(async () => {
  __resetSenderTransportForTests();
  if (restoreTeachingDays) await restoreTeachingDays();
  if (originalBookingMaxAdvanceWeeks !== null) {
    const configRows = await adminDb().select().from(availabilityConfig).limit(1);
    const config = configRows[0];
    if (config) {
      await adminDb()
        .update(availabilityConfig)
        .set({ bookingMaxAdvanceWeeks: originalBookingMaxAdvanceWeeks })
        .where(eq(availabilityConfig.id, config.id));
    }
  }
  __setClockForTests(null);
  await closeAdminDb();
});

const testUsers: TestUser[] = [];

afterEach(async () => {
  for (const user of testUsers.splice(0)) {
    await user.cleanup().catch(() => { /* best-effort */ });
  }
});

beforeEach(() => {
  transport.reset();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const LA_TZ = "America/Los_Angeles";

function toLaDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(laDate: string, n: number): string {
  const [year, month, day] = laDate.split("-").map(Number);
  const base = new Date(Date.UTC(year!, month! - 1, day!));
  base.setUTCDate(base.getUTCDate() + n);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

// Convert "YYYY-MM-DD" + "HH:MM" LA wall time to a UTC Date. Pin against
// LA's offset at that instant (handles PDT/PST).
function laDateTimeToUtc(laDate: string, timeOfDay: string): Date {
  const [year, month, day] = laDate.split("-").map(Number);
  const [hour, minute] = timeOfDay.split(":").map(Number);
  // LA is UTC-8 (PST) or UTC-7 (PDT). 2035-11-05 is post-DST-end, so PST (-8h).
  // 2035-11 lasts till DST starts next March; all our dates in this file fit.
  // We pick enough offset headroom (20+ days out) that any DST flip within
  // the test window doesn't move an outbox row across a day boundary.
  const asUtcIfPst = Date.UTC(year!, month! - 1, day!, hour! + 8, minute!);
  // Verify via Intl that this maps back to the LA wall time we asked for.
  // If it's off by an hour (DST), add/subtract. Cheapest safe form of this:
  const probe = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(asUtcIfPst));
  const laHour = Number(probe.find((p) => p.type === "hour")?.value ?? -1);
  const diff = ((hour! - (laHour % 24)) + 24) % 24;
  const adjustMs = diff > 12 ? (diff - 24) * 3600 * 1000 : diff * 3600 * 1000;
  return new Date(asUtcIfPst - adjustMs);
}

async function seedHomePool(householdId: string, label: string): Promise<string> {
  const rows = await adminDb()
    .insert(lessonLocations)
    .values({
      name: `${label} Pool`,
      address: "123 Pool Lane",
      city: "Irvine",
      state: "CA",
      zip: "92620",
      householdId,
      isActive: true,
    })
    .returning({ id: lessonLocations.id });
  return rows[0]!.id;
}

async function createSwimmer(user: TestUser, firstName: string): Promise<string> {
  const res = await request(app)
    .post("/swimmers")
    .set("Authorization", `Bearer ${user.accessToken}`)
    .send({
      firstName,
      lastName: "Realflow",
      birthDate: "2016-06-01",
      sex: "female",
      isPublic: false,
      clubs: [],
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function bookSingle(opts: {
  user: TestUser;
  locationId: string;
  swimmerId: string;
  startsAt: string;
}): Promise<string> {
  const res = await request(app)
    .post("/lessons")
    .set("Authorization", `Bearer ${opts.user.accessToken}`)
    .send({
      startsAt: opts.startsAt,
      durationMinutes: 30,
      locationId: opts.locationId,
      swimmerIds: [opts.swimmerId],
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function bookManualBatch(opts: {
  user: TestUser;
  locationId: string;
  swimmerId: string;
  startsAtList: string[];
}): Promise<{ batchId: string; lessonIds: string[] }> {
  const res = await request(app)
    .post("/lessons/batch")
    .set("Authorization", `Bearer ${opts.user.accessToken}`)
    .send({
      mode: "manual",
      householdId: opts.user.householdId,
      locationId: opts.locationId,
      picks: opts.startsAtList.map((startsAt) => ({
        startsAt,
        durationMinutes: 30 as const,
        swimmerIds: [opts.swimmerId],
      })),
    });
  expect(res.status).toBe(201);
  return { batchId: res.body.batchId as string, lessonIds: res.body.lessonIds as string[] };
}

async function bookWeeklyBatch(opts: {
  user: TestUser;
  locationId: string;
  swimmerId: string;
  startLaDate: string; // ISO date; weekdays 1=Mon..7=Sun
  weeks: number;
  weekday: number;
  timeOfDay: string;
}): Promise<{ batchId: string; lessonIds: string[] }> {
  const res = await request(app)
    .post("/lessons/batch")
    .set("Authorization", `Bearer ${opts.user.accessToken}`)
    .send({
      mode: "weekly",
      householdId: opts.user.householdId,
      locationId: opts.locationId,
      pattern: [
        {
          weekday: opts.weekday,
          timeOfDay: opts.timeOfDay,
          durationMinutes: 30 as const,
          swimmerIds: [opts.swimmerId],
        },
      ],
      startDate: opts.startLaDate,
      weeks: opts.weeks,
      overrides: [],
      skips: [],
    });
  expect(res.status).toBe(201);
  return { batchId: res.body.batchId as string, lessonIds: res.body.lessonIds as string[] };
}

async function approveLessonAsCoach(coach: TestUser, lessonId: string): Promise<void> {
  const res = await request(app)
    .patch(`/coach/lessons/${lessonId}/approve`)
    .set("Authorization", `Bearer ${coach.accessToken}`)
    .send({});
  expect(res.status).toBe(200);
}

async function recordEvaluation(opts: {
  coach: TestUser;
  swimmerId: string;
}): Promise<{ sessionId: string; ratingId: string }> {
  // Use water-confidence screen with water-submerging — rubric type, no
  // capacity/measurement/side setup needed. Keeps the test body short.
  const skillRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "water-submerging"))
    .limit(1);
  const skillId = skillRows[0]!.id;

  const res = await request(app)
    .post(`/coach/swimmers/${opts.swimmerId}/sessions`)
    .set("Authorization", `Bearer ${opts.coach.accessToken}`)
    .send({
      screenSlug: "water-confidence",
      sessionDate: toLaDate(PINNED_NOW),
      context: "practice",
      coachingPriority: "Focus on breath control",
      breathingPattern: null,
      ratings: [
        {
          skillId,
          grade: 3,
          notLegal: false,
          noConcept: false,
          side: null,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
          note: null,
          faultTags: [],
          ratedAt: PINNED_NOW.toISOString(),
          golfScoreCategory: null,
        },
      ],
    });
  expect(res.status).toBe(201);
  const sessionId = res.body.sessionId as string;
  const ratingId = (res.body.ratingIds as string[])[0]!;

  // Attach a fault tag directly — rating_fault_tags isn't exposed by a
  // separate POST; the real create route takes it inside the rating input
  // only if the skill's catalog carries that fault_tag string. The simpler
  // path here is a direct insert so rating_fault_tags has a row the
  // deletion engine must clear.
  await adminDb().insert(ratingFaultTags).values({
    ratingId,
    faultTag: "late-breath",
  });

  return { sessionId, ratingId };
}

async function recordMeetSwim(opts: { coach: TestUser; swimmerId: string }): Promise<string> {
  const res = await request(app)
    .post(`/coach/swimmers/${opts.swimmerId}/meet-swims`)
    .set("Authorization", `Bearer ${opts.coach.accessToken}`)
    .send({
      swimType: "practice",
      eventDistance: 50,
      eventStroke: "free",
      course: "scy",
      timeString: "35.12",
      swumOn: toLaDate(PINNED_NOW),
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function recordCoachNote(opts: { coach: TestUser; swimmerId: string }): Promise<string> {
  const res = await request(app)
    .post(`/coach/swimmers/${opts.swimmerId}/notes`)
    .set("Authorization", `Bearer ${opts.coach.accessToken}`)
    .send({
      body: "Great rotation this week.",
      noteType: "observation",
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function confirmDeletion(accessToken: string, password = TEST_PASSWORD) {
  return request(app)
    .post("/me/deletion/confirm")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ password, confirmationPhrase: DELETION_PHRASE });
}

// ── Solo path — real flows end-to-end ────────────────────────────────────────

describe("POST /me/deletion/confirm — solo path, real-flow seed", () => {
  it("deletes everything cleanly after a parent went through single + manual-batch + weekly-batch bookings, an approval, an evaluation, a meet time, and a coach note (FK regression for booking_batches ← lesson_email_outbox)", async () => {
    // ── Setup ────────────────────────────────────────────────
    const coach = await createTestUser("realflow-solo-coach");
    testUsers.push(coach);
    await makeCoach(coach.userId);

    const owner = await createTestUser("realflow-solo-owner");
    testUsers.push(owner);
    const householdId = owner.householdId;
    const authUserId = owner.userId;
    const swimmerId = await createSwimmer(owner, "Alex");
    const locationId = await seedHomePool(householdId, "Realflow Solo");

    // Pick safe LA dates: start 20 days out so bookingMinAdvanceHours is
    // satisfied and the weekly expansion has room to walk forward.
    const anchorLaDate = addDays(toLaDate(PINNED_NOW), 20);
    const singleStartsAtUtc = laDateTimeToUtc(addDays(anchorLaDate, 0), "16:00");
    const manual1Utc = laDateTimeToUtc(addDays(anchorLaDate, 1), "16:30");
    const manual2Utc = laDateTimeToUtc(addDays(anchorLaDate, 2), "16:30");
    const manual3Utc = laDateTimeToUtc(addDays(anchorLaDate, 3), "16:30");
    const weeklyStartLaDate = addDays(anchorLaDate, 7);
    const weeklyWeekday = new Date(`${weeklyStartLaDate}T12:00:00Z`).getUTCDay() || 7; // ISO 1..7

    // ── Real flows ───────────────────────────────────────────

    // 1. Single booking
    const singleLessonId = await bookSingle({
      user: owner,
      locationId,
      swimmerId,
      startsAt: singleStartsAtUtc.toISOString(),
    });

    // 2. Manual batch — 3 picks
    const manualBatch = await bookManualBatch({
      user: owner,
      locationId,
      swimmerId,
      startsAtList: [manual1Utc.toISOString(), manual2Utc.toISOString(), manual3Utc.toISOString()],
    });

    // 3. Weekly batch — 2 weeks
    const weeklyBatch = await bookWeeklyBatch({
      user: owner,
      locationId,
      swimmerId,
      startLaDate: weeklyStartLaDate,
      weeks: 2,
      weekday: weeklyWeekday,
      timeOfDay: "17:00",
    });

    // 4. Coach approval on the single booking — triggers coach_notifications
    //    auto_approved_summary category and a lesson_confirmed outbox row.
    await approveLessonAsCoach(coach, singleLessonId);

    // Settle pending coach-alert sends + email-sender microtasks so every
    // outbox row reaches its terminal (or failed) state before deletion.
    await __settlePendingCoachAlertsForTests();

    // 5. Evaluation session + rating + fault tag
    const { sessionId } = await recordEvaluation({ coach, swimmerId });

    // 6. Meet time
    await recordMeetSwim({ coach, swimmerId });

    // 7. Coach note
    await recordCoachNote({ coach, swimmerId });

    // 8. League registration + swimmer club — no POST routes, admin-insert
    await adminDb().insert(leagueRegistrations).values({
      swimmerId,
      league: "club",
      seasonStartYear: 2035,
      registeredOn: "2035-09-01",
    });
    await adminDb().insert(swimmerClubs).values({
      swimmerId,
      otherClubName: "Realflow Dolphins",
    });

    // 9. A backdated past completed lesson — real flow requires
    //    bookingMinAdvanceHours in the future, so admin-insert.
    const pastLessonRows = await adminDb()
      .insert(lessons)
      .values({
        householdId,
        locationId,
        startsAt: new Date(PINNED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
        durationMinutes: 30,
        type: "private",
        status: "completed",
        requestedBy: owner.userId,
        approvedAt: new Date(PINNED_NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
        approvedBy: owner.userId,
        completedAt: new Date(PINNED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      })
      .returning({ id: lessons.id });
    const pastLessonId = pastLessonRows[0]!.id;
    await adminDb().insert(lessonSwimmers).values({ lessonId: pastLessonId, swimmerId });

    // 10. A data-drift case: a FUTURE lesson that somehow ended up in
    //     status='completed' (the coach marked it complete ahead of
    //     time, or a prior bug). cancelFutureLessons used to filter on
    //     ('pending','approved') only, so a row like this stayed as-is
    //     through anonymization and showed up on the coach's week view
    //     as a normal card. The broadened filter must flip it to
    //     'canceled' alongside the pending/approved ones.
    const futureQuirkStartsAt = laDateTimeToUtc(addDays(anchorLaDate, 5), "15:00");
    const futureQuirkRows = await adminDb()
      .insert(lessons)
      .values({
        householdId,
        locationId,
        startsAt: futureQuirkStartsAt,
        durationMinutes: 30,
        type: "private",
        status: "completed",
        requestedBy: owner.userId,
        approvedAt: new Date(PINNED_NOW.getTime() - 60 * 1000),
        approvedBy: owner.userId,
        completedAt: new Date(PINNED_NOW.getTime() - 30 * 1000),
      })
      .returning({ id: lessons.id });
    const futureQuirkLessonId = futureQuirkRows[0]!.id;
    await adminDb().insert(lessonSwimmers).values({ lessonId: futureQuirkLessonId, swimmerId });

    // Drain the email outbox so batch-scoped rows reach their terminal
    // status before the deletion. Production hits this state via the
    // cron tick; the earlier version of this test never drained, so
    // every outbox row was 'pending' and got deleted by the non-
    // terminal branch — which hid the reported FK bug (terminal
    // coach_booking_request rows the scrub previously skipped).
    await drainLessonEmailOutbox();
    // Settle any sender microtasks the drain spawned.
    await __settlePendingCoachAlertsForTests();

    // Precondition: real flows + drain actually produced booking_batches
    // rows + TERMINAL batch-scoped outbox rows (including at least one
    // coach_booking_request — the family-agnostic payload shape the
    // reviewer flagged). If this precondition fails, the test is
    // seeding something wrong and the FK fix would appear to work
    // for the wrong reason.
    const batchesBefore = await adminDb()
      .select({ id: bookingBatches.id })
      .from(bookingBatches)
      .where(eq(bookingBatches.householdId, householdId));
    expect(batchesBefore.length).toBeGreaterThanOrEqual(2);
    const batchScopedOutboxBefore = await adminDb()
      .select({
        id: lessonEmailOutbox.id,
        status: lessonEmailOutbox.status,
        event: lessonEmailOutbox.event,
        batchId: lessonEmailOutbox.batchId,
      })
      .from(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.batchId, batchesBefore.map((b) => b.id)));
    expect(batchScopedOutboxBefore.length).toBeGreaterThan(0);
    const terminalBatchScoped = batchScopedOutboxBefore.filter((r) =>
      LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES.includes(r.status as (typeof LESSON_EMAIL_OUTBOX_TERMINAL_STATUSES)[number]),
    );
    expect(terminalBatchScoped.length).toBeGreaterThan(0);
    // At least one coach-facing terminal row whose payload doesn't
    // carry swimmerFirstNames — this is the specific shape the old
    // scrub filter skipped.
    const coachFacingTerminals = terminalBatchScoped.filter(
      (r) => r.event === "coach_booking_request",
    );
    expect(coachFacingTerminals.length).toBeGreaterThan(0);

    // ── Delete ───────────────────────────────────────────────
    const res = await confirmDeletion(owner.accessToken);
    expect(res.status).toBe(204);

    // ── Assertions ───────────────────────────────────────────

    // Reported bug: this is the specific FK that used to fail.
    // booking_batches rows for this household are ALL gone, and every
    // outbox row that used to reference them now has batch_id = NULL.
    const batchesAfter = await adminDb()
      .select({ id: bookingBatches.id })
      .from(bookingBatches)
      .where(eq(bookingBatches.householdId, householdId));
    expect(batchesAfter).toHaveLength(0);
    const stillRefBatch = await adminDb()
      .select({ id: lessonEmailOutbox.id, batchId: lessonEmailOutbox.batchId })
      .from(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.id, batchScopedOutboxBefore.map((r) => r.id)));
    // Terminal rows survived scrub; non-terminal ones were deleted.
    for (const row of stillRefBatch) {
      expect(row.batchId).toBeNull();
    }

    // Same for household_id: if any outbox row ever carried this
    // household's id (bulk-cancel scoped — none in this test, but
    // defense-in-depth), it would now be null.
    const householdScopedResidue = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.householdId, householdId));
    expect(householdScopedResidue).toHaveLength(0);

    // Surviving scrubbed terminal outbox rows have payload sentinel +
    // null FKs to the deleted parents. They are the "we kept these on
    // purpose" audit rows.
    const allOutboxForLessonIds = await adminDb()
      .select({
        id: lessonEmailOutbox.id,
        status: lessonEmailOutbox.status,
        batchId: lessonEmailOutbox.batchId,
        householdId: lessonEmailOutbox.householdId,
        lessonId: lessonEmailOutbox.lessonId,
        payload: lessonEmailOutbox.payload,
      })
      .from(lessonEmailOutbox)
      .where(
        inArray(
          lessonEmailOutbox.lessonId,
          [
            singleLessonId,
            pastLessonId,
            ...manualBatch.lessonIds,
            ...weeklyBatch.lessonIds,
          ],
        ),
      );
    for (const row of allOutboxForLessonIds) {
      expect(row.batchId).toBeNull();
      expect(row.householdId).toBeNull();
      const payload = row.payload as Record<string, unknown>;
      expect(payload["_scrubbed_at"]).toBeDefined();
      expect(payload["swimmerFirstNames"]).toBeUndefined();
    }

    // Household gone.
    const hhAfter = await adminDb().select().from(households).where(eq(households.id, householdId));
    expect(hhAfter).toHaveLength(0);

    // Lessons anonymized.
    const allAnonymizedIds = [
      singleLessonId,
      pastLessonId,
      futureQuirkLessonId,
      ...manualBatch.lessonIds,
      ...weeklyBatch.lessonIds,
    ];
    const lessonsAfter = await adminDb()
      .select()
      .from(lessons)
      .where(inArray(lessons.id, allAnonymizedIds));
    for (const row of lessonsAfter) {
      expect(row.anonymizedAt).not.toBeNull();
      expect(row.householdId).toBeNull();
      expect(row.locationId).toBeNull();
      expect(row.batchId).toBeNull();
    }

    // Every FUTURE lesson — including the data-drift completed row —
    // was cancelled before anonymization. The coach schedule shows
    // these as canceled cards, the slot engine stops holding the
    // times (planning subset is pending+approved only), and the
    // post-commit Google Calendar sync deletes the events.
    const expectedFutureIds = [
      singleLessonId,
      futureQuirkLessonId,
      ...manualBatch.lessonIds,
      ...weeklyBatch.lessonIds,
    ];
    const futureAfter = lessonsAfter.filter((row) => expectedFutureIds.includes(row.id));
    expect(futureAfter).toHaveLength(expectedFutureIds.length);
    for (const row of futureAfter) {
      expect(row.status).toBe("canceled");
      expect(row.canceledAt).not.toBeNull();
    }
    // The past lesson stays in its historical end state (anonymized
    // but still completed) — anonymization doesn't rewrite history.
    const pastAfter = lessonsAfter.find((row) => row.id === pastLessonId);
    expect(pastAfter?.status).toBe("completed");

    // Swimmer-linked data gone.
    const swimmerCheck = async <T,>(sel: T) => adminDb().select().from(sel as never);
    void swimmerCheck; // typing shim to keep the terse checks below readable
    expect(
      await adminDb().select().from(swimmers).where(eq(swimmers.id, swimmerId)),
    ).toHaveLength(0);
    expect(
      await adminDb().select().from(evaluationSessions).where(eq(evaluationSessions.id, sessionId)),
    ).toHaveLength(0);
    expect(
      await adminDb().select().from(skillRatings).where(eq(skillRatings.swimmerId, swimmerId)),
    ).toHaveLength(0);
    expect(
      await adminDb().select().from(meetSwims).where(eq(meetSwims.swimmerId, swimmerId)),
    ).toHaveLength(0);
    expect(
      await adminDb().select().from(coachNotes).where(eq(coachNotes.swimmerId, swimmerId)),
    ).toHaveLength(0);
    expect(
      await adminDb().select().from(leagueRegistrations).where(eq(leagueRegistrations.swimmerId, swimmerId)),
    ).toHaveLength(0);
    expect(
      await adminDb().select().from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId)),
    ).toHaveLength(0);

    // coach_notifications tied to this household's lessons / batches gone.
    const coachNotifResidue = await adminDb()
      .select()
      .from(coachNotifications)
      .where(
        inArray(
          coachNotifications.lessonId,
          [singleLessonId, pastLessonId, ...manualBatch.lessonIds, ...weeklyBatch.lessonIds],
        ),
      );
    expect(coachNotifResidue).toHaveLength(0);

    // Profile scrubbed.
    const profileRow = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, authUserId))
      .limit(1);
    expect(profileRow[0]?.disabledAt).not.toBeNull();
    expect(profileRow[0]?.email).toMatch(/^deleted-user-.*@invalid\.local$/);

    // Job row written.
    const jobRow = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, authUserId))
      .limit(1);
    expect(jobRow).toHaveLength(1);
    expect(jobRow[0]?.scope).toBe("solo");
    expect(["pending", "completed"]).toContain(jobRow[0]?.status);

    // The coach got one account_deleted summary carrying only the
    // freed-up times (ISO strings), with no family or swimmer names.
    // Tag is keyed on the deletion job id so retries don't duplicate.
    // Filter by tag rather than category so a leftover notif from a
    // prior failed run can't skew the count.
    const expectedTag = `account-deleted:${jobRow[0]?.id}`;
    const accountDeletedNotifs = await adminDb()
      .select()
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.category, "account_deleted"),
          eq(coachNotifications.tag, expectedTag),
        ),
      );
    expect(accountDeletedNotifs).toHaveLength(1);
    const notif = accountDeletedNotifs[0]!;
    expect(notif.tag).toBe(expectedTag);
    const notifPayload = notif.payload as {
      kind: string;
      listTitle: string;
      cancelledLessonTimesUtc: string[];
      cancelledLessonTimesLocalDisplay: string[];
      deletedAtUtc: string;
    };
    expect(notifPayload.kind).toBe("account_deleted");
    expect(notifPayload.listTitle).toBe("A family deleted their account");
    // One timestamp per future lesson, sorted ascending, and matching
    // what's on the cancelled lesson rows.
    const futureTimesFromDb = futureAfter
      .map((row) => row.startsAt.toISOString())
      .sort();
    const notifTimesSorted = [...notifPayload.cancelledLessonTimesUtc].sort();
    expect(notifTimesSorted).toEqual(futureTimesFromDb);
    // A pre-formatted LA wall-time string per cancelled lesson, same
    // length as the ISO array — the renderer reads these so the bell
    // and push both render human times without reparsing in the client.
    expect(notifPayload.cancelledLessonTimesLocalDisplay).toHaveLength(
      notifPayload.cancelledLessonTimesUtc.length,
    );
    for (const display of notifPayload.cancelledLessonTimesLocalDisplay) {
      expect(typeof display).toBe("string");
      expect(display.length).toBeGreaterThan(0);
    }
    // No family/swimmer identity in the payload.
    expect(JSON.stringify(notifPayload)).not.toContain("Alex");
    expect(JSON.stringify(notifPayload)).not.toContain(householdId);

    // Anonymized rows carry the fields the coach schedule UI reads to
    // render "Deleted family" + location snapshot in place of the real
    // household/pool name. (Verifying via the /coach/schedule endpoint
    // itself is blocked by its "date too far in the future" schema
    // check, which runs off real time — not the pinned test clock.)
    const singleAfter = lessonsAfter.find((row) => row.id === singleLessonId);
    expect(singleAfter?.anonymizedAt).not.toBeNull();
    expect(singleAfter?.householdId).toBeNull();
    expect(singleAfter?.locationSnapshot).toBe("Home pool");
    expect(singleAfter?.swimmerCount).toBe(1);

    // ── Housekeeping ─────────────────────────────────────────
    const anonymizedIds = lessonsAfter.map((r) => r.id);
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.lessonId, anonymizedIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, anonymizedIds));
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.category, "account_deleted"));
    await adminDb()
      .delete(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, authUserId));
  });
});

// ── Leave path — real flows end-to-end ──────────────────────────────────────

describe("POST /me/deletion/confirm — leave path, real-flow seed", () => {
  it("manager who had real-flow bookings leaves cleanly; the household + owner + bookings all survive, only the manager's identity goes", async () => {
    const coach = await createTestUser("realflow-leave-coach");
    testUsers.push(coach);
    await makeCoach(coach.userId);

    const owner = await createTestUser("realflow-leave-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold(
      "realflow-leave-manager",
      owner.householdId,
      "manager",
    );
    testUsers.push(manager);

    // Give the owner's fullName a sentinel so the household-name
    // fallback assertion below has a real string to match.
    await adminDb()
      .update(profiles)
      .set({ fullName: "Owner Realflow" })
      .where(eq(profiles.id, owner.userId));

    // Swimmer + home pool belong to the household (owner-created).
    const swimmerId = await createSwimmer(owner, "Noah");
    const locationId = await seedHomePool(owner.householdId, "Realflow Leave");

    // Manager books a manual batch (authored under manager's actor_id in
    // the audit log). The leave path must scrub the manager-authored
    // audit-log payloads but leave the batch + outbox rows intact for the
    // household to continue using.
    const anchorLaDate = addDays(toLaDate(PINNED_NOW), 15);
    const b1 = laDateTimeToUtc(addDays(anchorLaDate, 0), "16:30");
    const b2 = laDateTimeToUtc(addDays(anchorLaDate, 1), "16:30");
    const manualBatch = await bookManualBatch({
      user: manager,
      locationId,
      swimmerId,
      startsAtList: [b1.toISOString(), b2.toISOString()],
    });
    await __settlePendingCoachAlertsForTests();

    // The real flow wrote a household_audit_log row with actor_id =
    // manager when the batch was created. Lock down that this row
    // exists and has a non-null payload — the scrub should null it
    // without deleting it.
    const beforeAuditRows = await adminDb()
      .select()
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, owner.householdId),
          eq(householdAuditLog.actorId, manager.userId),
        ),
      );
    expect(beforeAuditRows.length).toBeGreaterThan(0);

    // ── Leave ────────────────────────────────────────────────
    const res = await confirmDeletion(manager.accessToken);
    expect(res.status).toBe(204);

    // Household + owner intact.
    const hh = await adminDb()
      .select()
      .from(households)
      .where(eq(households.id, owner.householdId));
    expect(hh).toHaveLength(1);

    const ownerProfile = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, owner.userId))
      .limit(1);
    expect(ownerProfile[0]?.disabledAt).toBeNull();
    expect(ownerProfile[0]?.fullName).toBe("Owner Realflow");

    // Manager's member row gone; profile scrubbed.
    const managerMembership = await adminDb()
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.profileId, manager.userId));
    expect(managerMembership).toHaveLength(0);
    const managerProfile = await adminDb()
      .select()
      .from(profiles)
      .where(eq(profiles.id, manager.userId))
      .limit(1);
    expect(managerProfile[0]?.disabledAt).not.toBeNull();
    expect(managerProfile[0]?.fullName).toBeNull();

    // Booking batches survive — leave path does not touch household data.
    const batchRow = await adminDb()
      .select()
      .from(bookingBatches)
      .where(eq(bookingBatches.id, manualBatch.batchId));
    expect(batchRow).toHaveLength(1);
    expect(batchRow[0]?.householdId).toBe(owner.householdId);

    // Outbox rows survive and still carry their PII payload (the
    // household is alive — scrub only runs on solo). POST /lessons/batch
    // writes a `batch_booked` summary row scoped to batch_id with
    // lesson_id NULL; per-lesson 'lesson_confirmed' rows only land for
    // auto-approved flows, which first-time households don't hit. So
    // the inventory check is against batch_id, not lesson_id.
    const batchScopedOutbox = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.batchId, manualBatch.batchId));
    expect(batchScopedOutbox.length).toBeGreaterThan(0);
    for (const row of batchScopedOutbox) {
      // Payload is still the real booking shape (swimmerFirstNames
      // present), not the deletion sentinel — leave-scope does not
      // scrub household-scoped outbox rows.
      const payload = row.payload as Record<string, unknown>;
      expect(payload["_scrubbed_at"]).toBeUndefined();
    }

    // Audit payload where manager was the actor is nulled (not deleted).
    // The leave scope also INSERTS a new `member_deleted_account` audit
    // row with actor_id=manager + payload=null, so the final count is
    // beforeCount scrubbed + 1 new = beforeCount + 1, all with null
    // payload.
    const afterAuditRows = await adminDb()
      .select()
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, owner.householdId),
          eq(householdAuditLog.actorId, manager.userId),
        ),
      );
    expect(afterAuditRows.length).toBe(beforeAuditRows.length + 1);
    for (const row of afterAuditRows) {
      expect(row.payload).toBeNull();
    }
    const memberDeletedActions = afterAuditRows.filter(
      (row) => row.action === "member_deleted_account",
    );
    expect(memberDeletedActions).toHaveLength(1);

    // Job row scope = "leave".
    const jobRow = await adminDb()
      .select()
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, manager.userId))
      .limit(1);
    expect(jobRow).toHaveLength(1);
    expect(jobRow[0]?.scope).toBe("leave");

    // ── Housekeeping ─────────────────────────────────────────
    // Settle any lingering sender microtasks before teardown touches
    // the outbox rows those microtasks are about to update.
    await __settlePendingCoachAlertsForTests();
    await adminDb().delete(coachNotifications).where(
      inArray(coachNotifications.lessonId, manualBatch.lessonIds),
    );
    await adminDb()
      .delete(coachNotifications)
      .where(eq(coachNotifications.batchId, manualBatch.batchId));
    // Outbox rows reference batches (batch_id) and/or lessons (lesson_id);
    // clear both scopes.
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.lessonId, manualBatch.lessonIds));
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.batchId, manualBatch.batchId));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, manualBatch.lessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, manualBatch.lessonIds));
    await adminDb().delete(bookingBatches).where(eq(bookingBatches.id, manualBatch.batchId));
    await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, swimmerId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
    await adminDb().delete(lessonLocations).where(eq(lessonLocations.id, locationId));
    await adminDb()
      .delete(accountDeletionJobs)
      .where(eq(accountDeletionJobs.authUserId, manager.userId));
  });
});
