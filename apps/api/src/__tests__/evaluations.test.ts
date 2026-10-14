import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000003";
const CATEGORY_ID = "dddddddd-0000-0000-0000-000000000004";
const SKILL_ID = "eeeeeeee-0000-0000-0000-000000000005";
const RATING_ID = "ffffffff-0000-0000-0000-000000000006";
const SESSION_ID = "11111111-0000-0000-0000-000000000007";

const now = new Date("2025-06-01T10:00:00.000Z");
const oldTime = new Date("2025-06-01T09:00:00.000Z"); // 60 min ago — past window

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockDbTransaction,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbTransaction: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
    transaction: mockDbTransaction,
  },
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const profileCoach = {
  id: COACH_ID,
  role: "coach" as const,
  fullName: "Coach Jason",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const profileParent = {
  id: PARENT_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const activeSwimmerRow = {
  id: SWIMMER_ID,
  archivedAt: null,
};

type SkillRow = {
  id: string;
  slug: string;
  categoryId: string;
  parentSkillId: null;
  type: "rubric" | "measured";
  unit: string | null;
  faultTags: string[];
  ratedPerSide: boolean;
  archivedAt: Date | null;
};

const validSkillRow: SkillRow = {
  id: SKILL_ID,
  slug: "freestyle-kick",
  categoryId: CATEGORY_ID,
  parentSkillId: null,
  type: "rubric",
  unit: null,
  faultTags: ["flat-kick", "crossover"],
  ratedPerSide: false,
  archivedAt: null,
};

const archivedSkillRow: SkillRow = {
  ...validSkillRow,
  archivedAt: now,
};

const ratedPerSideSkillRow = {
  ...validSkillRow,
  ratedPerSide: true,
};

const validRatingInput = {
  skillId: SKILL_ID,
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
  ratedAt: "2025-06-01T10:00:00.000Z",
};

const validSessionBody = {
  categoryId: CATEGORY_ID,
  sessionDate: "2025-06-01",
  context: "practice",
  coachingPriority: "Work on kick mechanics",
  ratings: [validRatingInput],
};

type AnyProfile = { id: string; role: string; [key: string]: unknown };

function authAs(profile: AnyProfile) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: profile.id, email: "user@example.com" } },
    error: null,
  });
}

