import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000003";
const SKILL_ID = "eeeeeeee-0000-0000-0000-000000000005";

const now = new Date("2025-06-01T10:00:00.000Z");

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
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

function ratingRowsSelect(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin2 = vi.fn().mockReturnValue({ where });
  const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
  return { from: vi.fn().mockReturnValue({ innerJoin: innerJoin1 }) };
}

function swimmerBirthDateSelect(birthDate: string | null) {
  const limit = vi.fn().mockResolvedValue(birthDate !== null ? [{ birthDate }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function cohortSwimmersSelect(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET /coach/swimmers/:id/golf-score-trends", () => {
  it("returns 401 when no auth token", async () => {
    const res = await request(app).get(`/coach/swimmers/${SWIMMER_ID}/golf-score-trends`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as parent", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/golf-score-trends`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 404 when swimmer not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSelect(null));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/golf-score-trends`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 200 with empty trends when swimmer has no golf score ratings", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(ratingRowsSelect([]))
      .mockReturnValueOnce(swimmerBirthDateSelect("2015-03-10"))
      .mockReturnValueOnce(cohortSwimmersSelect([]));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/golf-score-trends`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trends: [] });
  });

  it("returns 200 with trends when swimmer has golf score ratings", async () => {
    authAs(profileCoach);

    const ratingRows = [
      {
        grade: 3,
        measurementValue: "42",
        golfScoreCategory: "push_off_in_water",
        ratedAt: new Date("2025-05-01T10:00:00.000Z"),
        sessionDate: "2025-05-01",
        skillId: SKILL_ID,
        slug: "free-golf-score",
        name: "Freestyle Golf Score",
      },
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(ratingRowsSelect(ratingRows))
      .mockReturnValueOnce(swimmerBirthDateSelect("2015-03-10"))
      .mockReturnValueOnce(cohortSwimmersSelect([]));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/golf-score-trends`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.trends).toHaveLength(1);
    expect(res.body.trends[0].skillSlug).toBe("free-golf-score");
    expect(res.body.trends[0].byCategory).toHaveLength(1);
    expect(res.body.trends[0].byCategory[0].category).toBe("push_off_in_water");
    expect(res.body.trends[0].byCategory[0].points).toHaveLength(1);
    expect(res.body.trends[0].byCategory[0].points[0].measurementValue).toBe("42");
  });

  it("returns null age bands when cohort has fewer than 10 swimmers", async () => {
    authAs(profileCoach);

    const ratingRows = [
      {
        grade: 4,
        measurementValue: "38",
        golfScoreCategory: "deck_dive",
        ratedAt: new Date("2025-05-10T10:00:00.000Z"),
        sessionDate: "2025-05-10",
        skillId: SKILL_ID,
        slug: "back-golf-score",
        name: "Backstroke Golf Score",
      },
    ];

    const smallCohort = [
      { id: "swimmer-001", birthDate: "2015-01-01" },
      { id: "swimmer-002", birthDate: "2015-02-01" },
      { id: "swimmer-003", birthDate: "2015-03-01" },
    ];

    const cohortRatingRows = [
      { swimmerId: "swimmer-001", measurementValue: "45", ratedAt: new Date("2025-04-01T00:00:00.000Z") },
      { swimmerId: "swimmer-002", measurementValue: "40", ratedAt: new Date("2025-04-01T00:00:00.000Z") },
      { swimmerId: "swimmer-003", measurementValue: "50", ratedAt: new Date("2025-04-01T00:00:00.000Z") },
    ];

    function cohortRatingsSelect(rows: unknown[]) {
      const orderBy = vi.fn().mockResolvedValue(rows);
      const where = vi.fn().mockReturnValue({ orderBy });
      const innerJoin = vi.fn().mockReturnValue({ where });
      return { from: vi.fn().mockReturnValue({ innerJoin }) };
    }

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce(ratingRowsSelect(ratingRows))
      .mockReturnValueOnce(swimmerBirthDateSelect("2015-06-15"))
      .mockReturnValueOnce(cohortSwimmersSelect(smallCohort))
      .mockReturnValueOnce(cohortRatingsSelect(cohortRatingRows));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/golf-score-trends`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.trends).toHaveLength(1);
    expect(res.body.trends[0].byCategory[0].ageBands).toBeNull();
  });
});
