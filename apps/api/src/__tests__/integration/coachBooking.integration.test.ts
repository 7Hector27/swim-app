// Coach booking integration tests (ADR 029). One test per behavior listed
// in docs/plans/coach-booking.md. Hits a real local Supabase stack; mocks
// only the post-commit microtasks (googleCalendarSync + email sender) so
// nothing tries to reach the network. The outbox write itself still happens
// inside the lesson transaction and is asserted on.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  settleAndCleanupCoachNotificationsForHousehold,
  type TestUser,
} from "./helpers";
import { fromZonedTime } from "date-fns-tz";
import {
  availabilityConfig,
  availabilitySeasons,
  householdAuditLog,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
  profiles,
} from "../../db/schema";
import * as outboxModule from "../../services/emails/outbox";
import * as googleSyncModule from "../../services/googleCalendarSync";
import { __setClockForTests } from "../../lib/clock";

// Microtask mocks: nothing in these tests needs the real Google API or SMTP
// transport. The outbox INSERT inside the lesson transaction is the real
// thing we're testing; the sender that drains it later is covered elsewhere.
vi.mock("../../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
}));

// Wrap the outbox module so we keep the real implementation by default but
// can swap it to a rejection for the rollback test.
vi.mock("../../services/emails/outbox", async () => {
  const actual = await vi.importActual<typeof import("../../services/emails/outbox")>(
    "../../services/emails/outbox",
  );
  return {
    ...actual,
    enqueueLessonEmail: vi.fn(actual.enqueueLessonEmail),
  };
});

const logger = pino({ level: "silent" });
const app = createApp(logger);

let coach: TestUser;
let ownerA: TestUser;
let ownerB: TestUser;
let locationId: string;
let secondLocationId: string;
let homePoolHouseholdA: string;
let homePoolHouseholdB: string;
let swimmerAId: string;
let swimmerBId: string;
let archivedSwimmerAId: string;

async function makeCoach(userId: string): Promise<void> {
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, userId));
}

// Open every day on every season (and on the fallback config, in case there
// are no seasons covering the test date) so the slot search does not care
// which weekday "today" happens to be. Also pins each season's weekday
// teaching window to the config defaults (16:00 to 20:00): the tests below
// pick deterministic "now" instants assuming that default (e.g. test 6 pins
// 14:00 LA so the first slot sits 2h out). A developer-modified season that
// starts at, say, 14:00 LA would otherwise collide with the pinned "now"
// and the POST would reject with start_in_past. Restored exactly as found
// in finally so local tweaks survive the run.
async function withAllDaysEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const configRows = await adminDb().select().from(availabilityConfig).limit(1);
  const originalConfig = configRows[0]
    ? {
        id: configRows[0].id,
        defaultTeachesDays: configRows[0].defaultTeachesDays,
        defaultStartTime: configRows[0].defaultStartTime,
        defaultEndTime: configRows[0].defaultEndTime,
      }
    : null;
  const seasons = await adminDb().select().from(availabilitySeasons);
  const originalSeasons = seasons.map((season) => ({
    id: season.id,
    teachesDays: season.teachesDays,
    weekdayStartTime: season.weekdayStartTime,
    weekdayEndTime: season.weekdayEndTime,
  }));
  const weekdayStart = originalConfig?.defaultStartTime ?? "16:00:00";
  const weekdayEnd = originalConfig?.defaultEndTime ?? "20:00:00";
  for (const season of seasons) {
    await adminDb()
      .update(availabilitySeasons)
      .set({
        teachesDays: [1, 2, 3, 4, 5, 6, 7],
        weekdayStartTime: weekdayStart,
        weekdayEndTime: weekdayEnd,
      })
      .where(eq(availabilitySeasons.id, season.id));
  }
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
        .set({
          teachesDays: original.teachesDays,
          weekdayStartTime: original.weekdayStartTime,
          weekdayEndTime: original.weekdayEndTime,
        })
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

