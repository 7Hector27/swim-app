import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000003";
const DRAFT_ID = "dddddddd-0000-0000-0000-000000000004";
const SKILL_ID = "eeeeeeee-0000-0000-0000-000000000005";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbDelete,
  mockDbTransaction,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
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
    update: vi.fn(),
    delete: mockDbDelete,
    transaction: mockDbTransaction,
  },
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date("2025-06-01T10:00:00.000Z");

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

const activeSwimmerRow = { id: SWIMMER_ID, archivedAt: null };

const validDraftBody = {
  sessionDate: "2025-06-01",
  context: "practice",
  coachingPriority: "Work on kick",
  breathingPattern: null,
  payload: {},
};

const storedDraft = {
  id: DRAFT_ID,
  swimmerId: SWIMMER_ID,
  coachId: COACH_ID,
  screenSlug: "fundamentals",
  sessionDate: "2025-06-01",
  context: "practice" as const,
  coachingPriority: "Work on kick",
  breathingPattern: null,
  payload: {},
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

function swimmerSelect(row: typeof activeSwimmerRow | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── PUT /coach/swimmers/:id/drafts/:screenSlug ────────────────────────────────

describe("PUT /coach/swimmers/:id/drafts/:screenSlug", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .put(`/coach/swimmers/${SWIMMER_ID}/drafts/fundamentals`)
      .send(validDraftBody);
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is parent", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));

    const res = await request(app)
      .put(`/coach/swimmers/${SWIMMER_ID}/drafts/fundamentals`)
      .set("Authorization", "Bearer token")
      .send(validDraftBody);
    expect(res.status).toBe(403);
  });

  it("returns 404 when swimmer not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSelect(null));

    const res = await request(app)
      .put(`/coach/swimmers/${SWIMMER_ID}/drafts/fundamentals`)
      .set("Authorization", "Bearer token")
      .send(validDraftBody);
    expect(res.status).toBe(404);
  });

  it("returns 422 when screenSlug is invalid", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const res = await request(app)
      .put(`/coach/swimmers/${SWIMMER_ID}/drafts/not-a-screen`)
      .set("Authorization", "Bearer token")
      .send(validDraftBody);
    expect(res.status).toBe(422);
  });

  it("returns 200 and draft on success", async () => {
    authAs(profileCoach);

    const returningMock = vi.fn().mockResolvedValue([storedDraft]);
    const onConflictDoUpdateMock = vi.fn().mockReturnValue({ returning: returningMock });
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    mockDbInsert.mockReturnValue({ values: valuesMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow));

    const res = await request(app)
      .put(`/coach/swimmers/${SWIMMER_ID}/drafts/fundamentals`)
      .set("Authorization", "Bearer token")
      .send(validDraftBody);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(DRAFT_ID);
  });
});

// ── GET /coach/swimmers/:id/drafts ────────────────────────────────────────────

describe("GET /coach/swimmers/:id/drafts", () => {
  it("returns 200 with empty array when no drafts", async () => {
    authAs(profileCoach);

    const orderByMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/drafts`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.drafts).toEqual([]);
  });

  it("returns 200 with drafts array", async () => {
    authAs(profileCoach);

    const orderByMock = vi.fn().mockResolvedValue([storedDraft]);
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/drafts`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].id).toBe(DRAFT_ID);
  });
});

// ── GET /coach/drafts/:draftId ────────────────────────────────────────────────

