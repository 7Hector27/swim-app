import { describe, it, expect } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// Build a RatingInput entry that passes CreateSessionBodySchema's shape
// check. skillId is a deterministic UUID; note length is caller-supplied.
function ratingInput(index: number, noteLength: number): Record<string, unknown> {
  const hex = index.toString(16).padStart(12, "0");
  return {
    skillId: `00000000-0000-0000-0000-${hex}`,
    grade: 3,
    notLegal: false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    note: "x".repeat(noteLength),
    faultTags: [],
    ratedAt: "2026-11-03T12:00:00.000Z",
    golfScoreCategory: null,
  };
}

describe("body size limit", () => {
  it("returns a clean 413 with the standard error shape for an oversized JSON body", async () => {
    // 256 KB — well over the 128 KB limit.
    const oversized = { pad: "x".repeat(256 * 1024) };
    const res = await request(app)
      .post("/auth/signup")
      .set("content-type", "application/json")
      .send(oversized);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Request body too large" });
    // Must not be the generic 500 shape.
    expect(res.body.error).not.toBe("Internal server error");
  });

  it("accepts a reasonable body (passes limit, fails downstream validation only)", async () => {
    const body = { email: "a@b.co", password: "pw", fullName: "T T", birthDate: "2000-01-01" };
    const res = await request(app)
      .post("/auth/signup")
      .set("content-type", "application/json")
      .send(body);

    // Should NOT be 413 — we care that the size gate passed. Downstream
    // validation / DB can fail with any other status.
    expect(res.status).not.toBe(413);
  });

  it("accepts a full-catalog coach evaluation save with long per-skill notes", async () => {
    // Simulates POST /coach/swimmers/:id/sessions at the worst realistic
    // size: every skill in the catalog (~132) rated with a 500-char note.
    // Measured at ~102 KB. The limit must be large enough that Jason's
    // thorough eval never surfaces as a 413.
    const body = {
      screenSlug: "full-screen",
      sessionDate: "2026-11-03",
      context: "practice",
      coachingPriority: "x".repeat(1000),
      breathingPattern: "every_3",
      ratings: Array.from({ length: 132 }, (_, index) => ratingInput(index, 500)),
    };
    const payloadBytes = Buffer.byteLength(JSON.stringify(body));
    // Sanity: the fixture is above the old 64 KB limit so this test
    // actually proves the bump.
    expect(payloadBytes).toBeGreaterThan(64 * 1024);
    // ...and still within 128 KB.
    expect(payloadBytes).toBeLessThanOrEqual(128 * 1024);

    const res = await request(app)
      .post("/coach/swimmers/00000000-0000-0000-0000-000000000001/sessions")
      .set("content-type", "application/json")
      .send(body);

    // The size gate passed. Downstream (auth) returns 401/4xx; the only
    // status we care about is that it's not 413.
    expect(res.status).not.toBe(413);
  });

  it("accepts a 20-lesson weekly recurring batch submit", async () => {
    // Weekly batch worst case: 20 picks pattern × 4 swimmers each, plus
    // 20 overrides, plus 20 skips. Measured at ~6-8 KB.
    const body = {
      mode: "weekly",
      householdId: "00000000-0000-0000-0000-000000000001",
      locationId: "00000000-0000-0000-0000-000000000002",
      pattern: Array.from({ length: 20 }, (_, index) => ({
        weekday: (index % 7) + 1,
        timeOfDay: "16:30",
        durationMinutes: 45,
        swimmerIds: [
          "00000000-0000-0000-0000-000000000010",
          "00000000-0000-0000-0000-000000000011",
          "00000000-0000-0000-0000-000000000012",
          "00000000-0000-0000-0000-000000000013",
        ],
      })),
      startDate: "2026-11-03",
      weeks: 1,
      overrides: Array.from({ length: 20 }, (_, index) => ({
        index,
        startsAt: `2026-11-0${(index % 7) + 1}T16:30:00.000-08:00`,
      })),
      skips: [],
    };
    const payloadBytes = Buffer.byteLength(JSON.stringify(body));
    // Sanity: a 20-lesson batch must stay well under the limit — if this
    // ever exceeds 32 KB, the schema has drifted and the batch endpoint
    // is at risk.
    expect(payloadBytes).toBeLessThan(32 * 1024);

    const res = await request(app)
      .post("/lessons/batch")
      .set("content-type", "application/json")
      .send(body);

    expect(res.status).not.toBe(413);
  });
});