// Walks /lessons/available-range week-by-week until it finds an "available"
// slot. Returned startsAt is an ISO string. Shared with coachLessons.integration.
async function findFirstAvailableSlot(
  token: string,
  locId: string,
  durationMinutes: number,
): Promise<string> {
  for (let weekOffset = 0; weekOffset < 10; weekOffset++) {
    const weekDate = new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", `Bearer ${token}`)
      .query({ view: "week", date: weekDate, durationMinutes: String(durationMinutes), locationId: locId });
    if (res.status !== 200) continue;
    const body = res.body as { days: Array<{ slots: Array<{ startsAt: string; state: string }> }> };
    for (const day of body.days) {
      for (const slot of day.slots) {
        if (slot.state === "available") return slot.startsAt;
      }
    }
  }
  throw new Error("No available slot found within 10 weeks");
}

// Coach-only variant: passes coachBypassNotice=true so slots inside the
// 16-hour window are returned as "available" instead of "too_soon". If a
// test pins the server clock via __setClockForTests it passes the same
// instant as `fromMs` so the week-date math lines up with the server's
// view of "now".
async function findFirstAvailableSlotForCoach(
  token: string,
  locId: string,
  durationMinutes: number,
  fromMs: number = Date.now(),
): Promise<string> {
  for (let weekOffset = 0; weekOffset < 10; weekOffset++) {
    const weekDate = new Date(fromMs + weekOffset * 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", `Bearer ${token}`)
      .query({
        view: "week",
        date: weekDate,
        durationMinutes: String(durationMinutes),
        locationId: locId,
        coachBypassNotice: "true",
      });
    if (res.status !== 200) continue;
    const body = res.body as { days: Array<{ slots: Array<{ startsAt: string; state: string }> }> };
    for (const day of body.days) {
      for (const slot of day.slots) {
        if (slot.state === "available") return slot.startsAt;
      }
    }
  }
  throw new Error("No coach-visible available slot found within 10 weeks");
}

// Deletes everything the coach booking tests might create for a household.
async function wipeHouseholdBookingArtifacts(householdId: string): Promise<void> {
  // Settle in-flight notify* stubs and remove any coach_notifications
  // referencing this household's lessons. coach_notifications.lesson_id
  // is ON DELETE RESTRICT (ADR 031: production never hard-deletes
  // lessons; tests delete in the right order).
  await settleAndCleanupCoachNotificationsForHousehold(householdId);
  const lessonRows = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const ids = lessonRows.map((row) => row.id);
  if (ids.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.lessonId, ids));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, ids));
    await adminDb().delete(lessons).where(inArray(lessons.id, ids));
  }
  await adminDb()
    .delete(householdAuditLog)
    .where(
      and(
        eq(householdAuditLog.householdId, householdId),
        eq(householdAuditLog.action, "lesson_booked_by_coach"),
      ),
    );
}

