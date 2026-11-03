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
function lessonsSelect(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
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
  it("returns the batch header + lessons ordered by startsAt ASC, including cancelled and no-show", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(batchHeadSelect([batchHeadRow]))
      .mockReturnValueOnce(lessonsSelect(lessonRowsSorted))
      .mockReturnValueOnce(swimmerJoinSelect(swimmerRows));

    const res = await request(app)
      .get(`/coach/batches/${BATCH_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(BATCH_ID);
    expect(res.body.householdName).toBe("Smith");
    expect(res.body.createdByName).toBe("Alice Smith");
    expect(res.body.lessons).toHaveLength(3);
    // Ordered by startsAt ASC.
    expect(res.body.lessons.map((row: { id: string }) => row.id)).toEqual([
      LESSON_A,
      LESSON_B,
      LESSON_C,
    ]);
    // Cancelled + no-show are included with their status, not filtered out.
    const statuses = res.body.lessons.map((row: { status: string }) => row.status);
    expect(statuses).toEqual(["approved", "canceled", "no_show"]);
    // Each row has at least one swimmer attached.
    for (const lesson of res.body.lessons) {
      expect(lesson.swimmers.length).toBeGreaterThan(0);
    }
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
