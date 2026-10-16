import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000003";
const HOUSEHOLD_ID = "hhhhhhhh-0000-0000-0000-000000000004";

const now = new Date("2025-06-01T10:00:00.000Z");

const { mockGetUser, mockDbSelect, mockComputeSwimmerProgress } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockComputeSwimmerProgress: vi.fn(),
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

vi.mock("../lib/progressCalculation", () => ({
  computeSwimmerProgress: mockComputeSwimmerProgress,
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

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

function householdMemberSelect(householdId: string, role: string) {
  const limit = vi.fn().mockResolvedValue([{ householdId, role }]);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function householdSwimmerSelect(swimmerId: string) {
  const limit = vi.fn().mockResolvedValue([{ id: swimmerId }]);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

const emptyProgressResult = {
  skills: [],
  startProgress: [],
  headPositionOverall: null,
  coachingPriorities: [],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /swimmers/:id/progress (parent)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/swimmers/${SWIMMER_ID}/progress`);
    expect(res.status).toBe(401);
  });

  it("includes screen-based sessions (screenSlug set, categoryId null) in latestCoachingNotes", async () => {
    authAs(profileParent);

    const sessionRow = {
      screenSlug: "freestyle",
      sessionDate: "2025-06-01",
      coachingPriority: "Work on breathing timing",
    };

    mockComputeSwimmerProgress.mockResolvedValue(emptyProgressResult);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileParent))            // requireUser
      .mockReturnValueOnce(householdMemberSelect(HOUSEHOLD_ID, "owner")) // requireHouseholdMember
      .mockReturnValueOnce(householdSwimmerSelect(SWIMMER_ID))          // requireHouseholdSwimmer
      // descriptors: skipped (no displayed skills → Promise.resolve([]))
      // session query: .select().from().where().orderBy()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([sessionRow]),
          }),
        }),
      });

    const res = await request(app)
      .get(`/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const notes = res.body.latestCoachingNotes as Array<{
      screenSlug: string;
      screenName: string;
      text: string;
      sessionDate: string;
    }>;
    expect(notes).toHaveLength(1);
    expect(notes[0]?.screenSlug).toBe("freestyle");
    expect(notes[0]?.screenName).toBe("Freestyle");
    expect(notes[0]?.text).toBe("Work on breathing timing");
  });

  it("deduplicates: only the most recent session per screen appears in latestCoachingNotes", async () => {
    authAs(profileParent);

    const sessionRows = [
      { screenSlug: "freestyle", sessionDate: "2025-06-02", coachingPriority: "Latest note" },
      { screenSlug: "freestyle", sessionDate: "2025-06-01", coachingPriority: "Earlier note" },
    ];

    mockComputeSwimmerProgress.mockResolvedValue(emptyProgressResult);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileParent))
      .mockReturnValueOnce(householdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(householdSwimmerSelect(SWIMMER_ID))
      // session query
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(sessionRows),
          }),
        }),
      });

    const res = await request(app)
      .get(`/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const notes = res.body.latestCoachingNotes as Array<{ text: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe("Latest note");
  });

  it("skips sessions where screenSlug is null", async () => {
    authAs(profileParent);

    const sessionRows = [
      { screenSlug: null, sessionDate: "2025-06-01", coachingPriority: "Old note" },
    ];

    mockComputeSwimmerProgress.mockResolvedValue(emptyProgressResult);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileParent))
      .mockReturnValueOnce(householdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(householdSwimmerSelect(SWIMMER_ID))
      // session query
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(sessionRows),
          }),
        }),
      });

    const res = await request(app)
      .get(`/swimmers/${SWIMMER_ID}/progress`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.latestCoachingNotes).toHaveLength(0);
  });
});