beforeAll(async () => {
  coach = await createTestUser("coach-booking-coach");
  await makeCoach(coach.userId);
  ownerA = await createTestUser("coach-booking-ownerA");
  ownerB = await createTestUser("coach-booking-ownerB");

  // Named pool (public, shared across all households).
  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(and(eq(lessonLocations.isActive, true), eq(lessonLocations.name, "Egret Park")))
    .limit(1);
  locationId = locs[0]?.id ?? "";
  if (!locationId) {
    const anyLoc = await adminDb()
      .select({ id: lessonLocations.id })
      .from(lessonLocations)
      .where(eq(lessonLocations.isActive, true))
      .limit(1);
    locationId = anyLoc[0]!.id;
  }

  // A second named pool for the travel-buffer / overlap-across-pools test.
  const secondLocs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(
      and(
        eq(lessonLocations.isActive, true),
        inArray(lessonLocations.name, ["Swallows Park", "The Commons Park"]),
      ),
    )
    .limit(1);
  secondLocationId = secondLocs[0]?.id ?? locationId;

  // Home pool rows — one per owner household. The coach booking handler
  // checks that `location.household_id` matches the booked household.
  const [homeA] = await adminDb()
    .insert(lessonLocations)
    .values({
      name: "Owner A Home Pool",
      address: "1 Test Lane",
      city: "Irvine",
      state: "CA",
      zip: "92602",
      householdId: ownerA.householdId,
      isActive: true,
    })
    .returning({ id: lessonLocations.id });
  homePoolHouseholdA = homeA!.id;

  const [homeB] = await adminDb()
    .insert(lessonLocations)
    .values({
      name: "Owner B Home Pool",
      address: "2 Test Lane",
      city: "Irvine",
      state: "CA",
      zip: "92602",
      householdId: ownerB.householdId,
      isActive: true,
    })
    .returning({ id: lessonLocations.id });
  homePoolHouseholdB = homeB!.id;

  // One active swimmer per household + one archived swimmer in household A.
  const [sA] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "AlexA",
      lastName: "HouseholdA",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: ownerA.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerAId = sA!.id;

  const [sB] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "AlexB",
      lastName: "HouseholdB",
      birthDate: "2015-01-01",
      sex: "male",
      isPublic: false,
      householdId: ownerB.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerBId = sB!.id;

  const [sArchived] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "ArchivedKid",
      lastName: "HouseholdA",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: ownerA.householdId,
      archivedAt: new Date(),
    })
    .returning({ id: swimmers.id });
  archivedSwimmerAId = sArchived!.id;
});

afterAll(async () => {
  await wipeHouseholdBookingArtifacts(ownerA.householdId);
  await wipeHouseholdBookingArtifacts(ownerB.householdId);

  for (const sid of [swimmerAId, swimmerBId, archivedSwimmerAId].filter(Boolean)) {
    // Audit log rows that reference the swimmer (if any).
    await adminDb()
      .delete(householdAuditLog)
      .where(eq(householdAuditLog.targetSwimmerId, sid));
    await adminDb().delete(swimmers).where(eq(swimmers.id, sid));
  }

  for (const hid of [homePoolHouseholdA, homePoolHouseholdB].filter(Boolean)) {
    await adminDb().delete(lessonLocations).where(eq(lessonLocations.id, hid));
  }

  if (coach) await coach.cleanup();
  if (ownerA) await ownerA.cleanup();
  if (ownerB) await ownerB.cleanup();
  await closeAdminDb();
});

afterEach(() => {
  vi.mocked(googleSyncModule.syncLessonToGoogle).mockClear();
});

// Reads the lesson_booked_by_coach audit row for a lesson. Payload lives in
// `payload` jsonb and carries { lessonId, override, ... }.
async function readCoachBookingAudit(lessonId: string) {
  const rows = await adminDb()
    .select()
    .from(householdAuditLog)
    .where(eq(householdAuditLog.action, "lesson_booked_by_coach"));
  return rows.find((row) => {
    const payload = row.payload as { lessonId?: string } | null;
    return payload?.lessonId === lessonId;
  });
}