describe("GET /coach/drafts/:draftId — auth", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get(`/coach/drafts/${DRAFT_ID}`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when parent", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));

    const res = await request(app)
      .get(`/coach/drafts/${DRAFT_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });
});

describe("GET /coach/drafts/:draftId", () => {
  it("returns 404 when draft not found", async () => {
    authAs(profileCoach);

    const limitMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .get(`/coach/drafts/${DRAFT_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 404 when coachId does not match", async () => {
    authAs(profileCoach);

    const wrongOwnerDraft = { ...storedDraft, coachId: PARENT_ID };
    const limitMock = vi.fn().mockResolvedValue([wrongOwnerDraft]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .get(`/coach/drafts/${DRAFT_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 200 with draft", async () => {
    authAs(profileCoach);

    const limitMock = vi.fn().mockResolvedValue([storedDraft]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .get(`/coach/drafts/${DRAFT_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(DRAFT_ID);
  });
});

// ── DELETE /coach/drafts/:draftId ─────────────────────────────────────────────

describe("DELETE /coach/drafts/:draftId", () => {
  it("returns 404 when not found", async () => {
    authAs(profileCoach);

    const limitMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .delete(`/coach/drafts/${DRAFT_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 204 on success", async () => {
    authAs(profileCoach);

    const limitMock = vi.fn().mockResolvedValue([{ id: DRAFT_ID, coachId: COACH_ID }]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    const deleteWhereMock = vi.fn().mockResolvedValue([]);
    mockDbDelete.mockReturnValue({ where: deleteWhereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock });

    const res = await request(app)
      .delete(`/coach/drafts/${DRAFT_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(204);
  });
});

// ── POST /coach/drafts/:draftId/finalize ──────────────────────────────────────

describe("POST /coach/drafts/:draftId/finalize", () => {
  it("returns 403 when parent", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));

    const res = await request(app)
      .post(`/coach/drafts/${DRAFT_ID}/finalize`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 422 with sessionDate error when sessionDate is null", async () => {
    authAs(profileCoach);

    const draftNoDate = { ...storedDraft, sessionDate: null };
    const limitMock = vi.fn().mockResolvedValue([draftNoDate]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock })
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow));

    const res = await request(app)
      .post(`/coach/drafts/${DRAFT_ID}/finalize`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toBe("sessionDate is required to finalize");
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 with context error when context is null", async () => {
    authAs(profileCoach);

    const draftNoContext = { ...storedDraft, context: null };
    const limitMock = vi.fn().mockResolvedValue([draftNoContext]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock })
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow));

    const res = await request(app)
      .post(`/coach/drafts/${DRAFT_ID}/finalize`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toBe("context is required to finalize");
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("returns 422 with coachingPriority error when coachingPriority is null", async () => {
    authAs(profileCoach);

    const draftNoPriority = { ...storedDraft, coachingPriority: null };
    const limitMock = vi.fn().mockResolvedValue([draftNoPriority]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock })
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow));

    const res = await request(app)
      .post(`/coach/drafts/${DRAFT_ID}/finalize`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toBe("coachingPriority is required to finalize");
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("returns 201 and creates session for valid draft with empty payload", async () => {
    authAs(profileCoach);

    const limitMock = vi.fn().mockResolvedValue([storedDraft]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    const skillsWhereMock = vi.fn().mockResolvedValue([]);
    const skillsFromMock = vi.fn().mockReturnValue({ where: skillsWhereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock })
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce({ from: skillsFromMock });

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "session-id-here" }]),
          }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/coach/drafts/${DRAFT_ID}/finalize`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
    expect(res.body.issues[0].message).toContain("No completed ratings");
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it("returns 201 and creates session for valid draft with a rated skill", async () => {
    authAs(profileCoach);

    const draftWithRating = {
      ...storedDraft,
      payload: {
        [SKILL_ID]: {
          grade: 3,
          notLegal: false,
          noConcept: false,
          faultTags: [],
          capacityValue: "",
          capacityUnit: null,
          measurementValue: "",
          measurementUnit: null,
          golfScoreCategory: null,
          note: "",
        },
      },
    };

    const limitMock = vi.fn().mockResolvedValue([draftWithRating]);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });

    const skillRow = {
      id: SKILL_ID,
      slug: "buoyancy-balance",
      parentSkillId: null,
      type: "rubric" as const,
      unit: null,
      faultTags: [],
      ratedPerSide: false,
      notLegalAllowed: false,
      archivedAt: null,
    };
    const skillsWhereMock = vi.fn().mockResolvedValue([skillRow]);
    const skillsFromMock = vi.fn().mockReturnValue({ where: skillsWhereMock });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce({ from: fromMock })
      .mockReturnValueOnce(swimmerSelect(activeSwimmerRow))
      .mockReturnValueOnce({ from: skillsFromMock });

    const txDeleteWhere = vi.fn().mockResolvedValue([]);
    const txDelete = vi.fn().mockReturnValue({ where: txDeleteWhere });
    const txInsertReturning = vi.fn()
      .mockResolvedValueOnce([{ id: "session-id-here" }])
      .mockResolvedValueOnce([{ id: "rating-id-here" }]);
    const txInsertValues = vi.fn().mockReturnValue({ returning: txInsertReturning });
    const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { insert: txInsert, delete: txDelete };
      return fn(tx);
    });

    const res = await request(app)
      .post(`/coach/drafts/${DRAFT_ID}/finalize`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe("session-id-here");
    expect(txDelete).toHaveBeenCalled();
  });
});
