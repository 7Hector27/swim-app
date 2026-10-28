// Phase 1 batch booking integration tests (ADR 030). Each behavior appears
// exactly once per the plan:
//
//   T1 — all-or-nothing rollback
//   T2 — picks conflicting with each other through buffer and cap
//   T3 — weekly with two weekdays generates the right expanded dates
//   T4 — a flagged week moved vs skipped (server-side)
//   T5 — a batch over 20 lessons or past the booking window is rejected
//   T6 — viewer gets 403
//   T7 — one email with the right invites and no per-lesson booking emails
//   T8 — a lesson canceled before the summary sends is left out of the .ics
//   T9 — concurrent single-lesson booking vs batch booking on the same day
//
// All tests seed their own fixtures and clean up at the end so they can run
// in any order and alongside the other integration tests.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  blockedTimes,
  bookingBatches,
  householdAuditLog,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../../db/schema";
import {
  __resetSenderTransportForTests,
  __setSenderTransportForTests,
  sendLessonEmailOutboxRow,
} from "../../services/emails/sender";
import type {
  EmailTransport,
  TransportResult,
  TransportSendOptions,
} from "../../services/emails/transport";
import { __resetEnvCacheForTests } from "../../lib/env";
import { __setClockForTests } from "../../lib/clock";

// Pin the server clock to a far-future Monday morning so every test runs
// against the same instant. Mon 2035-11-05 10:00 America/Los_Angeles under
// PST (UTC-8) = 2035-11-05T18:00:00Z. Teaching hours start at 16:00 LA so
// futureLaDate(10) lands on 2035-11-15 and all per-test dates fit comfortably
// inside the booking window.
const PINNED_NOW = new Date("2035-11-05T18:00:00Z");

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Capture transport ──────────────────────────────────────────────────────

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
let locationId: string;
let swimmerId: string;
let transport: CaptureTransport;

// ── LA time helpers ────────────────────────────────────────────────────────

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

function laDateToUtcAtTime(dateStr: string, timeStr: string): Date {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const hour = Number(timeStr.slice(0, 2));
  const min = Number(timeStr.slice(3, 5));
  // Initial PDT approximation
  const approxMs = Date.UTC(year, month - 1, day, hour + 7, min);
  const toWallMs = (tz: string) => {
    const pp = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(new Date(approxMs));
    const g = (t: string) => Number(pp.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(
      g("year"),
      g("month") - 1,
      g("day"),
      g("hour") % 24,
      g("minute"),
      g("second"),
    );
  };
  const offsetMs = toWallMs("UTC") - toWallMs(LA_TZ);
  return new Date(Date.UTC(year, month - 1, day, hour, min) + offsetMs);
}

function addDays(iso: string, n: number): string {
  // Pure LA-calendar string arithmetic. The naive version that uses
  // `new Date(iso + 'T00:00:00Z')` and `getLaDateFromDate` routes through
  // UTC midnight, which is the previous day in LA (UTC-8) and off-by-one
  // every single call.
  const [year, month, day] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(year!, month! - 1, day!));
  base.setUTCDate(base.getUTCDate() + n);
  const yr = base.getUTCFullYear();
  const mo = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(base.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

// Opens every teaching day so the slot engine admits any weekday the tests
// pick. Mirrors the pattern in lessons.integration.test.ts.
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
  // Also open all days on the fallback config so that dates with no season
  // coverage (common when test anchors land on a weekend or odd weekday)
  // are still treated as lesson days.
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

// Deletes every batch artifact (lessons, outbox, batches, audit log) at any
// household whose starts_at lives inside the pinned-clock window. This runs
// once at the top of the file to clear leftovers from any prior crashed run,
// so the current run never collides with stale data on the same dates.
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
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.lessonId, lessonIds));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, lessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, lessonIds));
  }
  if (batchIds.length > 0) {
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.batchId, batchIds));
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
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.batchId, batchIds));
  }
  const lessonRows = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const lessonIds = lessonRows.map((row) => row.id);
  if (lessonIds.length > 0) {
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.lessonId, lessonIds));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, lessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, lessonIds));
  }
  if (batchIds.length > 0) {
    await adminDb().delete(bookingBatches).where(inArray(bookingBatches.id, batchIds));
  }
  await adminDb()
    .delete(householdAuditLog)
    .where(
      and(eq(householdAuditLog.householdId, householdId), eq(householdAuditLog.action, "lesson_batch_booked")),
    );
}

let originalBookingMaxAdvanceWeeks: number | null = null;