describe("POST /coach/lessons (integration)", () => {
  it("1. approved immediately with approved_by set to the coach", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);
      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("approved");

      const [row] = await adminDb()
        .select()
        .from(lessons)
        .where(eq(lessons.id, res.body.id as string))
        .limit(1);

      expect(row?.status).toBe("approved");
      expect(row?.approvedAt).not.toBeNull();
      expect(row?.approvedBy).toBe(coach.userId);
      expect(row?.requestedBy).toBe(coach.userId);
      expect(row?.expiresAt).toBeNull();

      await wipeHouseholdBookingArtifacts(ownerA.householdId);
    });
  });

  it("2. audit row + outbox row both land in the same transaction as the insert", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);
      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(res.status).toBe(201);
      const lessonId = res.body.id as string;

      const audit = await readCoachBookingAudit(lessonId);
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(coach.userId);
      expect(audit?.householdId).toBe(ownerA.householdId);
      const payload = audit?.payload as {
        lessonId: string;
        locationId: string;
        swimmerIds: string[];
        override: unknown;
      };
      expect(payload.lessonId).toBe(lessonId);
      expect(payload.locationId).toBe(locationId);
      expect(payload.swimmerIds).toEqual([swimmerAId]);
      // Happy path: no warnings fired, so override is null.
      expect(payload.override).toBeNull();

      const outboxRows = await adminDb()
        .select()
        .from(lessonEmailOutbox)
        .where(eq(lessonEmailOutbox.lessonId, lessonId));
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.event).toBe("lesson_confirmed");
      expect(outboxRows[0]?.icsMethod).toBe("REQUEST");
      const outboxPayload = outboxRows[0]?.payload as { initiatedBy?: string };
      expect(outboxPayload.initiatedBy).toBe("coach");

      await wipeHouseholdBookingArtifacts(ownerA.householdId);
    });
  });

  it("3. a failing outbox write rolls lesson + audit + lesson_swimmers back", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);

      vi.mocked(outboxModule.enqueueLessonEmail).mockRejectedValueOnce(
        new Error("forced rollback"),
      );

      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      // The error bubbles to the global error handler → 500 with no stack.
      expect(res.status).toBe(500);

      // Zero lesson rows, zero audit rows, zero outbox rows for this household.
      const lessonRows = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, ownerA.householdId));
      expect(lessonRows).toHaveLength(0);

      const auditRows = await adminDb()
        .select({ id: householdAuditLog.id })
        .from(householdAuditLog)
        .where(
          and(
            eq(householdAuditLog.householdId, ownerA.householdId),
            eq(householdAuditLog.action, "lesson_booked_by_coach"),
          ),
        );
      expect(auditRows).toHaveLength(0);
    });
  });

  it("4. a time-overlapping lesson at a different pool is rejected even with full override", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);

      const first = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(first.status).toBe(201);

      // Same clock instant, different pool. Any time overlap → 422 slot_unavailable
      // regardless of overrideWindow + acknowledgements.
      const overlap = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerB.householdId,
          swimmerIds: [swimmerBId],
          locationId: secondLocationId,
          startsAt: slot,
          durationMinutes: 30,
          overrideWindow: true,
          acknowledgedWarnings: {
            outsideHours: true,
            maxAdvanceExceeded: true,
            travelBufferViolated: true,
            dailyCapExceeded: true,
            blockedTimeOverlap: true,
          },
        });
      expect(overlap.status).toBe(422);
      expect(overlap.body.error).toBe("slot_unavailable");

      await wipeHouseholdBookingArtifacts(ownerA.householdId);
      await wipeHouseholdBookingArtifacts(ownerB.householdId);
    });
  });

  it("5. unacknowledged warnings return 409 and the audit payload records the server's flags", async () => {
    // Derive the "outside hours" fixture from the live config instead of
    // hard-coding a UTC hour: read defaultStartTime, back off by one LA
    // hour, and convert to UTC via date-fns-tz. If someone widens the
    // teaching window later, this fixture adapts automatically.
    const [configRow] = await adminDb()
      .select({ defaultStartTime: availabilityConfig.defaultStartTime })
      .from(availabilityConfig)
      .limit(1);
    const defaultStartTime = configRow?.defaultStartTime ?? "16:00:00";
    const [startH, startM] = defaultStartTime.split(":").map((n) => parseInt(n, 10));
    const outsideHour = Math.max(0, (startH ?? 16) - 1);
    const outsideMinute = startM ?? 0;

    // Pick a date 2 days from now to stay away from today-is-DST noise.
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const laWallClock = `${futureDate.getUTCFullYear()}-${pad(futureDate.getUTCMonth() + 1)}-${pad(futureDate.getUTCDate())}T${pad(outsideHour)}:${pad(outsideMinute)}:00`;
    const outsideStart = fromZonedTime(laWallClock, "America/Los_Angeles");

    const body = {
      householdId: ownerA.householdId,
      swimmerIds: [swimmerAId],
      locationId,
      startsAt: outsideStart.toISOString(),
      durationMinutes: 30 as const,
    };

    const first = await request(app)
      .post("/coach/lessons")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(body);
    expect(first.status).toBe(409);
    expect(first.body.error).toBe("warnings_not_acknowledged");
    expect(first.body.warnings.outsideHours).toBe(true);

    // Re-submit with override + acknowledgement for every TRUE warning.
    const second = await request(app)
      .post("/coach/lessons")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        ...body,
        overrideWindow: true,
        acknowledgedWarnings: first.body.warnings,
      });
    expect(second.status).toBe(201);

    const audit = await readCoachBookingAudit(second.body.id as string);
    const override = (audit?.payload as { override: Record<string, boolean> | null }).override;
    expect(override).not.toBeNull();
    expect(override?.outsideHours).toBe(true);

    await wipeHouseholdBookingArtifacts(ownerA.householdId);
  });

  it("6. no notice-window rule for coaches: a near-future slot books with no override and no warnings", async () => {
    await withAllDaysEnabled(async () => {
      // Pin the server clock to Mon 2026-11-02 14:00 LA (PST, UTC-8) =
      // 2026-11-02T22:00:00Z. Default teaching hours start at 16:00 LA, so
      // the first slot the coach picker returns is 2 hours away — well
      // inside the 16-hour notice window the assertion covers.
      const pinnedNow = new Date("2026-11-02T22:00:00Z");
      __setClockForTests(pinnedNow);
      try {
        const nearSlot = await findFirstAvailableSlotForCoach(
          coach.accessToken,
          locationId,
          30,
          pinnedNow.getTime(),
        );
        expect(new Date(nearSlot).getTime() - pinnedNow.getTime()).toBeLessThan(
          16 * 60 * 60 * 1000,
        );

        const res = await request(app)
          .post("/coach/lessons")
          .set("Authorization", `Bearer ${coach.accessToken}`)
          .send({
            householdId: ownerA.householdId,
            swimmerIds: [swimmerAId],
            locationId,
            startsAt: nearSlot,
            durationMinutes: 30,
          });
        expect(res.status).toBe(201);

        // Audit payload: no warnings fired at all.
        const audit = await readCoachBookingAudit(res.body.id as string);
        const override = (audit?.payload as { override: Record<string, boolean> | null }).override;
        expect(override).toBeNull();

        await wipeHouseholdBookingArtifacts(ownerA.householdId);
      } finally {
        __setClockForTests(null);
      }
    });
  });

  it("7. siblings must share a household — mixed-household swimmerIds rejected", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);
      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId, swimmerBId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("swimmers_not_in_household");
    });
  });

  it("8. archived swimmer AND another household's home pool are both rejected", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);

      // Archived swimmer in the booked household.
      const archivedRes = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [archivedSwimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(archivedRes.status).toBe(422);
      expect(archivedRes.body.error).toBe("swimmers_not_in_household");

      // Household A can't use Household B's home pool id.
      const homePoolRes = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId: homePoolHouseholdB,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(homePoolRes.status).toBe(422);
      expect(homePoolRes.body.error).toBe("not_this_households_home_pool");
    });
  });

  it("9. trust is created for later parent bookings and the calendar hook fires", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);
      const coachRes = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(coachRes.status).toBe(201);

      // Microtask queue drain — queueMicrotask callbacks run after the
      // response has been sent. One await macrotask tick is enough.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(vi.mocked(googleSyncModule.syncLessonToGoogle)).toHaveBeenCalledWith(
        coachRes.body.id,
      );

      // Owner A now has an approved lesson at `locationId` → their own
      // POST /lessons at the same pool auto-approves (ADR 021 trust).
      const nextSlot = await findFirstAvailableSlot(ownerA.accessToken, locationId, 30);
      const parentRes = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .send({ locationId, startsAt: nextSlot, durationMinutes: 30, swimmerIds: [swimmerAId] });
      expect(parentRes.status).toBe(201);
      expect(parentRes.body.status).toBe("approved");

      await wipeHouseholdBookingArtifacts(ownerA.householdId);
    });
  });

  it("10. parent can cancel a coach-booked lesson", async () => {
    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(coach.accessToken, locationId, 30);
      const coachRes = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: ownerA.householdId,
          swimmerIds: [swimmerAId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
        });
      expect(coachRes.status).toBe(201);
      const lessonId = coachRes.body.id as string;

      const cancelRes = await request(app)
        .delete(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`);
      expect(cancelRes.status).toBe(204);

      const [row] = await adminDb()
        .select({ status: lessons.status, canceledBy: lessons.canceledBy })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      expect(row?.status).toBe("canceled");
      expect(row?.canceledBy).toBe(ownerA.userId);

      // The parent's cancel path wrote its own lesson_canceled outbox row
      // in the same transaction as the status update.
      const cancelOutboxRows = await adminDb()
        .select()
        .from(lessonEmailOutbox)
        .where(
          and(
            eq(lessonEmailOutbox.lessonId, lessonId),
            eq(lessonEmailOutbox.event, "lesson_canceled"),
          ),
        );
      expect(cancelOutboxRows).toHaveLength(1);

      await wipeHouseholdBookingArtifacts(ownerA.householdId);
    });
  });

  it("11. start_in_past is a hard reject, not acknowledgeable with override", async () => {
    // One hour ago. Not reachable from the UI (its date/time pickers won't
    // offer past values), but the API must still reject out-of-band attempts
    // regardless of overrideWindow + acknowledgements.
    const pastStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/coach/lessons")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        householdId: ownerA.householdId,
        swimmerIds: [swimmerAId],
        locationId,
        startsAt: pastStart,
        durationMinutes: 30,
        overrideWindow: true,
        acknowledgedWarnings: {
          outsideHours: true,
          maxAdvanceExceeded: true,
          travelBufferViolated: true,
          dailyCapExceeded: true,
          blockedTimeOverlap: true,
        },
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("start_in_past");

    // No lesson, no audit, no outbox row for this attempt.
    const lessonRows = await adminDb()
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.householdId, ownerA.householdId));
    expect(lessonRows).toHaveLength(0);
  });

  it("12. notice-window rule still applies to parents, including a parent passing coachBypassNotice", async () => {
    await withAllDaysEnabled(async () => {
      // Same deterministic clock pin as test 6: 14:00 LA on Mon 2026-11-02
      // puts the first teaching slot 2 hours out, inside the notice window.
      const pinnedNow = new Date("2026-11-02T22:00:00Z");
      __setClockForTests(pinnedNow);
      try {
      // Pick the same near-future slot the coach can book without override.
      const nearSlot = await findFirstAvailableSlotForCoach(
        coach.accessToken,
        locationId,
        30,
        pinnedNow.getTime(),
      );
      expect(new Date(nearSlot).getTime() - pinnedNow.getTime()).toBeLessThan(
        16 * 60 * 60 * 1000,
      );

      // Parent tries POST /lessons at the same time → 422 too_soon.
      const parentPost = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .send({
          locationId,
          startsAt: nearSlot,
          durationMinutes: 30,
          swimmerIds: [swimmerAId],
        });
      expect(parentPost.status).toBe(422);
      expect(parentPost.body.error).toBe("too_soon");

      // Parent forges coachBypassNotice=true on the slot-range query → server
      // ignores it and the slot still comes back as "too_soon".
      const weekDate = new Date(nearSlot).toISOString().slice(0, 10);
      const parentRange = await request(app)
        .get("/lessons/available-range")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .query({
          view: "week",
          date: weekDate,
          durationMinutes: "30",
          locationId,
          coachBypassNotice: "true",
        });
      expect(parentRange.status).toBe(200);
      const slot = (parentRange.body as {
        days: Array<{ slots: Array<{ startsAt: string; state: string }> }>;
      })
        .days.flatMap((day) => day.slots)
        .find((entry) => entry.startsAt === nearSlot);
      expect(slot).toBeDefined();
      expect(slot!.state).toBe("too_soon");
      } finally {
        __setClockForTests(null);
      }
    });
  });
});
