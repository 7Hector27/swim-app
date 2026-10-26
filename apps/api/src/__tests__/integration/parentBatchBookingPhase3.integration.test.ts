// Phase 3 batch booking integration tests (ADR 030). One behavior per
// `it(...)` block, matching the per-behavior rule from the plan:
//
//   P1 — approve-all flips only pending lessons; sends one batch_approved
//        email with invites for just those lessons.
//   P2 — approve-all returns 409 no_pending_lessons when nothing is pending.
//   P3 — cancel-remaining skips past-dated lessons; sends one batch_canceled
//        email whose .ics carries CANCEL VEVENTs only for lessons that had
//        a prior invite.
//   P4 — viewer gets 403 on cancel-remaining; nothing is written.
//   P5 — cancelled lessons trigger Google Calendar sync so stale events
//        get cleaned out (asserts the sync hook was called per lesson).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  type TestUser,
} from "./helpers";
import {
  availabilityConfig,
  availabilitySeasons,
  bookingBatches,
  householdAuditLog,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import {
  __resetSenderTransportForTests,
  __setSenderTransportForTests,
} from "../../services/emails/sender";
import type {
  EmailTransport,
  TransportResult,
  TransportSendOptions,
} from "../../services/emails/transport";
import { __resetEnvCacheForTests } from "../../lib/env";
import { __setClockForTests } from "../../lib/clock";
import * as googleSync from "../../services/googleCalendarSync";
import * as lessonApproval from "../../lib/lessonApproval";

const PINNED_NOW = new Date("2035-11-05T18:00:00Z");

const logger = pino({ level: "silent" });
const app = createApp(logger);

interface CapturedSend {
  options: TransportSendOptions;
  at: number;
}

class CaptureTransport implements EmailTransport {
  readonly sends: CapturedSend[] = [];
  behavior: (opts: TransportSendOptions) => Promise<TransportResult> = async () => ({
    ok: true,
    providerMessageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    error: null,
    errorMessage: null,
  });
  async send(opts: TransportSendOptions): Promise<TransportResult> {
    this.sends.push({ options: opts, at: Date.now() });
    return this.behavior(opts);
  }
  reset(): void {
    this.sends.length = 0;
  }
}

let owner: TestUser;
let viewer: TestUser;
let coach: TestUser;
let locationId: string;
let swimmerId: string;
let transport: CaptureTransport;

const LA_TZ = "America/Los_Angeles";

function getLaDateFromDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function withAllDaysEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const seasons = await adminDb().select().from(availabilitySeasons);
  const originalSeasons = seasons.map((season) => ({
    id: season.id,
    teachesDays: season.teachesDays,
  }));
  for (const season of seasons) {
    await adminDb()
      .update(availabilitySeasons)
      .set({ teachesDays: [1, 2, 3, 4, 5, 6, 7] })
      .where(eq(availabilitySeasons.id, season.id));
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
  try {
    return await fn();
  } finally {
    for (const original of originalSeasons) {
      await adminDb()
        .update(availabilitySeasons)
        .set({ teachesDays: original.teachesDays })
        .where(eq(availabilitySeasons.id, original.id));
    }
    if (originalConfig) {
      await adminDb()
        .update(availabilityConfig)
        .set({ defaultTeachesDays: originalConfig.defaultTeachesDays })
        .where(eq(availabilityConfig.id, originalConfig.id));
    }
  }
}

async function purgeStalePinnedWindowArtifacts(): Promise<void> {
  const windowStart = new Date(PINNED_NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(PINNED_NOW.getTime() + 400 * 24 * 60 * 60 * 1000);
  const stale = await adminDb()
    .select({ id: lessons.id, batchId: lessons.batchId })
    .from(lessons)
    .where(and(gte(lessons.startsAt, windowStart), lt(lessons.startsAt, windowEnd)));
  const lessonIds = stale.map((row) => row.id);
  const batchIds = Array.from(
    new Set(stale.map((row) => row.batchId).filter((id): id is string => id !== null)),
  );
  if (lessonIds.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.lessonId, lessonIds));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, lessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, lessonIds));
  }
  if (batchIds.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.batchId, batchIds));
    await adminDb().delete(bookingBatches).where(inArray(bookingBatches.id, batchIds));
  }
}

