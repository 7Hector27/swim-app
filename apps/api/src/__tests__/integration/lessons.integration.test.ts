import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq } from "drizzle-orm";
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
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../../db/schema";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Shared state ──────────────────────────────────────────────────────────────

let owner: TestUser;
let viewer: TestUser;
let locationId: string;
let swimmerId: string;

// A future Tuesday in school-year. Must be in config.lessonDays.
// Using a date far enough in the future to be within 10 weeks but > 16 h away.
function futureSlot(): string {
  // Pick a date 2 days from now at 23:30 UTC (= 16:30 PDT).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(23, 30, 0, 0);
  return d.toISOString();
}

beforeAll(async () => {
  owner = await createTestUser("lessons-owner");
  viewer = await createTestUserInHousehold("lessons-viewer", owner.householdId, "viewer");

  // Get the first named location.
  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  // Create a swimmer for the owner's household.
  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "TestSwimmer",
      lastName: "Integration",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]?.id ?? "";
});

afterAll(async () => {
  // Clean up lessons + lesson_swimmers (cascade) then swimmers.
  if (swimmerId) {
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId));
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (viewer) await viewer.cleanup();
  if (owner) await owner.cleanup();
  await closeAdminDb();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getConfig() {
  const rows = await adminDb().select().from(availabilityConfig).limit(1);
  return rows[0]!;
}

// Ensure today's day is in lessonDays for the integration test by temporarily
// patching the config, then restore after the test.
// We just add all weekdays [1,2,3,4,5] to make sure the slot date works.
async function withAllWeekdaysEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const config = await getConfig();
  const original = config.lessonDays;
  await adminDb()
    .update(availabilityConfig)
    .set({ lessonDays: [1, 2, 3, 4, 5] })
    .where(eq(availabilityConfig.id, config.id));
  try {
    return await fn();
  } finally {
    await adminDb()
      .update(availabilityConfig)
      .set({ lessonDays: original })
      .where(eq(availabilityConfig.id, config.id));
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /lessons (integration)", () => {
  it("viewer calling POST /lessons → 403", async () => {
    const res = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({
        startsAt: futureSlot(),
        durationMinutes: 30,
        locationId,
        swimmerIds: [swimmerId],
      });

    expect(res.status).toBe(403);
  });

  it("concurrent booking: exactly one succeeds, the other gets 422 slot_unavailable", async () => {
    if (!locationId || !swimmerId) {
      console.warn("Skipping concurrent test: no location or swimmer available");
      return;
    }

    await withAllWeekdaysEnabled(async () => {
      // First, create a second test user so we have two separate households
      // trying to book the same slot simultaneously.
      const owner2 = await createTestUser("lessons-concurrent");
      const swimmerRows2 = await adminDb()
        .insert(swimmers)
        .values({
          firstName: "TestSwimmer2",
          lastName: "Concurrent",
          birthDate: "2015-01-01",
          sex: "male",
          isPublic: false,
          householdId: owner2.householdId,
        })
        .returning({ id: swimmers.id });
      const swimmerId2 = swimmerRows2[0]?.id ?? "";

      try {
        const slot = futureSlot();

        const [res1, res2] = await Promise.all([
          request(app)
            .post("/lessons")
            .set("Authorization", `Bearer ${owner.accessToken}`)
            .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId] }),
          request(app)
            .post("/lessons")
            .set("Authorization", `Bearer ${owner2.accessToken}`)
            .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId2] }),
        ]);

        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toEqual([201, 422]);

        const failBody = res1.status === 422 ? res1.body : res2.body;
        expect(failBody.error).toBe("slot_unavailable");

        // Clean up lessons created in this test.
        await adminDb().delete(lessons).where(eq(lessons.householdId, owner2.householdId));
        await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
        await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId2));
      } finally {
        await owner2.cleanup();
      }
    });
  });
});