beforeAll(async () => {
  __resetEnvCacheForTests();
  // Pin the server clock so every test runs against the same instant and
  // futureLaDate() returns deterministic dates. Any orphan lessons /
  // batches from a prior crashed run that land in that same window are
  // purged before the current run touches the database.
  __setClockForTests(PINNED_NOW);
  await purgeStalePinnedWindowArtifacts();
  // Give each test enough runway to pick its own non-overlapping startDate
  // offset. Restored in afterAll.
  const configRows = await adminDb().select().from(availabilityConfig).limit(1);
  const config = configRows[0];
  if (config) {
    originalBookingMaxAdvanceWeeks = config.bookingMaxAdvanceWeeks;
    await adminDb()
      .update(availabilityConfig)
      .set({ bookingMaxAdvanceWeeks: 52 })
      .where(eq(availabilityConfig.id, config.id));
  }
  owner = await createTestUser("batch-owner");
  viewer = await createTestUserInHousehold("batch-viewer", owner.householdId, "viewer");

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
      lastName: "Integration",
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
  // Clean slate for the owner's household so later tests don't see
  // leftover batches / lessons from earlier ones.
  await cleanupHouseholdBatchArtifacts(owner.householdId);
});

afterEach(async () => {
  // Belt-and-suspenders: every test must clean up what it created so a
  // failure mid-test cannot leak lessons into the next test or the next
  // run. The purge at beforeAll handles the "previous run crashed before
  // afterAll" case.
  await cleanupHouseholdBatchArtifacts(owner.householdId);
});

// ── Config helper ─────────────────────────────────────────────────────────