async function cleanupHouseholdBatchArtifacts(householdId: string): Promise<void> {
  const batchRows = await adminDb()
    .select({ id: bookingBatches.id })
    .from(bookingBatches)
    .where(eq(bookingBatches.householdId, householdId));
  const batchIds = batchRows.map((row) => row.id);
  if (batchIds.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.batchId, batchIds));
  }
  const lessonRows = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const lessonIds = lessonRows.map((row) => row.id);
  if (lessonIds.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.lessonId, lessonIds));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, lessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, lessonIds));
  }
  if (batchIds.length > 0) {
    await adminDb().delete(bookingBatches).where(inArray(bookingBatches.id, batchIds));
  }
  await adminDb()
    .delete(householdAuditLog)
    .where(
      and(
        eq(householdAuditLog.householdId, householdId),
        inArray(householdAuditLog.action, [
          "lesson_batch_booked",
          "lesson_batch_approved",
          "lesson_batch_canceled_remaining",
        ]),
      ),
    );
}

async function waitForOutboxTerminal(outboxId: string, maxMs = 2000): Promise<void> {
  const deadline = Date.now() + maxMs;
  const terminal = new Set(["sent", "failed", "skipped", "superseded", "abandoned"]);
  while (Date.now() < deadline) {
    const [row] = await adminDb()
      .select({ status: lessonEmailOutbox.status })
      .from(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.id, outboxId));
    if (row && terminal.has(row.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Outbox row ${outboxId} did not reach a terminal state within ${maxMs}ms`);
}

function futureLaDate(daysFromNow: number): string {
  const future = new Date(PINNED_NOW.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  return getLaDateFromDate(future);
}

let originalBookingMaxAdvanceWeeks: number | null = null;

beforeAll(async () => {
  __resetEnvCacheForTests();
  __setClockForTests(PINNED_NOW);
  await purgeStalePinnedWindowArtifacts();
  const configRows = await adminDb().select().from(availabilityConfig).limit(1);
  const config = configRows[0];
  if (config) {
    originalBookingMaxAdvanceWeeks = config.bookingMaxAdvanceWeeks;
    await adminDb()
      .update(availabilityConfig)
      .set({ bookingMaxAdvanceWeeks: 52 })
      .where(eq(availabilityConfig.id, config.id));
  }

  owner = await createTestUser("batch-phase3-owner");
  viewer = await createTestUserInHousehold("batch-phase3-viewer", owner.householdId, "viewer");
  coach = await createTestUser("batch-phase3-coach");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "BatchKid",
      lastName: "Phase3",
      birthDate: "2016-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]?.id ?? "";

  transport = new CaptureTransport();
  __setSenderTransportForTests(transport);
});

afterAll(async () => {
  __resetSenderTransportForTests();
  await cleanupHouseholdBatchArtifacts(owner.householdId);
  if (swimmerId) {
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (viewer) await viewer.cleanup();
  if (owner) await owner.cleanup();
  if (coach) await coach.cleanup();
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

beforeEach(async () => {
  transport.reset();
  vi.restoreAllMocks();
  await cleanupHouseholdBatchArtifacts(owner.householdId);
});

afterEach(async () => {
  await cleanupHouseholdBatchArtifacts(owner.householdId);
});

// Seeds one approved+completed lesson at the batch pool so the household is
// trusted (needsApproval=false). Returns the seeded lesson id for cleanup.
async function seedTrust(opts: { startDaysAgo?: number } = {}): Promise<string> {
  const startDaysAgo = opts.startDaysAgo ?? 30;
  const rows = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: new Date(PINNED_NOW.getTime() - startDaysAgo * 24 * 60 * 60 * 1000),
      durationMinutes: 30,
      type: "private",
      status: "completed",
      requestedBy: owner.userId,
      approvedAt: new Date(PINNED_NOW.getTime() - (startDaysAgo + 1) * 24 * 60 * 60 * 1000),
      completedAt: new Date(PINNED_NOW.getTime() - startDaysAgo * 24 * 60 * 60 * 1000),
    })
    .returning({ id: lessons.id });
  return rows[0]!.id;
}

async function submitBatch(opts: {
  startDate: string;
  weeks: number;
  weekday: number;
}): Promise<{ batchId: string; lessonIds: string[]; outboxId: string }> {
  const submit = await request(app)
    .post("/lessons/batch")
    .set("Authorization", `Bearer ${owner.accessToken}`)
    .send({
      mode: "weekly",
      householdId: owner.householdId,
      locationId,
      swimmerIds: [swimmerId],
      pattern: [{ weekday: opts.weekday, timeOfDay: "16:30", durationMinutes: 30 }],
      startDate: opts.startDate,
      weeks: opts.weeks,
    });
  expect(submit.status).toBe(201);
  const batchId = submit.body.batchId as string;
  const lessonIds = submit.body.lessonIds as string[];
  const outboxRows = await adminDb()
    .select({ id: lessonEmailOutbox.id })
    .from(lessonEmailOutbox)
    .where(eq(lessonEmailOutbox.batchId, batchId));
  const outboxId = outboxRows[0]!.id;
  return { batchId, lessonIds, outboxId };
}

function isoWeekdayFor(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day!));
  const jsDow = utc.getUTCDay();
  return jsDow === 0 ? 7 : jsDow;
}

describe("Phase 3 — PATCH /coach/lessons/batch/:batchId/approve-pending", () => {
  // P1 — approve-all flips only pending lessons.
  it("P1: approve-all flips only pending lessons and sends one email with invites for just those", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(10);
      const weekday = isoWeekdayFor(startDate);
      // No trust seed → batch lands as all pending.
      const { batchId, lessonIds, outboxId: bookedOutboxId } = await submitBatch({
        startDate,
        weeks: 3,
        weekday,
      });
      // Flush the post-commit batch_booked send so transport is clean.
      await waitForOutboxTerminal(bookedOutboxId);
      transport.reset();

      // Flip one lesson to approved manually to simulate a mid-batch
      // per-lesson approve. The approve-all run should only touch the other two.
      const alreadyApprovedId = lessonIds[0]!;
      await adminDb()
        .update(lessons)
        .set({ status: "approved", approvedAt: new Date(), calendarSequence: 1, calendarInviteSentAt: new Date() })
        .where(eq(lessons.id, alreadyApprovedId));

      const approve = await request(app)
        .patch(`/coach/lessons/batch/${batchId}/approve-pending`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send();
      expect(approve.status).toBe(200);
      expect(approve.body.approvedCount).toBe(2);
      const approvedIds = approve.body.approvedLessonIds as string[];
      expect(approvedIds).not.toContain(alreadyApprovedId);
      expect(approvedIds).toHaveLength(2);

      // Only the two previously-pending lessons flipped.
      const dbRows = await adminDb()
        .select({ id: lessons.id, status: lessons.status, approvedBy: lessons.approvedBy })
        .from(lessons)
        .where(inArray(lessons.id, lessonIds));
      for (const row of dbRows) {
        expect(row.status).toBe("approved");
      }
      // The pre-existing approved lesson keeps approvedBy=null (system auto),
      // the two newly approved rows carry approvedBy=coach.
      const freshApproved = dbRows.filter((row) => approvedIds.includes(row.id));
      for (const row of freshApproved) {
        expect(row.approvedBy).toBe(coach.userId);
      }

      // Exactly one batch_approved outbox row with the newly approved lessons.
      const outboxRows = await adminDb()
        .select({
          id: lessonEmailOutbox.id,
          event: lessonEmailOutbox.event,
          batchId: lessonEmailOutbox.batchId,
          payload: lessonEmailOutbox.payload,
        })
        .from(lessonEmailOutbox)
        .where(
          and(
            eq(lessonEmailOutbox.batchId, batchId),
            eq(lessonEmailOutbox.event, "batch_approved"),
          ),
        );
      expect(outboxRows).toHaveLength(1);
      const payload = outboxRows[0]!.payload as { lessons: Array<{ lessonId: string }> };
      expect(payload.lessons.map((l) => l.lessonId).sort()).toEqual([...approvedIds].sort());

      // Audit row.
      const auditRows = await adminDb()
        .select({ action: householdAuditLog.action, payload: householdAuditLog.payload })
        .from(householdAuditLog)
        .where(
          and(
            eq(householdAuditLog.householdId, owner.householdId),
            eq(householdAuditLog.action, "lesson_batch_approved"),
          ),
        );
      expect(auditRows).toHaveLength(1);

      // The email went out with .ics containing exactly 2 VEVENTs.
      await waitForOutboxTerminal(outboxRows[0]!.id);
      const sendsForApproved = transport.sends.filter((send) =>
        send.options.subject.toLowerCase().includes("confirmed"),
      );
      expect(sendsForApproved.length).toBeGreaterThanOrEqual(1);
      const latest = sendsForApproved[sendsForApproved.length - 1]!;
      const ics = latest.options.ics;
      expect(ics).toBeDefined();
      const veventCount = (ics!.content.match(/BEGIN:VEVENT/g) ?? []).length;
      expect(veventCount).toBe(2);
      expect(ics!.content).toContain("METHOD:REQUEST");
    });
  });

  // P2 — 409 when nothing is pending.
  it("P2: approve-all returns 409 no_pending_lessons when nothing is pending", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      try {
        const startDate = futureLaDate(40);
        const weekday = isoWeekdayFor(startDate);
        const { batchId } = await submitBatch({ startDate, weeks: 2, weekday });

        // All lessons approved. Approve-all has nothing to do.
        const approve = await request(app)
          .patch(`/coach/lessons/batch/${batchId}/approve-pending`)
          .set("Authorization", `Bearer ${coach.accessToken}`)
          .send();
        expect(approve.status).toBe(409);
        expect(approve.body.error).toBe("no_pending_lessons");

        // No batch_approved outbox row written.
        const outboxRows = await adminDb()
          .select({ id: lessonEmailOutbox.id })
          .from(lessonEmailOutbox)
          .where(
            and(
              eq(lessonEmailOutbox.batchId, batchId),
              eq(lessonEmailOutbox.event, "batch_approved"),
            ),
          );
        expect(outboxRows).toHaveLength(0);
      } finally {
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });
});

describe("Phase 3 — DELETE /lessons/batch/:batchId/remaining", () => {
  // P3 — cancel-remaining skips past, sends one email with the right CANCEL events.
  it("P3: cancel-remaining skips past lessons and sends one email with CANCEL VEVENTs for the invited ones", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      try {
        const startDate = futureLaDate(70);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, lessonIds, outboxId: bookedOutboxId } = await submitBatch({
          startDate,
          weeks: 3,
          weekday,
        });
        await waitForOutboxTerminal(bookedOutboxId);
        transport.reset();

        // Rewrite one lesson to be in the past so cancel-remaining skips it.
        const pastLessonId = lessonIds[0]!;
        await adminDb()
          .update(lessons)
          .set({
            startsAt: new Date(PINNED_NOW.getTime() - 24 * 60 * 60 * 1000),
            status: "completed",
            completedAt: new Date(PINNED_NOW.getTime() - 24 * 60 * 60 * 1000),
          })
          .where(eq(lessons.id, pastLessonId));

        // Cancel-remaining under the owner's token.
        const cancel = await request(app)
          .delete(`/lessons/batch/${batchId}/remaining`)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send();
        expect(cancel.status).toBe(200);
        expect(cancel.body.canceledCount).toBe(2);
        const canceledIds = (cancel.body.canceledLessonIds as string[]).sort();
        expect(canceledIds).not.toContain(pastLessonId);

        // The past lesson is still 'completed'; the other two are 'canceled'.
        const pastRow = await adminDb()
          .select({ status: lessons.status })
          .from(lessons)
          .where(eq(lessons.id, pastLessonId));
        expect(pastRow[0]!.status).toBe("completed");
        const canceledRows = await adminDb()
          .select({ id: lessons.id, status: lessons.status })
          .from(lessons)
          .where(inArray(lessons.id, canceledIds));
        for (const row of canceledRows) {
          expect(row.status).toBe("canceled");
        }

        // One batch_canceled outbox row.
        const outboxRows = await adminDb()
          .select({
            id: lessonEmailOutbox.id,
            payload: lessonEmailOutbox.payload,
          })
          .from(lessonEmailOutbox)
          .where(
            and(
              eq(lessonEmailOutbox.batchId, batchId),
              eq(lessonEmailOutbox.event, "batch_canceled"),
            ),
          );
        expect(outboxRows).toHaveLength(1);

        await waitForOutboxTerminal(outboxRows[0]!.id);

        const sendsForCanceled = transport.sends.filter((send) =>
          send.options.subject.toLowerCase().includes("canceled"),
        );
        expect(sendsForCanceled.length).toBe(1);
        const latest = sendsForCanceled[0]!;
        const ics = latest.options.ics;
        expect(ics).toBeDefined();
        expect(ics!.content).toContain("METHOD:CANCEL");
        const veventCount = (ics!.content.match(/BEGIN:VEVENT/g) ?? []).length;
        // Both remaining lessons had invites (approved batch), so both CANCEL.
        expect(veventCount).toBe(2);
      } finally {
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });

  // P3b — the GET /lessons/batch/:batchId preview endpoint the cancel-
  // remaining confirm dialog reads must return the same lessons the DELETE
  // endpoint cancels, 1:1. The current lesson a parent is viewing is one of
  // them.
  it("P3b: GET /lessons/batch/:batchId returns the exact set DELETE will cancel", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      try {
        const startDate = futureLaDate(190);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, lessonIds, outboxId: bookedOutboxId } = await submitBatch({
          startDate,
          weeks: 3,
          weekday,
        });
        await waitForOutboxTerminal(bookedOutboxId);
        transport.reset();

        // One lesson in the past; the preview endpoint should exclude it,
        // same as the DELETE route.
        const pastId = lessonIds[0]!;
        await adminDb()
          .update(lessons)
          .set({
            startsAt: new Date(PINNED_NOW.getTime() - 24 * 60 * 60 * 1000),
            status: "completed",
            completedAt: new Date(PINNED_NOW.getTime() - 24 * 60 * 60 * 1000),
          })
          .where(eq(lessons.id, pastId));

        const preview = await request(app)
          .get(`/lessons/batch/${batchId}`)
          .set("Authorization", `Bearer ${owner.accessToken}`);
        expect(preview.status).toBe(200);
        const previewIds = (preview.body as Array<{ id: string }>)
          .map((row) => row.id)
          .sort();
        expect(previewIds).not.toContain(pastId);
        // Preview must also include the lesson a parent is currently viewing
        // (any of the two future lessons), not just siblings.
        for (const id of previewIds) {
          expect(lessonIds).toContain(id);
        }

        const cancel = await request(app)
          .delete(`/lessons/batch/${batchId}/remaining`)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send();
        expect(cancel.status).toBe(200);
        const canceledIds = (cancel.body.canceledLessonIds as string[]).sort();
        expect(canceledIds).toEqual(previewIds);
      } finally {
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });

  // P4b — a parent in a different household from the batch's owner gets
  // 404 and nothing is written. Exercises the household-scoped SELECT
  // guard on the DELETE route; the batch itself was created legitimately.
  it("P4b: DELETE /lessons/batch/:batchId/remaining returns 404 for a non-member household", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      const other = await createTestUser("batch-phase3-other");
      try {
        const startDate = futureLaDate(165);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, outboxId: bookedOutboxId } = await submitBatch({
          startDate,
          weeks: 2,
          weekday,
        });
        await waitForOutboxTerminal(bookedOutboxId);

        // The caller is a legitimate owner of their own household, so the
        // middleware chain accepts them; the route's household-scoped SELECT
        // returns no row and the handler must return 404 rather than exposing
        // existence or canceling anyone else's lessons.
        const cancel = await request(app)
          .delete(`/lessons/batch/${batchId}/remaining`)
          .set("Authorization", `Bearer ${other.accessToken}`)
          .send();
        expect(cancel.status).toBe(404);

        // No audit row, no outbox row, and the batch's own lessons stayed
        // pending/approved (none got flipped to canceled).
        const auditRows = await adminDb()
          .select({ id: householdAuditLog.id })
          .from(householdAuditLog)
          .where(
            and(
              eq(householdAuditLog.householdId, owner.householdId),
              eq(householdAuditLog.action, "lesson_batch_canceled_remaining"),
            ),
          );
        expect(auditRows).toHaveLength(0);

        const outboxRows = await adminDb()
          .select({ id: lessonEmailOutbox.id })
          .from(lessonEmailOutbox)
          .where(
            and(
              eq(lessonEmailOutbox.batchId, batchId),
              eq(lessonEmailOutbox.event, "batch_canceled"),
            ),
          );
        expect(outboxRows).toHaveLength(0);

        const batchLessonRows = await adminDb()
          .select({ status: lessons.status })
          .from(lessons)
          .where(eq(lessons.batchId, batchId));
        expect(batchLessonRows.length).toBeGreaterThan(0);
        for (const row of batchLessonRows) {
          expect(row.status).not.toBe("canceled");
        }
      } finally {
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
        await other.cleanup();
      }
    });
  });

  // P4 — viewer gets 403.
  it("P4: viewer gets 403 and no rows are written", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      try {
        const startDate = futureLaDate(105);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, outboxId: bookedOutboxId } = await submitBatch({
          startDate,
          weeks: 2,
          weekday,
        });
        await waitForOutboxTerminal(bookedOutboxId);

        const cancel = await request(app)
          .delete(`/lessons/batch/${batchId}/remaining`)
          .set("Authorization", `Bearer ${viewer.accessToken}`)
          .send();
        expect(cancel.status).toBe(403);

        // No cancel_remaining audit row.
        const auditRows = await adminDb()
          .select({ id: householdAuditLog.id })
          .from(householdAuditLog)
          .where(
            and(
              eq(householdAuditLog.householdId, owner.householdId),
              eq(householdAuditLog.action, "lesson_batch_canceled_remaining"),
            ),
          );
        expect(auditRows).toHaveLength(0);

        // No batch_canceled outbox row.
        const outboxRows = await adminDb()
          .select({ id: lessonEmailOutbox.id })
          .from(lessonEmailOutbox)
          .where(
            and(
              eq(lessonEmailOutbox.batchId, batchId),
              eq(lessonEmailOutbox.event, "batch_canceled"),
            ),
          );
        expect(outboxRows).toHaveLength(0);
      } finally {
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });

  // P5 — Google Calendar sync fires per cancelled lesson so stale events are
  // cleaned up (the sync service deletes events for canceled lessons).
  it("P5: cancel-remaining schedules a Google Calendar sync for every cancelled lesson", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      const syncSpy = vi
        .spyOn(googleSync, "syncLessonToGoogle")
        .mockResolvedValue(undefined);
      try {
        const startDate = futureLaDate(140);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, lessonIds, outboxId: bookedOutboxId } = await submitBatch({
          startDate,
          weeks: 3,
          weekday,
        });
        await waitForOutboxTerminal(bookedOutboxId);
        syncSpy.mockClear();

        const cancel = await request(app)
          .delete(`/lessons/batch/${batchId}/remaining`)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send();
        expect(cancel.status).toBe(200);

        // Allow the queued microtasks to run.
        await new Promise((resolve) => setTimeout(resolve, 50));

        const syncedIds = syncSpy.mock.calls.map((call) => call[0] as string).sort();
        expect(syncedIds).toEqual([...lessonIds].sort());
      } finally {
        syncSpy.mockRestore();
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });

  // P6 — batch cancel-remaining notifies the coach once per batch with a
  // summary, not once per lesson.
  it("P6: cancel-remaining fires notifyCoachOfBatchChange once, not notifyCoachOfChange N times", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      const batchChangeSpy = vi
        .spyOn(lessonApproval, "notifyCoachOfBatchChange")
        .mockImplementation(() => {});
      const perLessonSpy = vi
        .spyOn(lessonApproval, "notifyCoachOfChange")
        .mockImplementation(() => {});
      try {
        const startDate = futureLaDate(305);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, lessonIds, outboxId: bookedOutboxId } = await submitBatch({
          startDate,
          weeks: 3,
          weekday,
        });
        await waitForOutboxTerminal(bookedOutboxId);
        batchChangeSpy.mockClear();
        perLessonSpy.mockClear();

        const cancel = await request(app)
          .delete(`/lessons/batch/${batchId}/remaining`)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send();
        expect(cancel.status).toBe(200);

        expect(batchChangeSpy).toHaveBeenCalledTimes(1);
        expect(batchChangeSpy).toHaveBeenCalledWith(batchId, "canceled_remaining", {
          lessonCount: lessonIds.length,
        });
        expect(perLessonSpy).not.toHaveBeenCalled();
      } finally {
        batchChangeSpy.mockRestore();
        perLessonSpy.mockRestore();
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });
});

// POST /lessons/batch's coach notification goes through the batch-scoped
// stub too; this lives in its own describe block since it exercises the
// batch submit path, not cancel-remaining.
describe("Phase 3 — POST /lessons/batch coach notification", () => {
  it("P7: a successful batch submit fires notifyBatchBookingCreated once with the summary and not notifyBookingCreated per lesson", async () => {
    await withAllDaysEnabled(async () => {
      const trustId = await seedTrust();
      const batchSpy = vi
        .spyOn(lessonApproval, "notifyBatchBookingCreated")
        .mockImplementation(() => {});
      const perLessonSpy = vi
        .spyOn(lessonApproval, "notifyBookingCreated")
        .mockImplementation(() => {});
      try {
        const startDate = futureLaDate(335);
        const weekday = isoWeekdayFor(startDate);
        const { batchId, lessonIds, outboxId } = await submitBatch({
          startDate,
          weeks: 3,
          weekday,
        });
        await waitForOutboxTerminal(outboxId);

        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy).toHaveBeenCalledWith(batchId, {
          confirmedCount: lessonIds.length,
          pendingCount: 0,
        });
        expect(perLessonSpy).not.toHaveBeenCalled();
      } finally {
        batchSpy.mockRestore();
        perLessonSpy.mockRestore();
        await adminDb().delete(lessons).where(eq(lessons.id, trustId));
      }
    });
  });
});