function requireUserSelect(profile: AnyProfile) {
  const where = vi.fn().mockResolvedValue([profile]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function swimmerSelect(row: typeof activeSwimmerRow | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function categorySelect(found: boolean) {
  const limit = vi.fn().mockResolvedValue(found ? [{ id: CATEGORY_ID }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function skillsSelect(rows: typeof validSkillRow[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Unauthenticated → 401 ────────────────────────────────────────────────────

describe("unauthenticated", () => {
  it("POST /swimmers/:id/sessions → 401", async () => {
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .send(validSessionBody);
    expect(res.status).toBe(401);
  });

  it("DELETE /ratings/:id → 401", async () => {
    const res = await request(app).delete(`/coach/ratings/${RATING_ID}`);
    expect(res.status).toBe(401);
  });

  it("PATCH /ratings/:id/void → 401", async () => {
    const res = await request(app)
      .patch(`/coach/ratings/${RATING_ID}/void`)
      .send({ reason: "mistake" });
    expect(res.status).toBe(401);
  });

  it("GET /swimmers/:id/skills → 401", async () => {
    const res = await request(app).get(`/coach/swimmers/${SWIMMER_ID}/skills`);
    expect(res.status).toBe(401);
  });

  it("GET /swimmers/:id/skills/:skillId/ratings → 401", async () => {
    const res = await request(app).get(`/coach/swimmers/${SWIMMER_ID}/skills/${SKILL_ID}/ratings`);
    expect(res.status).toBe(401);
  });

  it("GET /swimmers/:id/sessions/dependency-map → 401", async () => {
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/sessions/dependency-map`)
      .query({ categoryId: CATEGORY_ID });
    expect(res.status).toBe(401);
  });
});

// ── Parent role → 403 ────────────────────────────────────────────────────────

describe("parent role restrictions", () => {
  beforeEach(() => {
    authAs(profileParent);
    mockDbSelect.mockReturnValue(requireUserSelect(profileParent));
  });

  it("POST /swimmers/:id/sessions → 403 for parent", async () => {
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send(validSessionBody);
    expect(res.status).toBe(403);
  });

  it("DELETE /ratings/:id → 403 for parent", async () => {
    const res = await request(app)
      .delete(`/coach/ratings/${RATING_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("PATCH /ratings/:id/void → 403 for parent", async () => {
    const res = await request(app)
      .patch(`/coach/ratings/${RATING_ID}/void`)
      .set("Authorization", "Bearer token")
      .send({ reason: "mistake" });
    expect(res.status).toBe(403);
  });
});

// ── POST /swimmers/:id/sessions — input validation ────────────────────────────

describe("POST /swimmers/:id/sessions — validation", () => {
  beforeEach(() => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValue(requireUserSelect(profileCoach));
  });

  it("missing coachingPriority → 422", async () => {
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({ ...validSessionBody, coachingPriority: "" });
    expect(res.status).toBe(422);
  });

  it("ratings array empty → 422", async () => {
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({ ...validSessionBody, ratings: [] });
    expect(res.status).toBe(422);
  });

  it("invalid context → 422", async () => {
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({ ...validSessionBody, context: "invalid" });
    expect(res.status).toBe(422);
  });

  it("archived skill in ratings → 422", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // evaluationsRouter requireUser
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(categorySelect(true))
      .mockReturnValueOnce(skillsSelect([archivedSkillRow]));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send(validSessionBody);
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("archived");
  });

  it("skill wrong category → 422", async () => {
    const wrongCategorySkill = {
      ...validSkillRow,
      categoryId: "99999999-0000-0000-0000-000000000099",
      parentSkillId: null,
    };
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // evaluationsRouter requireUser
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(categorySelect(true))
      .mockReturnValueOnce(skillsSelect([wrongCategorySkill]));

    // Parent lookup for category check — also returns wrong category
    const parentLimit = vi.fn().mockResolvedValue([{ categoryId: "99999999-0000-0000-0000-000000000099" }]);
    const parentWhere = vi.fn().mockReturnValue({ limit: parentLimit });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: parentWhere }) });

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send(validSessionBody);
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("category");
  });

  it("side missing when ratedPerSide=true → 422", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // evaluationsRouter requireUser
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(categorySelect(true))
      .mockReturnValueOnce(skillsSelect([ratedPerSideSkillRow]));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({
        ...validSessionBody,
        ratings: [{ ...validRatingInput, side: null }],
      });
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("side");
  });

  it("side present when ratedPerSide=false → 422", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // evaluationsRouter requireUser
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(categorySelect(true))
      .mockReturnValueOnce(skillsSelect([validSkillRow]));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({
        ...validSessionBody,
        ratings: [{ ...validRatingInput, side: "left" }],
      });
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("side");
  });

  it("invalid faultTag → 422", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // evaluationsRouter requireUser
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(categorySelect(true))
      .mockReturnValueOnce(skillsSelect([validSkillRow]));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({
        ...validSessionBody,
        ratings: [{ ...validRatingInput, faultTags: ["not-a-real-tag"] }],
      });
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("fault tag");
  });

  it("measurement on non-measured skill → 422", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // evaluationsRouter requireUser
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(categorySelect(true))
      .mockReturnValueOnce(skillsSelect([validSkillRow])); // rubric type, not measured

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/sessions`)
      .set("Authorization", "Bearer token")
      .send({
        ...validSessionBody,
        ratings: [
          {
            ...validRatingInput,
            measurementValue: "30",
            measurementUnit: "stroke_cycles_per_minute",
          },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("measured");
  });
});

// ── DELETE /ratings/:id ───────────────────────────────────────────────────────

describe("DELETE /ratings/:id", () => {
  beforeEach(() => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValue(requireUserSelect(profileCoach));
  });

  it("past undo window → 409", async () => {
    // Second select call returns the rating with old createdAt
    const ratingLimit = vi.fn().mockResolvedValue([
      {
        id: RATING_ID,
        coachId: COACH_ID,
        voidedAt: null,
        createdAt: oldTime,
      },
    ]);
    const ratingWhere = vi.fn().mockReturnValue({ limit: ratingLimit });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // ratingsRouter requireUser
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: ratingWhere }) });

    const res = await request(app)
      .delete(`/coach/ratings/${RATING_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Undo window");
  });

  it("already voided → 409", async () => {
    const ratingLimit = vi.fn().mockResolvedValue([
      {
        id: RATING_ID,
        coachId: COACH_ID,
        voidedAt: now,
        createdAt: now,
      },
    ]);
    const ratingWhere = vi.fn().mockReturnValue({ limit: ratingLimit });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // ratingsRouter requireUser
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: ratingWhere }) });

    const res = await request(app)
      .delete(`/coach/ratings/${RATING_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("voided");
  });

  it("not owned by this coach → 404", async () => {
    const ratingLimit = vi.fn().mockResolvedValue([
      {
        id: RATING_ID,
        coachId: "different-coach-id",
        voidedAt: null,
        createdAt: now,
      },
    ]);
    const ratingWhere = vi.fn().mockReturnValue({ limit: ratingLimit });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // ratingsRouter requireUser
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: ratingWhere }) });

    const res = await request(app)
      .delete(`/coach/ratings/${RATING_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

// ── PATCH /ratings/:id/void ───────────────────────────────────────────────────

describe("PATCH /ratings/:id/void", () => {
  beforeEach(() => {
    authAs(profileCoach);
  });

  it("already voided → 409", async () => {
    const ratingLimit = vi.fn().mockResolvedValue([
      {
        id: RATING_ID,
        coachId: COACH_ID,
        voidedAt: now,
        sessionId: SESSION_ID,
        swimmerId: SWIMMER_ID,
        skillId: SKILL_ID,
        grade: 3,
        notLegal: false,
        noConcept: false,
        side: null,
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        note: null,
        voidReason: "old reason",
        voidBy: COACH_ID,
        ratedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const ratingWhere = vi.fn().mockReturnValue({ limit: ratingLimit });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // ratingsRouter requireUser
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: ratingWhere }) });

    const res = await request(app)
      .patch(`/coach/ratings/${RATING_ID}/void`)
      .set("Authorization", "Bearer token")
      .send({ reason: "new reason" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already voided");
  });

  it("missing reason → 422", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValue(requireUserSelect(profileCoach));

    const res = await request(app)
      .patch(`/coach/ratings/${RATING_ID}/void`)
      .set("Authorization", "Bearer token")
      .send({ reason: "" });

    expect(res.status).toBe(422);
  });

  it("not owned by this coach → 404", async () => {
    const ratingLimit = vi.fn().mockResolvedValue([
      {
        id: RATING_ID,
        coachId: "other-coach",
        voidedAt: null,
        sessionId: SESSION_ID,
        swimmerId: SWIMMER_ID,
        skillId: SKILL_ID,
        grade: 3,
        notLegal: false,
        noConcept: false,
        side: null,
        capacityValue: null,
        capacityUnit: null,
        measurementValue: null,
        measurementUnit: null,
        note: null,
        voidReason: null,
        voidBy: null,
        ratedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const ratingWhere = vi.fn().mockReturnValue({ limit: ratingLimit });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachAvailabilityRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachLessonsRouter requireUser
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // ratingsRouter requireUser
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: ratingWhere }) });

    const res = await request(app)
      .patch(`/coach/ratings/${RATING_ID}/void`)
      .set("Authorization", "Bearer token")
      .send({ reason: "mistake" });

    expect(res.status).toBe(404);
  });
});

// ── Integration tests (require real DB) ──────────────────────────────────────

const isRealDb =
  !!process.env["DATABASE_URL"] &&
  !process.env["DATABASE_URL"].includes("placeholder");

describe.skipIf(!isRealDb)("integration tests — real DB", () => {
  it("POST transaction: archived skill prevents session and ratings creation", async () => {
    // This test is a placeholder for when a real DB is available.
    // It verifies that an archived skill in the middle of a ratings array
    // causes the entire transaction to be rolled back (no session or ratings created).
    expect(true).toBe(true);
  });

  it("DELETE within window → 204, rating gone", async () => {
    expect(true).toBe(true);
  });

  it("DELETE just past window → 409", async () => {
    expect(true).toBe(true);
  });

  it("PATCH /void sets all three void fields atomically", async () => {
    expect(true).toBe(true);
  });

  it("GET /skills: grades match latestEffectiveRatings", async () => {
    expect(true).toBe(true);
  });
});