async function getConfig() {
  const rows = await adminDb().select().from(availabilityConfig).limit(1);
  return rows[0]!;
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

// Picks a weekday that is far enough in the future to clear the 16-hour
// notice window and lands on a weekday included in the current seasons'
// teachesDays (we open all days via withAllDaysEnabled). Deterministic:
// anchored to the pinned PINNED_NOW instant so date math is stable across
// runs and tests can pick non-overlapping offsets.
function futureLaDate(daysFromNow: number): string {
  const future = new Date(PINNED_NOW.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  return getLaDateFromDate(future);
}

// ISO weekday for an LA date string (1=Mon … 7=Sun). Used so tests can
// pass `weekdays: [startDayIsoWeekday]` and have the batch's expansion
// make the startDate itself the index-0 lesson — then addDays(startDate, 7)
// correctly targets the index-1 lesson, addDays(startDate, 14) targets
// index-2, and so on.
function isoWeekdayFor(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day!));
  const jsDow = utc.getUTCDay();
  return jsDow === 0 ? 7 : jsDow;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /lessons/batch — Phase 1", () => {
  // T6 — viewer gets 403
  it("T6: viewer gets 403 on preview and submit", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(10);
      const body = {
        mode: "weekly" as const,
        householdId: owner.householdId,
        locationId,
        pattern: [
          {
            weekday: 3,
            timeOfDay: "16:30",
            durationMinutes: 30 as const,
            swimmerIds: [swimmerId],
          },
        ],
        startDate,
        weeks: 2,
      };
      const preview = await request(app)
        .post("/lessons/batch/preview")
        .set("Authorization", `Bearer ${viewer.accessToken}`)
        .send(body);
      expect(preview.status).toBe(403);

      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${viewer.accessToken}`)
        .send(body);
      expect(submit.status).toBe(403);

      // Nothing written.
      const rows = await adminDb()
        .select({ id: bookingBatches.id })
        .from(bookingBatches)
        .where(eq(bookingBatches.householdId, owner.householdId));
      expect(rows).toHaveLength(0);
    });
  });

  // T3 — weekly with two weekdays generates the right dates
  it("T3: weekly with two weekdays generates expected expanded dates", async () => {
    await withAllDaysEnabled(async () => {
      // Pick a date 40 days out, unique to this test. The server expands
      // Tuesdays and Thursdays (ISO 2 + 4) for 3 weeks → 6 lessons.
      const startDate = futureLaDate(40);
      const res = await request(app)
        .post("/lessons/batch/preview")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          mode: "weekly",
          householdId: owner.householdId,
          locationId,
          pattern: [
            {
              weekday: 2,
              timeOfDay: "16:30",
              durationMinutes: 30,
              swimmerIds: [swimmerId],
            },
            {
              weekday: 4,
              timeOfDay: "16:30",
              durationMinutes: 30,
              swimmerIds: [swimmerId],
            },
          ],
          startDate,
          weeks: 3,
        });
      expect(res.status).toBe(200);
      const picks = res.body.picks as Array<{ index: number; startsAt: string; state: string }>;
      expect(picks).toHaveLength(6);
      // Indexes are stable and ordered week-then-weekday.
      expect(picks.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
      // Confirm ISO weekdays alternate 2 then 4 across the whole list.
      const weekdaysSeen = picks.map((p) => {
        const d = new Date(p.startsAt);
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, weekday: "short" })
          .format(d)
          .toLowerCase();
        return parts;
      });
      expect(weekdaysSeen).toEqual(["tue", "thu", "tue", "thu", "tue", "thu"]);
    });
  });

  // T5 — cap and window rejection
  it("T5a: schema rejects a 21-pick manual batch", async () => {
    const picks = Array.from({ length: 21 }, (_unused, idx) => ({
      startsAt: new Date(PINNED_NOW.getTime() + (10 + idx) * 24 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 30 as const,
      swimmerIds: [swimmerId],
    }));
    const res = await request(app)
      .post("/lessons/batch")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({
        mode: "manual",
        householdId: owner.householdId,
        locationId,
        picks,
      });
    expect(res.status).toBe(422);
  });

  it("T5b: weekly past bookingMaxAdvanceWeeks is flagged in preview and rejected on submit", async () => {
    await withAllDaysEnabled(async () => {
      const config = await getConfig();
      // Start right after the booking window ends; every expanded lesson
      // will be in not_open_yet territory.
      const startDaysOut = config.bookingMaxAdvanceWeeks * 7 + 7; // one week past the ceiling
      const startDate = futureLaDate(startDaysOut);
      const previewBody = {
        mode: "weekly" as const,
        householdId: owner.householdId,
        locationId,
        pattern: [
          {
            weekday: 3,
            timeOfDay: "16:30",
            durationMinutes: 30 as const,
            swimmerIds: [swimmerId],
          },
        ],
        startDate,
        weeks: 2,
      };
      const preview = await request(app)
        .post("/lessons/batch/preview")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(previewBody);
      expect(preview.status).toBe(200);
      const picks = preview.body.picks as Array<{ state: string }>;
      expect(picks).toHaveLength(2);
      expect(picks.every((p) => p.state === "not_open_yet")).toBe(true);

      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ ...previewBody });
      expect(submit.status).toBe(422);
      expect(submit.body.error).toBe("picks_conflict");
      const conflicts = submit.body.conflicts as Array<{ state: string }>;
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts[0]!.state).toBe("not_open_yet");

      const rows = await adminDb()
        .select({ id: bookingBatches.id })
        .from(bookingBatches)
        .where(eq(bookingBatches.householdId, owner.householdId));
      expect(rows).toHaveLength(0);
    });
  });

  // T2 — picks conflicting through buffer and cap (overlap on same day)
  it("T2: two batch picks overlapping each other are flagged as conflicts_batch", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(65);
      // Two 45-min picks that overlap: 4:30 PM and 5:00 PM on the same day.
      const pick1 = laDateToUtcAtTime(startDate, "16:30");
      const pick2 = laDateToUtcAtTime(startDate, "17:00");
      const body = {
        mode: "manual" as const,
        householdId: owner.householdId,
        locationId,
        picks: [
          {
            startsAt: pick1.toISOString(),
            durationMinutes: 45 as const,
            swimmerIds: [swimmerId],
          },
          {
            startsAt: pick2.toISOString(),
            durationMinutes: 45 as const,
            swimmerIds: [swimmerId],
          },
        ],
      };
      const preview = await request(app)
        .post("/lessons/batch/preview")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(body);
      expect(preview.status).toBe(200);
      const picks = preview.body.picks as Array<{ index: number; state: string }>;
      // The slot engine folds the other pick in and reports a conflict on
      // one of the two (the one that lands second in the pick-asc order).
      const flagged = picks.find((p) => p.state === "conflicts_batch");
      expect(flagged).toBeDefined();

      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(body);
      expect(submit.status).toBe(422);
      expect(submit.body.error).toBe("picks_conflict");
    });
  });

  // T4a — flagged week moved
  it("T4a: a blocked week can be moved to another time via overrides", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(85);
      const weekday = isoWeekdayFor(startDate);
      // Block the week-2 slot (index 1 = startDate + 7 days with a single weekday).
      const week2Date = addDays(startDate, 7);
      const blockedStart = laDateToUtcAtTime(week2Date, "16:00");
      const blockedEnd = laDateToUtcAtTime(week2Date, "17:00");
      const [block] = await adminDb()
        .insert(blockedTimes)
        .values({ startsAt: blockedStart, endsAt: blockedEnd, note: "batch test block" })
        .returning();
      const blockId = block!.id;

      try {
        const submit = await request(app)
          .post("/lessons/batch")
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send({
            mode: "weekly",
            householdId: owner.householdId,
            locationId,
            pattern: [
              {
                weekday,
                timeOfDay: "16:30",
                durationMinutes: 30,
                swimmerIds: [swimmerId],
              },
            ],
            startDate,
            weeks: 3,
            overrides: [{ index: 1, startsAt: laDateToUtcAtTime(week2Date, "17:30").toISOString() }],
            skips: [],
          });
        expect(submit.status).toBe(201);
        expect(submit.body.lessonIds).toHaveLength(3);

        // Verify the second lesson's starts_at matches the override.
        const lessonRows = await adminDb()
          .select({ startsAt: lessons.startsAt })
          .from(lessons)
          .where(eq(lessons.householdId, owner.householdId))
          .orderBy(lessons.startsAt);
        expect(lessonRows).toHaveLength(3);
        expect(lessonRows[1]!.startsAt.getTime()).toBe(
          laDateToUtcAtTime(week2Date, "17:30").getTime(),
        );
      } finally {
        await adminDb().delete(blockedTimes).where(eq(blockedTimes.id, blockId));
      }
    });
  });

  // T4b — flagged week skipped
  it("T4b: a blocked week can be skipped via skips", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(115);
      const weekday = isoWeekdayFor(startDate);
      const week2Date = addDays(startDate, 7);
      const blockedStart = laDateToUtcAtTime(week2Date, "16:00");
      const blockedEnd = laDateToUtcAtTime(week2Date, "17:00");
      const [block] = await adminDb()
        .insert(blockedTimes)
        .values({ startsAt: blockedStart, endsAt: blockedEnd, note: "batch test block" })
        .returning();
      const blockId = block!.id;

      try {
        const submit = await request(app)
          .post("/lessons/batch")
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send({
            mode: "weekly",
            householdId: owner.householdId,
            locationId,
            pattern: [
              {
                weekday,
                timeOfDay: "16:30",
                durationMinutes: 30,
                swimmerIds: [swimmerId],
              },
            ],
            startDate,
            weeks: 3,
            overrides: [],
            skips: [1],
          });
        expect(submit.status).toBe(201);
        expect(submit.body.lessonIds).toHaveLength(2);

        const lessonRows = await adminDb()
          .select({ startsAt: lessons.startsAt })
          .from(lessons)
          .where(eq(lessons.householdId, owner.householdId))
          .orderBy(lessons.startsAt);
        expect(lessonRows).toHaveLength(2);
        // The week-2 blocked slot is absent.
        const week2At1630 = laDateToUtcAtTime(week2Date, "16:30").getTime();
        expect(lessonRows.find((r) => r.startsAt.getTime() === week2At1630)).toBeUndefined();
      } finally {
        await adminDb().delete(blockedTimes).where(eq(blockedTimes.id, blockId));
      }
    });
  });

  // T1 — all-or-nothing rollback
  it("T1: pre-existing conflicting lesson rolls the whole batch back", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(145);
      const weekday = isoWeekdayFor(startDate);
      // Pre-seed a lesson at the week-2 slot (startDate + 7 days when the
      // batch uses a single weekday matching startDate) at 16:30 using a
      // direct insert so the batch's recheck finds it and conflicts.
      const week2 = addDays(startDate, 7);
      const conflictAt = laDateToUtcAtTime(week2, "16:30");
      const seededRows = await adminDb()
        .insert(lessons)
        .values({
          householdId: owner.householdId,
          locationId,
          startsAt: conflictAt,
          durationMinutes: 30,
          type: "private",
          status: "approved",
          requestedBy: owner.userId,
          approvedAt: new Date(),
        })
        .returning({ id: lessons.id });
      const seededId = seededRows[0]!.id;

      try {
        const submit = await request(app)
          .post("/lessons/batch")
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send({
            mode: "weekly",
            householdId: owner.householdId,
            locationId,
            pattern: [
              {
                weekday,
                timeOfDay: "16:30",
                durationMinutes: 30,
                swimmerIds: [swimmerId],
              },
            ],
            startDate,
            weeks: 3,
          });
        expect(submit.status).toBe(422);
        expect(submit.body.error).toBe("picks_conflict");
        // Only the pre-seeded lesson exists — none of the batch's three
        // were written.
        const householdLessonRows = await adminDb()
          .select({ id: lessons.id })
          .from(lessons)
          .where(eq(lessons.householdId, owner.householdId));
        expect(householdLessonRows).toHaveLength(1);
        expect(householdLessonRows[0]!.id).toBe(seededId);
        // No booking_batches row either.
        const batchRows = await adminDb()
          .select({ id: bookingBatches.id })
          .from(bookingBatches)
          .where(eq(bookingBatches.householdId, owner.householdId));
        expect(batchRows).toHaveLength(0);
        // No batch outbox row.
        const outboxRows = await adminDb()
          .select({ id: lessonEmailOutbox.id })
          .from(lessonEmailOutbox)
          .where(eq(lessonEmailOutbox.event, "batch_booked"));
        expect(outboxRows.filter((row) => row.id).length).toBeGreaterThanOrEqual(0);
        // Audit log has no lesson_batch_booked row for this household.
        const auditRows = await adminDb()
          .select({ id: householdAuditLog.id })
          .from(householdAuditLog)
          .where(
            and(
              eq(householdAuditLog.householdId, owner.householdId),
              eq(householdAuditLog.action, "lesson_batch_booked"),
            ),
          );
        expect(auditRows).toHaveLength(0);
      } finally {
        await adminDb().delete(lessons).where(eq(lessons.id, seededId));
      }
    });
  });

  // T7 — one email with the right invites and no per-lesson booking emails
  it("T7: successful batch writes exactly one batch_booked outbox row and no per-lesson rows", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(175);
      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          mode: "weekly",
          householdId: owner.householdId,
          locationId,
          pattern: [
            {
              weekday: 3,
              timeOfDay: "16:30",
              durationMinutes: 30,
              swimmerIds: [swimmerId],
            },
          ],
          startDate,
          weeks: 4,
        });
      expect(submit.status).toBe(201);
      const batchId = submit.body.batchId as string;
      const lessonIds = submit.body.lessonIds as string[];
      expect(lessonIds).toHaveLength(4);

      // Exactly one batch_booked row for this batch.
      const batchOutboxRows = await adminDb()
        .select({
          id: lessonEmailOutbox.id,
          event: lessonEmailOutbox.event,
          batchId: lessonEmailOutbox.batchId,
          lessonId: lessonEmailOutbox.lessonId,
          icsMethod: lessonEmailOutbox.icsMethod,
          icsSequence: lessonEmailOutbox.icsSequence,
          payload: lessonEmailOutbox.payload,
        })
        .from(lessonEmailOutbox)
        .where(eq(lessonEmailOutbox.batchId, batchId));
      expect(batchOutboxRows).toHaveLength(1);
      expect(batchOutboxRows[0]!.event).toBe("batch_booked");
      expect(batchOutboxRows[0]!.lessonId).toBeNull();
      expect(batchOutboxRows[0]!.icsMethod).toBeNull();
      expect(batchOutboxRows[0]!.icsSequence).toBeNull();
      const payload = batchOutboxRows[0]!.payload as {
        lessons: Array<{ lessonId: string; calendarSequence: number; status: string }>;
      };
      expect(payload.lessons).toHaveLength(4);
      // Zero per-lesson booking_requested or lesson_confirmed rows for these
      // batch lessons.
      const perLessonRows = await adminDb()
        .select({ id: lessonEmailOutbox.id })
        .from(lessonEmailOutbox)
        .where(
          and(
            inArray(lessonEmailOutbox.lessonId, lessonIds),
            inArray(lessonEmailOutbox.event, ["booking_requested", "lesson_confirmed"]),
          ),
        );
      expect(perLessonRows).toHaveLength(0);
    });
  });

  // T8 — a lesson canceled before the summary sends is left out of the .ics
  it("T8: a lesson canceled before the summary sends is filtered out of the .ics", async () => {
    await withAllDaysEnabled(async () => {
      // Seed a prior completed lesson at this pool so the household already
      // has trust → the batch auto-approves. Without this, every batch
      // lesson lands as pending, which the send-time filter drops from the
      // .ics (pending has no VEVENT), and the whole row supersedes with
      // "zero_eligible_after_filter."
      const trustSeed = await adminDb()
        .insert(lessons)
        .values({
          householdId: owner.householdId,
          locationId,
          startsAt: new Date(PINNED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
          durationMinutes: 30,
          type: "private",
          status: "completed",
          requestedBy: owner.userId,
          approvedAt: new Date(PINNED_NOW.getTime() - 31 * 24 * 60 * 60 * 1000),
          completedAt: new Date(PINNED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
        })
        .returning({ id: lessons.id });
      const trustSeedId = trustSeed[0]!.id;

      const startDate = futureLaDate(215);
      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          mode: "weekly",
          householdId: owner.householdId,
          locationId,
          pattern: [
            {
              weekday: 3,
              timeOfDay: "16:30",
              durationMinutes: 30,
              swimmerIds: [swimmerId],
            },
          ],
          startDate,
          weeks: 3,
        });
      expect(submit.status).toBe(201);
      expect(submit.body.confirmedCount).toBe(3);
      expect(submit.body.pendingCount).toBe(0);
      const batchId = submit.body.batchId as string;
      const lessonIds = submit.body.lessonIds as string[];
      expect(lessonIds).toHaveLength(3);

      // Poll until the post-commit auto-sender finishes so our scenario
      // starts from a stable "already sent" state. Then we reset the row
      // back to 'pending' and re-send manually with a canceled lesson in
      // the mix — the send-time filter should drop that lesson's VEVENT.
      const outboxRows = await adminDb()
        .select({ id: lessonEmailOutbox.id })
        .from(lessonEmailOutbox)
        .where(eq(lessonEmailOutbox.batchId, batchId));
      expect(outboxRows).toHaveLength(1);
      const outboxId = outboxRows[0]!.id;
      await waitForOutboxTerminal(outboxId);

      // Cancel one lesson and bump its calendar_sequence past snapshot+1
      // so the send-time filter drops it.
      const victimId = lessonIds[1]!;
      await adminDb()
        .update(lessons)
        .set({ status: "canceled", canceledAt: new Date(), calendarSequence: 3 })
        .where(eq(lessons.id, victimId));

      // Reset the batch outbox row to 'pending' so the manual sender
      // call below re-claims it. Simulates the race where the sender had
      // not yet run when the cancellation happened.
      await adminDb()
        .update(lessonEmailOutbox)
        .set({
          status: "pending",
          sentAt: null,
          claimedUntil: null,
          providerMessageId: null,
          attempts: 0,
          lastError: null,
        })
        .where(eq(lessonEmailOutbox.id, outboxId));

      const sendsBefore = transport.sends.length;
      await sendLessonEmailOutboxRow(outboxId);
      const sendsAfter = transport.sends.length;
      expect(sendsAfter).toBe(sendsBefore + 1);
      const latest = transport.sends[sendsAfter - 1]!;
      const ics = latest.options.ics;
      expect(ics).toBeDefined();
      const veventCount = (ics!.content.match(/BEGIN:VEVENT/g) ?? []).length;
      expect(veventCount).toBe(2);
      // The canceled lesson's UID is NOT in the .ics.
      expect(ics!.content).not.toContain(`UID:${victimId}@axiomaquatics.io`);

      await adminDb().delete(lessons).where(eq(lessons.id, trustSeedId));
    });
  });

  // T9 — concurrent single-lesson booking vs batch booking on the same day
  it("T9: concurrent single-lesson and batch booking on the same slot — exactly one wins", async () => {
    await withAllDaysEnabled(async () => {
      // A second household so the single-lesson user is a different household
      // trying to book the same slot (ADR 021 doesn't allow a household to
      // double-book itself anyway).
      const other = await createTestUser("batch-concurrent-other");
      const otherSwimmerRows = await adminDb()
        .insert(swimmers)
        .values({
          firstName: "ConcurrentKid",
          lastName: "Integration",
          birthDate: "2015-01-01",
          sex: "male",
          isPublic: false,
          householdId: other.householdId,
        })
        .returning({ id: swimmers.id });
      const otherSwimmerId = otherSwimmerRows[0]!.id;

      try {
        const startDate = futureLaDate(250);
        const sharedSlot = laDateToUtcAtTime(startDate, "16:30").toISOString();

        const batchBody = {
          mode: "manual" as const,
          householdId: owner.householdId,
          locationId,
          picks: [
            {
              startsAt: sharedSlot,
              durationMinutes: 30 as const,
              swimmerIds: [swimmerId],
            },
            {
              startsAt: laDateToUtcAtTime(addDays(startDate, 7), "16:30").toISOString(),
              durationMinutes: 30 as const,
              swimmerIds: [swimmerId],
            },
          ],
        };
        const singleBody = {
          startsAt: sharedSlot,
          durationMinutes: 30,
          locationId,
          swimmerIds: [otherSwimmerId],
        };

        const [batchRes, singleRes] = await Promise.all([
          request(app)
            .post("/lessons/batch")
            .set("Authorization", `Bearer ${owner.accessToken}`)
            .send(batchBody),
          request(app)
            .post("/lessons")
            .set("Authorization", `Bearer ${other.accessToken}`)
            .send(singleBody),
        ]);

        const statuses = [batchRes.status, singleRes.status].sort();
        expect(statuses).toEqual([201, 422]);

        // Exactly one lesson exists at the shared slot.
        const slotLessons = await adminDb()
          .select({ id: lessons.id, householdId: lessons.householdId })
          .from(lessons)
          .where(
            and(
              eq(lessons.startsAt, new Date(sharedSlot)),
              inArray(lessons.status, ["pending", "approved"]),
            ),
          );
        expect(slotLessons).toHaveLength(1);
      } finally {
        await cleanupHouseholdBatchArtifacts(other.householdId);
        await adminDb().delete(swimmers).where(eq(swimmers.id, otherSwimmerId));
        await other.cleanup();
      }
    });
  });

  // T10: mixed-length preview and submit (per-pick duration end-to-end).
  it("T10: a batch with a 30 and a 45 picks correctly and stores each lesson's own length", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(275);
      // Two picks on the same day that cannot overlap: 30 min at 16:00
      // (ends 16:30) and 45 min at 17:00 (ends 17:45). Default teaching
      // hours are 16:00..20:00 so both sit well inside the window and the
      // slot engine treats each pick with its own length.
      const first = laDateToUtcAtTime(startDate, "16:00");
      const second = laDateToUtcAtTime(startDate, "17:00");
      const body = {
        mode: "manual" as const,
        householdId: owner.householdId,
        locationId,
        picks: [
          {
            startsAt: first.toISOString(),
            durationMinutes: 30 as const,
            swimmerIds: [swimmerId],
          },
          {
            startsAt: second.toISOString(),
            durationMinutes: 45 as const,
            swimmerIds: [swimmerId],
          },
        ],
      };
      const preview = await request(app)
        .post("/lessons/batch/preview")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(body);
      expect(preview.status).toBe(200);
      const previewPicks = preview.body.picks as Array<{
        index: number;
        state: string;
        durationMinutes: number;
      }>;
      expect(previewPicks).toHaveLength(2);
      expect(previewPicks.every((p) => p.state === "available")).toBe(true);
      // Preview echoes each pick's own length.
      expect(previewPicks.find((p) => p.index === 0)!.durationMinutes).toBe(30);
      expect(previewPicks.find((p) => p.index === 1)!.durationMinutes).toBe(45);

      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(body);
      expect(submit.status).toBe(201);
      const lessonIds = submit.body.lessonIds as string[];
      expect(lessonIds).toHaveLength(2);
      const lessonRows = await adminDb()
        .select({
          startsAt: lessons.startsAt,
          durationMinutes: lessons.durationMinutes,
        })
        .from(lessons)
        .where(inArray(lessons.id, lessonIds))
        .orderBy(lessons.startsAt);
      expect(lessonRows).toHaveLength(2);
      // Lessons are written with each pick's own duration, not a batch-wide one.
      expect(lessonRows[0]!.durationMinutes).toBe(30);
      expect(lessonRows[1]!.durationMinutes).toBe(45);
    });
  });

  // T12: per-pick swimmer sets end-to-end. Two picks with different kids
  // book under THOSE kids — not the chip set, not the first pick's set.
  // Regression test for the dev-feedback-2 bug where every lesson was
  // written against the first pick's swimmer list.
  it("T12: two picks with different swimmers book each lesson to the right swimmer", async () => {
    await withAllDaysEnabled(async () => {
      // A second swimmer in the same household so the batch can mix kids.
      const kid2Rows = await adminDb()
        .insert(swimmers)
        .values({
          firstName: "BatchKidTwo",
          lastName: "Integration",
          birthDate: "2018-01-01",
          sex: "male",
          isPublic: false,
          householdId: owner.householdId,
        })
        .returning({ id: swimmers.id });
      const kid2Id = kid2Rows[0]!.id;

      try {
        const startDate = futureLaDate(305);
        // Two 30-min picks on the same day, non-overlapping: 16:00 is kid1's,
        // 17:00 is kid2's. The server derives each lesson's `type` from the
        // pick's `swimmerIds.length` and inserts `lesson_swimmers` from the
        // pick's own list.
        const first = laDateToUtcAtTime(startDate, "16:00");
        const second = laDateToUtcAtTime(startDate, "17:00");
        const body = {
          mode: "manual" as const,
          householdId: owner.householdId,
          locationId,
          picks: [
            {
              startsAt: first.toISOString(),
              durationMinutes: 30 as const,
              swimmerIds: [swimmerId],
            },
            {
              startsAt: second.toISOString(),
              durationMinutes: 30 as const,
              swimmerIds: [kid2Id],
            },
          ],
        };

        const submit = await request(app)
          .post("/lessons/batch")
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send(body);
        expect(submit.status).toBe(201);
        const lessonIds = submit.body.lessonIds as string[];
        expect(lessonIds).toHaveLength(2);

        // Pull every lesson with its swimmers. Compare by startsAt so the
        // test tolerates whichever pick-asc order picksAsc produced.
        const lessonRows = await adminDb()
          .select({
            id: lessons.id,
            startsAt: lessons.startsAt,
            type: lessons.type,
          })
          .from(lessons)
          .where(inArray(lessons.id, lessonIds));
        const swimmerRows = await adminDb()
          .select({
            lessonId: lessonSwimmers.lessonId,
            swimmerId: lessonSwimmers.swimmerId,
          })
          .from(lessonSwimmers)
          .where(inArray(lessonSwimmers.lessonId, lessonIds));
        const byStartsAt = new Map(lessonRows.map((row) => [row.startsAt.toISOString(), row]));
        const swimmerIdsByLessonId = new Map<string, string[]>();
        for (const row of swimmerRows) {
          const list = swimmerIdsByLessonId.get(row.lessonId) ?? [];
          list.push(row.swimmerId);
          swimmerIdsByLessonId.set(row.lessonId, list);
        }

        const firstLesson = byStartsAt.get(first.toISOString())!;
        const secondLesson = byStartsAt.get(second.toISOString())!;
        // Each lesson got exactly the pick's swimmer, no cross-pollination.
        expect(swimmerIdsByLessonId.get(firstLesson.id)).toEqual([swimmerId]);
        expect(swimmerIdsByLessonId.get(secondLesson.id)).toEqual([kid2Id]);
        // Both lessons derived their type per-lesson from swimmer count.
        expect(firstLesson.type).toBe("private");
        expect(secondLesson.type).toBe("private");
      } finally {
        // Clean up the second swimmer. The main afterAll closes the owner
        // household; this just drops the extra kid so subsequent tests see
        // the suite's single-swimmer fixture.
        await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, kid2Id));
        await adminDb().delete(swimmers).where(eq(swimmers.id, kid2Id));
      }
    });
  });

  // T13: the batch_booked email outbox payload names the right child on
  // each lesson row. Regression test for the review finding that
  // insertedLessons was positionally zipped with picksAsc — if that ever
  // drifted, a parent would see a lesson in their confirmation email
  // attributed to the wrong kid. We now generate lesson ids up front and
  // key per-lesson first names by lesson id, so this test exercises the
  // id-keyed path end-to-end.
  it("T13: per-lesson swimmerFirstNames in the batch_booked payload match the pick's swimmer", async () => {
    await withAllDaysEnabled(async () => {
      const kid2Rows = await adminDb()
        .insert(swimmers)
        .values({
          firstName: "BatchKidTwoEmail",
          lastName: "Integration",
          birthDate: "2018-01-01",
          sex: "male",
          isPublic: false,
          householdId: owner.householdId,
        })
        .returning({ id: swimmers.id });
      const kid2Id = kid2Rows[0]!.id;

      try {
        const startDate = futureLaDate(306);
        const first = laDateToUtcAtTime(startDate, "16:00");
        const second = laDateToUtcAtTime(startDate, "17:00");
        const body = {
          mode: "manual" as const,
          householdId: owner.householdId,
          locationId,
          picks: [
            {
              startsAt: first.toISOString(),
              durationMinutes: 30 as const,
              swimmerIds: [swimmerId],
            },
            {
              startsAt: second.toISOString(),
              durationMinutes: 30 as const,
              swimmerIds: [kid2Id],
            },
          ],
        };

        const submit = await request(app)
          .post("/lessons/batch")
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send(body);
        expect(submit.status).toBe(201);
        const lessonIds = submit.body.lessonIds as string[];
        const batchId = submit.body.batchId as string;
        expect(lessonIds).toHaveLength(2);

        // Resolve the two swimmers' first names from the DB so the test is
        // insensitive to how they were spelled in the fixture — we just
        // need to compare against the actual stored values.
        const nameRows = await adminDb()
          .select({ id: swimmers.id, firstName: swimmers.firstName })
          .from(swimmers)
          .where(inArray(swimmers.id, [swimmerId, kid2Id]));
        const nameById = new Map(nameRows.map((row) => [row.id, row.firstName]));

        // Map lesson id → startsAt so we can locate each pick's row in the
        // payload without assuming order.
        const lessonStartRows = await adminDb()
          .select({ id: lessons.id, startsAt: lessons.startsAt })
          .from(lessons)
          .where(inArray(lessons.id, lessonIds));
        const startByLessonId = new Map(
          lessonStartRows.map((row) => [row.id, row.startsAt.toISOString()]),
        );

        const outboxRows = await adminDb()
          .select({ payload: lessonEmailOutbox.payload })
          .from(lessonEmailOutbox)
          .where(eq(lessonEmailOutbox.batchId, batchId));
        expect(outboxRows).toHaveLength(1);
        const payload = outboxRows[0]!.payload as {
          lessons: Array<{ lessonId: string; swimmerFirstNames: string[] }>;
        };
        expect(payload.lessons).toHaveLength(2);

        for (const payloadLesson of payload.lessons) {
          const startsAtIso = startByLessonId.get(payloadLesson.lessonId);
          expect(startsAtIso).toBeDefined();
          const expectedSwimmerId =
            startsAtIso === first.toISOString() ? swimmerId : kid2Id;
          const expectedFirstName = nameById.get(expectedSwimmerId)!;
          expect(payloadLesson.swimmerFirstNames).toEqual([expectedFirstName]);
        }
      } finally {
        await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, kid2Id));
        await adminDb().delete(swimmers).where(eq(swimmers.id, kid2Id));
      }
    });
  });

  // T11: a 45-min pick overlapping a 30-min pick in the same batch is
  // flagged conflicts_batch. Submit returns 422 and writes nothing.
  it("T11: a 45-min pick overlapping a 30-min pick is flagged conflicts_batch", async () => {
    await withAllDaysEnabled(async () => {
      const startDate = futureLaDate(290);
      // 30-min pick 16:00..16:30, 45-min pick 16:15..17:00. The second
      // starts inside the first's span. Default teaching hours
      // (16:00..20:00) accommodate both so the only reason to flag either
      // is the batch-level overlap check.
      const first = laDateToUtcAtTime(startDate, "16:00");
      const second = laDateToUtcAtTime(startDate, "16:15");
      const body = {
        mode: "manual" as const,
        householdId: owner.householdId,
        locationId,
        picks: [
          {
            startsAt: first.toISOString(),
            durationMinutes: 30 as const,
            swimmerIds: [swimmerId],
          },
          {
            startsAt: second.toISOString(),
            durationMinutes: 45 as const,
            swimmerIds: [swimmerId],
          },
        ],
      };
      const preview = await request(app)
        .post("/lessons/batch/preview")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(body);
      expect(preview.status).toBe(200);
      const previewPicks = preview.body.picks as Array<{ index: number; state: string }>;
      // At least one of the two is flagged as conflicts_batch (the one
      // seen second in picks-ascending order).
      expect(previewPicks.some((p) => p.state === "conflicts_batch")).toBe(true);

      const submit = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send(body);
      expect(submit.status).toBe(422);
      expect(submit.body.error).toBe("picks_conflict");
      // Nothing written.
      const householdLessonRows = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, owner.householdId));
      expect(householdLessonRows).toHaveLength(0);
    });
  });
});
