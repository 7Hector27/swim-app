import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import { leagueRegistrations, meetSwims, meets, profiles, swimmers } from "../../db/schema";
import { adminDb, closeAdminDb, createTestUser, hardDeleteSwimmer } from "./helpers";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// Safety nets: if a test's finally block doesn't fire, afterEach still cleans up.
const trackedSwimmerIds = new Set<string>();
const trackedMeetIds = new Set<string>();

afterEach(async () => {
  // Safety net: delete any tracked meets/swims that a finally block missed.
  // hardDeleteSwimmer now deletes meet_swims first, so swimmer deletes are safe.
  for (const meetId of trackedMeetIds) {
    await adminDb().delete(meets).where(eq(meets.id, meetId)).catch(() => {});
  }
  trackedMeetIds.clear();
  for (const swimmerId of trackedSwimmerIds) {
    await hardDeleteSwimmer(swimmerId).catch(() => {});
  }
  trackedSwimmerIds.clear();
});

// Delete meet swims → meets in the correct FK order before calling user.cleanup().
// meets.created_by → profiles is RESTRICT, so meets must be gone before the
// Supabase user (and its profile row) can be deleted.
async function cleanupMeet(meetId: string, swimmerIds: string[]): Promise<void> {
  await adminDb()
    .delete(meetSwims)
    .where(inArray(meetSwims.swimmerId, swimmerIds))
    .catch(() => {});
  await adminDb().delete(meets).where(eq(meets.id, meetId)).catch(() => {});
  trackedMeetIds.delete(meetId);
}

afterAll(async () => {
  await closeAdminDb();
});

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type InsertSwimmerOpts = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "female" | "male";
  isPublic: boolean;
  householdId: string;
  consentBy: string;
};

async function insertSwimmer(opts: InsertSwimmerOpts): Promise<void> {
  trackedSwimmerIds.add(opts.id);
  await adminDb().insert(swimmers).values({
    id: opts.id,
    firstName: opts.firstName,
    lastName: opts.lastName,
    birthDate: opts.birthDate,
    sex: opts.sex,
    isPublic: opts.isPublic,
    ...(opts.isPublic && {
      publicConsentAt: new Date(),
      publicConsentBy: opts.consentBy,
    }),
    householdId: opts.householdId,
  });
}

async function insertClubRegistration(swimmerId: string): Promise<void> {
  await adminDb().insert(leagueRegistrations).values({
    swimmerId,
    league: "club",
    seasonStartYear: 2026,
    registeredOn: "2026-09-01",
  });
}

async function insertIslRegistration(swimmerId: string, registeredOn: string): Promise<void> {
  await adminDb().insert(leagueRegistrations).values({
    swimmerId,
    league: "summer_league",
    seasonStartYear: 2026,
    registeredOn,
  });
}

type InsertSwimOpts = {
  swimmerId: string;
  meetId: string | null;
  swimType: "meet" | "practice";
  eventDistance: number;
  eventStroke: "free" | "back" | "breast" | "fly" | "im";
  course: "scy" | "scm" | "lcm";
  swumOn: string;
  timeHundredths: number;
  createdBy: string;
};

async function insertSwim(opts: InsertSwimOpts): Promise<void> {
  await adminDb().insert(meetSwims).values(opts);
}

async function insertMeet(opts: {
  id: string;
  name: string;
  meetDate: string;
  course: "scy" | "scm" | "lcm";
  createdBy: string;
}): Promise<void> {
  trackedMeetIds.add(opts.id);
  await adminDb().insert(meets).values(opts);
}

// ── Practice swims never count toward PBs ─────────────────────────────────────

