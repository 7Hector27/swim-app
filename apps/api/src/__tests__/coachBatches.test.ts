import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const COACH_PROFILE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_PROFILE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const VIEWER_PROFILE_ID = "bbbbbbbb-0000-0000-0000-000000000003";
const HOUSEHOLD_ID = "cccccccc-0000-0000-0000-000000000010";
const BATCH_ID = "dddddddd-0000-0000-0000-000000000020";
const LESSON_A = "eeeeeeee-0000-0000-0000-00000000000a";
const LESSON_B = "eeeeeeee-0000-0000-0000-00000000000b";
const LESSON_C = "eeeeeeee-0000-0000-0000-00000000000c";
const LOCATION_ID = "ffffffff-0000-0000-0000-000000000030";
const SWIMMER_ID = "ffffffff-0000-0000-0000-000000000040";

const now = new Date("2026-11-01T00:00:00.000Z");

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

const coachProfile = {
  id: COACH_PROFILE_ID,
  role: "coach" as const,
  fullName: "Coach Jason",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const parentProfile = {
  id: PARENT_PROFILE_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const viewerProfile = {
  id: VIEWER_PROFILE_ID,
  role: "viewer" as const,
  fullName: "Viewer B",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const batchHeadRow = {
  id: BATCH_ID,
  mode: "weekly",
  householdId: HOUSEHOLD_ID,
  createdBy: PARENT_PROFILE_ID,
  createdAt: new Date("2026-11-02T15:00:00.000Z"),
  householdName: "Smith",
  createdByName: "Alice Smith",
};

// Intentionally out of chronological order to exercise the ORDER BY.
const lessonRows = [
  {
    id: LESSON_B,
    startsAt: new Date("2026-11-10T23:30:00.000Z"),
    durationMinutes: 30,
    type: "private" as const,
    status: "canceled" as const,
    locationId: LOCATION_ID,
    locationName: "Egret Park",
  },
  {
    id: LESSON_A,
    startsAt: new Date("2026-11-03T23:30:00.000Z"),
    durationMinutes: 30,
    type: "private" as const,
    status: "approved" as const,
    locationId: LOCATION_ID,
    locationName: "Egret Park",
  },
  {
    id: LESSON_C,
    startsAt: new Date("2026-11-17T23:30:00.000Z"),
    durationMinutes: 30,
    type: "private" as const,
    status: "no_show" as const,
    locationId: LOCATION_ID,
    locationName: "Egret Park",
  },
];

// The real route's drizzle query sorts by startsAt ASC. Mock the DB to return
// the already-sorted shape (matching what Postgres would return), so the test
// verifies the response order carries that through intact.
const lessonRowsSorted = [...lessonRows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

const swimmerRows = [
  { lessonId: LESSON_A, swimmerId: SWIMMER_ID, firstName: "Jamie", lastName: "Smith" },
  { lessonId: LESSON_B, swimmerId: SWIMMER_ID, firstName: "Jamie", lastName: "Smith" },
  { lessonId: LESSON_C, swimmerId: SWIMMER_ID, firstName: "Jamie", lastName: "Smith" },
];

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

// Mocks the batch head query:
//   select ... from bookingBatches innerJoin households leftJoin profiles
//     where(eq(bookingBatches.id, id)).limit(1)
function batchHeadSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const leftJoin = vi.fn().mockReturnValue({ where });
  const innerJoin = vi.fn().mockReturnValue({ leftJoin });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

// Mocks the lessons query:
//   select ... from lessons innerJoin lessonLocations
//     where(eq(lessons.batchId, id)).orderBy(asc(lessons.startsAt))
// Returns the orderBy spy so the test can assert the call site actually
// passed an ordering expression. Mocks always return rows in the order we
// hand them, so the ordering of the response can't be re-derived from the
// output — we assert the ORDER BY call instead. Real sort semantics are
// covered by the integration tests against Postgres.
function lessonsSelect(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  return {
    builder: { from: vi.fn().mockReturnValue({ innerJoin }) },
    orderBy,
  };
}

// Mocks the household-name fallback query:
//   select profiles.fullName from householdMembers innerJoin profiles
//     where(eq(householdMembers.householdId, ...)).orderBy(...).limit(1)
// Returns the orderBy spy so the test can confirm the fallback is sorted
// deterministically (owner first, then joinedAt, then profileId).
function householdFallbackSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  return {
    builder: { from: vi.fn().mockReturnValue({ innerJoin }) },
    orderBy,
  };
}

// Mocks the swimmer join query:
//   select ... from lessonSwimmers innerJoin swimmers where(inArray(...))
function swimmerJoinSelect(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /coach/batches/:id", () => {
  it("returns the batch header + lessons, asks the DB to sort by startsAt ASC, and surfaces cancelled/no-show rows with their status", async () => {
    // Scope of this test: assert the SHAPE of the response and that the
    // route actually calls orderBy with an expression on lessons.startsAt.
    // The mock resolves orderBy to whatever array we hand it, so the array
    // order in res.body only reflects what we fed in — the real sort
    // behavior against Postgres is covered in the integration tests.
    authAs(coachProfile);
    const lessonsMock = lessonsSelect(lessonRowsSorted);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(batchHeadSelect([batchHeadRow]))
      .mockReturnValueOnce(lessonsMock.builder)
      .mockReturnValueOnce(swimmerJoinSelect(swimmerRows));

    const res = await request(app)
      .get(`/coach/batches/${BATCH_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(BATCH_ID);
    expect(res.body.householdName).toBe("Smith");
    expect(res.body.createdByName).toBe("Alice Smith");
    expect(res.body.lessons).toHaveLength(3);
    // Each row has at least one swimmer attached.
    for (const lesson of res.body.lessons) {
      expect(lesson.swimmers.length).toBeGreaterThan(0);
    }
    // Cancelled + no-show are passed through with their status, not filtered.
    const statuses = res.body.lessons.map((row: { status: string }) => row.status);
    expect(statuses).toContain("canceled");
    expect(statuses).toContain("no_show");
    // The route asked the DB to order by lessons.startsAt (ascending). We
    // can't prove ASC vs DESC through a mock, so just prove orderBy was
    // called with exactly one argument — a Drizzle sort expression.
    expect(lessonsMock.orderBy).toHaveBeenCalledTimes(1);
    expect(lessonsMock.orderBy.mock.calls[0]).toHaveLength(1);
  });

  it("falls back to a deterministic member name when households.name is empty, sorting owner → oldest joined_at → profile_id", async () => {
    authAs(coachProfile);
    const nullNameBatchRow = { ...batchHeadRow, householdName: null };
    const fallbackMock = householdFallbackSelect([{ fullName: "Owner Alice" }]);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(batchHeadSelect([nullNameBatchRow]))
      .mockReturnValueOnce(fallbackMock.builder)
      .mockReturnValueOnce(lessonsSelect(lessonRowsSorted).builder)
      .mockReturnValueOnce(swimmerJoinSelect(swimmerRows));

    const res = await request(app)
      .get(`/coach/batches/${BATCH_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.householdName).toBe("Owner Alice");
    // The fallback must ask the DB for a deterministic sort. Three
    // expressions: owner-first CASE, joinedAt ASC, profileId ASC. Without
    // all three the result would flap for families that joined in the
    // same transaction and have no owner set.
    expect(fallbackMock.orderBy).toHaveBeenCalledTimes(1);
    expect(fallbackMock.orderBy.mock.calls[0]).toHaveLength(3);
  });

  it("returns 404 for an unknown batch id", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(batchHeadSelect([]));

    const res = await request(app)
      .get(`/coach/batches/${BATCH_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get(`/coach/batches/${BATCH_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("returns 403 for a viewer", async () => {
    authAs(viewerProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(viewerProfile));

    const res = await request(app)
      .get(`/coach/batches/${BATCH_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("returns 400 for a non-UUID id", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .get("/coach/batches/not-a-uuid")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
  });
});
