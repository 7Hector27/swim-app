// Tests for GET /swimmers/:id/personal-bests (parent route)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  hardDeleteSwimmer,
} from "./helpers";
import type { TestUser } from "./helpers";
import { meetSwims, meets, profiles, swimmers } from "../../db/schema";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let owner: TestUser;
let viewer: TestUser;
let otherHousehold: TestUser;
let swimmerId: string;
let archivedSwimmerId: string;
let meetId: string;

beforeAll(async () => {
  owner = await createTestUser("parent-pb-owner");

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "PBTest",
      lastName: "Swimmer",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]!.id;

  const archivedRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Archived",
      lastName: "Swimmer",
      birthDate: "2015-02-02",
      sex: "male",
      isPublic: false,
      householdId: owner.householdId,
      archivedAt: new Date(),
    })
    .returning({ id: swimmers.id });
  archivedSwimmerId = archivedRows[0]!.id;

  meetId = randomUUID();
  await adminDb().insert(meets).values({
    id: meetId,
    name: "PB Test Invitational",
    meetDate: "2026-09-15",
    course: "scy",
    createdBy: owner.userId,
  });

  // Three meet swims: two in 50 free (slower first, then PB), one in 100 back.
  await adminDb().insert(meetSwims).values([
    {
      swimmerId,
      meetId,
      swimType: "meet",
      eventDistance: 50,
      eventStroke: "free",
      course: "scy",
      swumOn: "2026-09-15",
      timeHundredths: 3800,
      createdBy: owner.userId,
    },
    {
      swimmerId,
      meetId,
      swimType: "meet",
      eventDistance: 50,
      eventStroke: "free",
      course: "scy",
      swumOn: "2026-09-15",
      timeHundredths: 3214,
      createdBy: owner.userId,
    },
    {
      swimmerId,
      meetId,
      swimType: "meet",
      eventDistance: 100,
      eventStroke: "back",
      course: "scy",
      swumOn: "2026-09-15",
      timeHundredths: 8205,
      createdBy: owner.userId,
    },
    // A faster practice swim must not count as a PB.
    {
      swimmerId,
      meetId: null,
      swimType: "practice",
      eventDistance: 50,
      eventStroke: "free",
      course: "scy",
      swumOn: "2026-09-20",
      timeHundredths: 2900,
      createdBy: owner.userId,
    },
  ]);

  viewer = await createTestUserInHousehold("parent-pb-viewer", owner.householdId, "viewer");
  otherHousehold = await createTestUser("parent-pb-other");
});

afterAll(async () => {
  await adminDb().delete(meetSwims).where(eq(meetSwims.swimmerId, swimmerId));
  await adminDb().delete(meets).where(eq(meets.id, meetId));
  await hardDeleteSwimmer(swimmerId);
  await hardDeleteSwimmer(archivedSwimmerId);
  await viewer.cleanup();
  await otherHousehold.cleanup();
  await owner.cleanup();
  await closeAdminDb();
});

describe("GET /swimmers/:id/personal-bests", () => {
  it("owner gets 200 with PBs: best time per event+course, meet date included, practice swims excluded", async () => {
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/personal-bests`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const personalBests = res.body.personalBests as Array<{
      eventDistance: number;
      eventStroke: string;
      course: string;
      timeHundredths: number;
      timeString: string;
      meetDate: string | null;
      meetName: string | null;
    }>;
    expect(personalBests).toHaveLength(2);

    const free50 = personalBests.find(
      (pb) => pb.eventDistance === 50 && pb.eventStroke === "free",
    );
    expect(free50).toBeDefined();
    // PB is the slower-of-the-two meet times, not the 29.00 practice.
    expect(free50!.timeHundredths).toBe(3214);
    expect(free50!.timeString).toBe("32.14");
    expect(free50!.meetDate).toBe("2026-09-15");
    expect(free50!.meetName).toBe("PB Test Invitational");

    const back100 = personalBests.find(
      (pb) => pb.eventDistance === 100 && pb.eventStroke === "back",
    );
    expect(back100).toBeDefined();
    expect(back100!.timeHundredths).toBe(8205);
  });

  it("viewer (household member) gets 200", async () => {
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/personal-bests`)
      .set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.personalBests)).toBe(true);
  });

  it("parent from another household gets 404", async () => {
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/personal-bests`)
      .set("Authorization", `Bearer ${otherHousehold.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("archived swimmer returns 404 (same rule as /progress)", async () => {
    const res = await request(app)
      .get(`/swimmers/${archivedSwimmerId}/personal-bests`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("coach token gets 403 (parent-only route)", async () => {
    const coach = await createTestUser("parent-pb-coach-role");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/personal-bests`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(403);

    await coach.cleanup();
  });

  it("missing Authorization returns 401", async () => {
    const res = await request(app).get(`/swimmers/${swimmerId}/personal-bests`);
    expect(res.status).toBe(401);
  });
});