describe("GET /leaderboard/club — practice swims excluded", () => {
  it("PB uses the meet swim time, not the faster practice swim", async () => {
    const user = await createTestUser("lb-practice");
    const meetId = randomUUID();
    const swimmerId = randomUUID();

    try {
      await insertSwimmer({
        id: swimmerId,
        firstName: "PracticeTest",
        lastName: "Swimmer",
        birthDate: "2016-06-01", // age 10 on 2026-10-15 → "9-10"
        sex: "female",
        isPublic: true,
        householdId: user.householdId,
        consentBy: user.userId,
      });
      await insertClubRegistration(swimmerId);
      await insertMeet({ id: meetId, name: "LB Practice Test Meet", meetDate: "2026-09-15", course: "scy", createdBy: user.userId });

      // Practice swim is faster (55.00) — must NOT count as the PB.
      await insertSwim({
        swimmerId, meetId: null, swimType: "practice",
        eventDistance: 1000, eventStroke: "free", course: "scy",
        swumOn: "2026-09-20", timeHundredths: 5500, createdBy: user.userId,
      });
      // Meet swim is slower (1:00.00) — IS the PB.
      await insertSwim({
        swimmerId, meetId, swimType: "meet",
        eventDistance: 1000, eventStroke: "free", course: "scy",
        swumOn: "2026-09-15", timeHundredths: 6000, createdBy: user.userId,
      });

      const res = await request(app).get(
        "/leaderboard/club?eventDistance=1000&eventStroke=free&course=scy&ageGroup=9-10&sex=female",
      );

      expect(res.status).toBe(200);
      const rows = res.body.rows as Array<{ firstName: string; time: string }>;
      const row = rows.find((r) => r.firstName === "PracticeTest");
      expect(row).toBeDefined();
      expect(row!.time).toBe("1:00.00"); // meet swim, not 55.00 practice
    } finally {
      await cleanupMeet(meetId, [swimmerId]);
      await user.cleanup();
    }
  });

  it("swimmer with only a practice swim does not appear on the board", async () => {
    const user = await createTestUser("lb-practice-only");
    const swimmerId = randomUUID();

    try {
      await insertSwimmer({
        id: swimmerId,
        firstName: "PracticeOnly",
        lastName: "Swimmer",
        birthDate: "2016-06-01",
        sex: "female",
        isPublic: true,
        householdId: user.householdId,
        consentBy: user.userId,
      });
      await insertClubRegistration(swimmerId);

      // Only a practice swim — no meet swims, so no PB, so not on the board.
      await insertSwim({
        swimmerId, meetId: null, swimType: "practice",
        eventDistance: 1000, eventStroke: "free", course: "scy",
        swumOn: "2026-09-20", timeHundredths: 5500, createdBy: user.userId,
      });

      const res = await request(app).get(
        "/leaderboard/club?eventDistance=1000&eventStroke=free&course=scy&ageGroup=9-10&sex=female",
      );

      expect(res.status).toBe(200);
      const rows = res.body.rows as Array<{ firstName: string }>;
      expect(rows.find((r) => r.firstName === "PracticeOnly")).toBeUndefined();
    } finally {
      await user.cleanup();
    }
  });
});


// ── Heat and final keep only the fastest ──────────────────────────────────────

describe("GET /leaderboard/club — heat and final keep only the fastest", () => {
  it("two meet swims for the same event: board shows only the faster time", async () => {
    const user = await createTestUser("lb-heat-final");
    const meetId = randomUUID();
    const swimmerId = randomUUID();

    try {
      await insertSwimmer({
        id: swimmerId,
        firstName: "HeatFinal",
        lastName: "Swimmer",
        birthDate: "2016-03-01", // age 10 → "9-10"
        sex: "male",
        isPublic: true,
        householdId: user.householdId,
        consentBy: user.userId,
      });
      await insertClubRegistration(swimmerId);
      await insertMeet({ id: meetId, name: "LB Heat Final Meet", meetDate: "2026-09-10", course: "lcm", createdBy: user.userId });

      // Heat: 1:35.00 (slower)
      await insertSwim({
        swimmerId, meetId, swimType: "meet",
        eventDistance: 800, eventStroke: "free", course: "lcm",
        swumOn: "2026-09-10", timeHundredths: 9500, createdBy: user.userId,
      });
      // Final: 1:30.00 (faster — the true PB)
      await insertSwim({
        swimmerId, meetId, swimType: "meet",
        eventDistance: 800, eventStroke: "free", course: "lcm",
        swumOn: "2026-09-10", timeHundredths: 9000, createdBy: user.userId,
      });

      const res = await request(app).get(
        "/leaderboard/club?eventDistance=800&eventStroke=free&course=lcm&ageGroup=9-10&sex=male",
      );

      expect(res.status).toBe(200);
      const rows = res.body.rows as Array<{ firstName: string; time: string }>;
      const row = rows.find((r) => r.firstName === "HeatFinal");
      expect(row).toBeDefined();
      expect(row!.time).toBe("1:30.00"); // final, not the slower heat
    } finally {
      await cleanupMeet(meetId, [swimmerId]);
      await user.cleanup();
    }
  });
});

// ── Ties share a rank ─────────────────────────────────────────────────────────

describe("GET /leaderboard/club — ties share a rank", () => {
  it("two swimmers with identical times get rank 1; a slower swimmer gets rank 3", async () => {
    const user = await createTestUser("lb-ties");
    const meetId = randomUUID();
    const idA = randomUUID();
    const idB = randomUUID();
    const idC = randomUUID();

    try {
      const birthDate = "2016-06-01"; // age 10 → "9-10"

      await insertSwimmer({ id: idA, firstName: "TieA", lastName: "Swimmer", birthDate, sex: "female", isPublic: true, householdId: user.householdId, consentBy: user.userId });
      await insertSwimmer({ id: idB, firstName: "TieB", lastName: "Swimmer", birthDate, sex: "female", isPublic: true, householdId: user.householdId, consentBy: user.userId });
      await insertSwimmer({ id: idC, firstName: "TieC", lastName: "Swimmer", birthDate, sex: "female", isPublic: true, householdId: user.householdId, consentBy: user.userId });

      await insertClubRegistration(idA);
      await insertClubRegistration(idB);
      await insertClubRegistration(idC);

      await insertMeet({ id: meetId, name: "LB Ties Meet", meetDate: "2026-09-12", course: "scm", createdBy: user.userId });

      // TieA and TieB both swim 15:30.00 → tied at rank 1
      await insertSwim({ swimmerId: idA, meetId, swimType: "meet", eventDistance: 1500, eventStroke: "free", course: "scm", swumOn: "2026-09-12", timeHundredths: 93000, createdBy: user.userId });
      await insertSwim({ swimmerId: idB, meetId, swimType: "meet", eventDistance: 1500, eventStroke: "free", course: "scm", swumOn: "2026-09-12", timeHundredths: 93000, createdBy: user.userId });
      // TieC swims 15:40.00 → rank 3 (not 2, because two swimmers share rank 1)
      await insertSwim({ swimmerId: idC, meetId, swimType: "meet", eventDistance: 1500, eventStroke: "free", course: "scm", swumOn: "2026-09-12", timeHundredths: 94000, createdBy: user.userId });

      const res = await request(app).get(
        "/leaderboard/club?eventDistance=1500&eventStroke=free&course=scm&ageGroup=9-10&sex=female",
      );

      expect(res.status).toBe(200);
      const rows = res.body.rows as Array<{ firstName: string; rank: number }>;

      const rowA = rows.find((r) => r.firstName === "TieA");
      const rowB = rows.find((r) => r.firstName === "TieB");
      const rowC = rows.find((r) => r.firstName === "TieC");

      expect(rowA?.rank).toBe(1);
      expect(rowB?.rank).toBe(1);
      expect(rowC?.rank).toBe(3); // skips rank 2
    } finally {
      await cleanupMeet(meetId, [idA, idB, idC]);
      await user.cleanup();
    }
  });
});

// ── ISL age from registered_on ────────────────────────────────────────────────

describe("GET /leaderboard/isl — age computed from registered_on", () => {
  it("groups swimmer by age on registered_on date, not today", async () => {
    // Born 2013-07-01.
    // calculateAge("2013-07-01", "2026-06-01") = 12 → "11-12"  (registered_on)
    // calculateAge("2013-07-01", "2026-10-15") = 13 → "13-14"  (today)
    // The ISL board must use registered_on, so ageGroup should be "11-12".
    const user = await createTestUser("lb-isl-age");
    const meetId = randomUUID();
    const swimmerId = randomUUID();

    try {
      await insertSwimmer({
        id: swimmerId,
        firstName: "IslAgeTest",
        lastName: "Swimmer",
        birthDate: "2013-07-01",
        sex: "female",
        isPublic: true,
        householdId: user.householdId,
        consentBy: user.userId,
      });
      // registered_on is before the swimmer's July birthday — they are still 12
      await insertIslRegistration(swimmerId, "2026-06-01");
      await insertMeet({ id: meetId, name: "LB ISL Age Meet", meetDate: "2026-06-15", course: "lcm", createdBy: user.userId });
      await insertSwim({
        swimmerId, meetId, swimType: "meet",
        eventDistance: 200, eventStroke: "im", course: "lcm",
        swumOn: "2026-06-15", timeHundredths: 15000, createdBy: user.userId,
      });

      const res = await request(app).get(
        "/leaderboard/isl?eventDistance=200&eventStroke=im&course=lcm&sex=female",
      );

      expect(res.status).toBe(200);
      const rows = res.body.rows as Array<{ firstName: string; ageGroup: string }>;
      const row = rows.find((r) => r.firstName === "IslAgeTest");
      expect(row).toBeDefined();
      expect(row!.ageGroup).toBe("11-12"); // age on registered_on, not today
    } finally {
      await cleanupMeet(meetId, [swimmerId]);
      await user.cleanup();
    }
  });
});

// ── Non-public swimmers excluded from public board ────────────────────────────

describe("GET /leaderboard/club vs GET /coach/leaderboard/club — visibility", () => {
  it("private swimmer absent from public board but present on coach board", async () => {
    const parent = await createTestUser("lb-vis-parent");
    const coachUser = await createTestUser("lb-vis-coach");
    await makeCoach(coachUser.userId);

    const meetId = randomUUID();
    const publicId = randomUUID();
    const privateId = randomUUID();

    try {
      const birthDate = "2016-06-01"; // age 10 → "9-10"

      await insertSwimmer({ id: publicId, firstName: "LbPublic",  lastName: "Swimmer", birthDate, sex: "female", isPublic: true,  householdId: parent.householdId, consentBy: parent.userId });
      await insertSwimmer({ id: privateId, firstName: "LbPrivate", lastName: "Swimmer", birthDate, sex: "female", isPublic: false, householdId: parent.householdId, consentBy: parent.userId });

      await insertClubRegistration(publicId);
      await insertClubRegistration(privateId);

      await insertMeet({ id: meetId, name: "LB Visibility Meet", meetDate: "2026-09-14", course: "scy", createdBy: coachUser.userId });

      for (const swimmerId of [publicId, privateId]) {
        await insertSwim({
          swimmerId, meetId, swimType: "meet",
          eventDistance: 1650, eventStroke: "free", course: "scy",
          swumOn: "2026-09-14", timeHundredths: 110000, createdBy: coachUser.userId,
        });
      }

      // Public board: only the is_public swimmer appears
      const pubRes = await request(app).get(
        "/leaderboard/club?eventDistance=1650&eventStroke=free&course=scy&ageGroup=9-10&sex=female",
      );
      expect(pubRes.status).toBe(200);
      const pubNames = (pubRes.body.rows as Array<{ firstName: string }>).map((r) => r.firstName);
      expect(pubNames).toContain("LbPublic");
      expect(pubNames).not.toContain("LbPrivate");

      // Coach board: both swimmers appear (no is_public filter)
      const coachRes = await request(app)
        .get("/coach/leaderboard/club?eventDistance=1650&eventStroke=free&course=scy&ageGroup=9-10&sex=female")
        .set("Authorization", `Bearer ${coachUser.accessToken}`);
      expect(coachRes.status).toBe(200);
      const coachNames = (coachRes.body.rows as Array<{ firstName: string }>).map((r) => r.firstName);
      expect(coachNames).toContain("LbPublic");
      expect(coachNames).toContain("LbPrivate");
    } finally {
      await cleanupMeet(meetId, [publicId, privateId]);
      await parent.cleanup();
      await coachUser.cleanup();
    }
  });
});
