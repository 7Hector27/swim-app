import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

// ── IDs ───────────────────────────────────────────────────────────────────────

const PROFILE_COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000003";
const MEET_ID = "dddddddd-0000-0000-0000-000000000004";
const SWIM_ID = "eeeeeeee-0000-0000-0000-000000000005";

const now = new Date("2025-06-15T12:00:00.000Z");

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockGetUser, mockDbSelect, mockDbInsert, mockDbUpdate, mockDbDelete } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
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
  },
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const profileCoach = {
  id: PROFILE_COACH_ID,
  role: "coach" as const,
  fullName: "Coach",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const profileParent = {
  id: PROFILE_PARENT_ID,
  role: "parent" as const,
  fullName: "Parent",
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

function swimmerExistsSelect(found: boolean) {
  const limit = vi.fn().mockResolvedValue(found ? [{ id: SWIMMER_ID }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function meetSelect(row: {
  id: string;
  name: string;
  meetDate: string;
  course: "scy" | "scm" | "lcm";
  createdAt: Date;
  updatedAt: Date;
} | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function swimsForMeetSelect(hasSwims: boolean) {
  const limit = vi.fn().mockResolvedValue(hasSwims ? [{ id: SWIM_ID }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

const baseMeetRow = {
  id: MEET_ID,
  name: "Summer Champs",
  meetDate: "2025-06-01",
  course: "scy" as const,
  createdAt: now,
  updatedAt: now,
};

const baseSwimRow = {
  id: SWIM_ID,
  swimmerId: SWIMMER_ID,
  swimType: "meet" as const,
  meetId: MEET_ID,
  eventDistance: 100,
  eventStroke: "free" as const,
  course: "scy" as const,
  timeHundredths: 5830,
  swumOn: "2025-06-01",
  createdAt: now,
  updatedAt: now,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /coach/meets ──────────────────────────────────────────────────────────

describe("GET /coach/meets", () => {
  it("returns meets list for coach", async () => {
    authAs(profileCoach);
    const orderBy = vi.fn().mockResolvedValue([baseMeetRow]);
    const from = vi.fn().mockReturnValue({ orderBy });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce({ from });

    const res = await request(app)
      .get("/coach/meets")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: MEET_ID, name: "Summer Champs" });
  });

  it("returns 403 for parent", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));

    const res = await request(app)
      .get("/coach/meets")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── POST /coach/meets ─────────────────────────────────────────────────────────

describe("POST /coach/meets", () => {
  it("creates a meet and returns 201", async () => {
    authAs(profileCoach);
    const returning = vi.fn().mockResolvedValue([baseMeetRow]);
    const values = vi.fn().mockReturnValue({ returning });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)); // coachRouter requireUser (once)
    mockDbInsert.mockReturnValue({ values });

    const res = await request(app)
      .post("/coach/meets")
      .set("Authorization", "Bearer token")
      .send({ name: "Summer Champs", meetDate: "2025-06-01", course: "scy" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Summer Champs", course: "scy" });
  });

  it("returns 422 for missing required fields", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const res = await request(app)
      .post("/coach/meets")
      .set("Authorization", "Bearer token")
      .send({ name: "Summer Champs" });

    expect(res.status).toBe(422);
  });
});

// ── DELETE /coach/meets/:id ───────────────────────────────────────────────────

describe("DELETE /coach/meets/:id", () => {
  it("returns 200 when meet has no swims", async () => {
    authAs(profileCoach);
    const returning = vi.fn().mockResolvedValue([{ id: MEET_ID }]);
    const deletedWhere = vi.fn().mockReturnValue({ returning });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimsForMeetSelect(false)); // no swims
    mockDbDelete.mockReturnValue({ where: deletedWhere });

    const res = await request(app)
      .delete(`/coach/meets/${MEET_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 422 when meet has swims", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimsForMeetSelect(true)); // has swims

    const res = await request(app)
      .delete(`/coach/meets/${MEET_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("meet_has_swims");
  });

  it("returns 404 when meet does not exist", async () => {
    authAs(profileCoach);
    const returning = vi.fn().mockResolvedValue([]);
    const deletedWhere = vi.fn().mockReturnValue({ returning });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimsForMeetSelect(false)); // no swims
    mockDbDelete.mockReturnValue({ where: deletedWhere });

    const res = await request(app)
      .delete(`/coach/meets/${MEET_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

// ── GET /coach/meets/:id ──────────────────────────────────────────────────────

function pbGroupBySelect(rows: Array<{ eventDistance: number; eventStroke: string; course: string; timeHundredths: number }>) {
  const groupBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ groupBy });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function swimsWhereSelect(rows: typeof baseSwimRow[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

describe("GET /coach/meets/:id", () => {
  it("returns 200 with meet data and swims array", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(meetSelect(baseMeetRow))
      .mockReturnValueOnce(swimsWhereSelect([baseSwimRow]));

    const res = await request(app)
      .get(`/coach/meets/${MEET_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: MEET_ID, name: "Summer Champs" });
    expect(res.body.swims).toHaveLength(1);
    expect(res.body.swims[0]).toMatchObject({ id: SWIM_ID, eventDistance: 100, eventStroke: "free" });
  });

  it("returns 404 when meet not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(meetSelect(null));

    const res = await request(app)
      .get(`/coach/meets/${MEET_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

// ── POST /coach/swimmers/:id/meet-swims ───────────────────────────────────────

describe("POST /coach/swimmers/:id/meet-swims", () => {
  it("creates a meet swim and returns 201", async () => {
    authAs(profileCoach);
    const returning = vi.fn().mockResolvedValue([baseSwimRow]);
    const values = vi.fn().mockReturnValue({ returning });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(meetSelect(baseMeetRow));
    mockDbInsert.mockReturnValue({ values });

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "meet",
        meetId: MEET_ID,
        eventDistance: 100,
        eventStroke: "free",
        course: "scy",
        timeString: "58.30",
        swumOn: "2025-06-01",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      eventDistance: 100,
      eventStroke: "free",
      timeString: "58.30",
    });
  });

  it("creates a practice swim with no meetId and returns 201", async () => {
    authAs(profileCoach);
    const practiceSwimRow = { ...baseSwimRow, swimType: "practice" as const, meetId: null };
    const returning = vi.fn().mockResolvedValue([practiceSwimRow]);
    const values = vi.fn().mockReturnValue({ returning });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true));
    mockDbInsert.mockReturnValue({ values });

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "practice",
        eventDistance: 100,
        eventStroke: "free",
        course: "scy",
        timeString: "58.30",
        swumOn: "2025-06-15",
      });

    expect(res.status).toBe(201);
    expect(res.body.swimType).toBe("practice");
  });

  it("returns 422 when swimType is meet but meetId is missing", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "meet",
        eventDistance: 100,
        eventStroke: "free",
        course: "scy",
        timeString: "58.30",
        swumOn: "2025-06-01",
      });

    expect(res.status).toBe(422);
  });

  it("returns 422 for invalid event (IM at 50 yards)", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "practice",
        eventDistance: 50,
        eventStroke: "im",
        course: "scy",
        timeString: "58.30",
        swumOn: "2025-06-15",
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_event");
  });

  it("returns 422 for invalid time string", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "practice",
        eventDistance: 100,
        eventStroke: "free",
        course: "scy",
        timeString: "not-a-time",
        swumOn: "2025-06-15",
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_time");
  });

  it("returns 404 when swimmer not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(false));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "practice",
        eventDistance: 100,
        eventStroke: "free",
        course: "scy",
        timeString: "58.30",
        swumOn: "2025-06-15",
      });

    expect(res.status).toBe(404);
  });

  it("returns 422 when swumOn is before meetDate", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(meetSelect({ ...baseMeetRow, meetDate: "2025-06-10" }));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token")
      .send({
        swimType: "meet",
        meetId: MEET_ID,
        eventDistance: 100,
        eventStroke: "free",
        course: "scy",
        timeString: "58.30",
        swumOn: "2025-06-01",
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("swum_on_before_meet");
  });
});

// ── GET /coach/swimmers/:id/meet-swims ────────────────────────────────────────

describe("GET /coach/swimmers/:id/meet-swims", () => {
  it("returns swims and personal bests for meet swims only", async () => {
    authAs(profileCoach);
    const practiceSwimRow = {
      ...baseSwimRow,
      id: "ff000000-0000-0000-0000-000000000099",
      swimType: "practice" as const,
      meetId: null,
      timeHundredths: 6000,
      meetName: null,
      meetDate: null,
    };
    const meetSwimRow = {
      ...baseSwimRow,
      meetName: "Summer Champs",
      meetDate: "2025-06-01",
    };
    const orderBy = vi.fn().mockResolvedValue([meetSwimRow, practiceSwimRow]);
    const leftJoin = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy }) });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ leftJoin }) })
      .mockReturnValueOnce(pbGroupBySelect([{ eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5830 }]));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_ID}/meet-swims`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.swims).toHaveLength(2);
    // Personal bests should only include the meet swim, not the practice swim
    expect(res.body.personalBests).toHaveLength(1);
    expect(res.body.personalBests[0].timeString).toBe("58.30");
  });
});

// ── PATCH /coach/swimmers/:id/meet-swims/:swimId ──────────────────────────────

describe("PATCH /coach/swimmers/:id/meet-swims/:swimId", () => {
  function existingSwimSelect(row: typeof baseSwimRow | null) {
    const limit = vi.fn().mockResolvedValue(row ? [row] : []);
    const where = vi.fn().mockReturnValue({ limit });
    return { from: vi.fn().mockReturnValue({ where }) };
  }

  it("updates timeString and returns 200 with updated swim", async () => {
    authAs(profileCoach);
    const updatedRow = { ...baseSwimRow, timeHundredths: 5750 };
    const returning = vi.fn().mockResolvedValue([updatedRow]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(existingSwimSelect(baseSwimRow))
      .mockReturnValueOnce(meetSelect(baseMeetRow)); // fetch meet for response
    mockDbUpdate.mockReturnValue({ set });

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token")
      .send({ timeString: "57.50" });

    expect(res.status).toBe(200);
    expect(res.body.timeString).toBe("57.50");
  });

  it("returns 422 for invalid event on patch", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(existingSwimSelect(baseSwimRow));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token")
      .send({ eventDistance: 50, eventStroke: "im" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_event");
  });

  it("returns 422 for invalid time string on patch", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(existingSwimSelect(baseSwimRow));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token")
      .send({ timeString: "not-valid" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_time");
  });

  it("returns 404 when swim belongs to a different swimmer", async () => {
    authAs(profileCoach);
    const differentSwimRow = { ...baseSwimRow, swimmerId: "xxxxxxxx-0000-0000-0000-000000000099" };
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(existingSwimSelect(differentSwimRow));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token")
      .send({ timeString: "57.50" });

    expect(res.status).toBe(404);
  });

  it("returns 422 when patching swumOn before meetDate", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(existingSwimSelect(baseSwimRow))
      .mockReturnValueOnce(meetSelect({ ...baseMeetRow, meetDate: "2025-06-10" }));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token")
      .send({ swumOn: "2025-05-01" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("swum_on_before_meet");
  });

  it("returns 422 for empty body", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token")
      .send({});

    expect(res.status).toBe(422);
  });
});

// ── DELETE /coach/swimmers/:id/meet-swims/:swimId ─────────────────────────────

describe("DELETE /coach/swimmers/:id/meet-swims/:swimId", () => {
  function swimByIdSelect(row: { id: string; swimmerId: string } | null) {
    const limit = vi.fn().mockResolvedValue(row ? [row] : []);
    const where = vi.fn().mockReturnValue({ limit });
    return { from: vi.fn().mockReturnValue({ where }) };
  }

  it("returns 204 when swim is deleted", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(swimByIdSelect({ id: SWIM_ID, swimmerId: SWIMMER_ID }));
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });

  it("returns 404 when swimmer not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(false));

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 404 when swim not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(swimByIdSelect(null));

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 404 when swim belongs to a different swimmer", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach)) // coachRouter requireUser (once)
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(swimByIdSelect({ id: SWIM_ID, swimmerId: "xxxxxxxx-0000-0000-0000-000000000099" }));

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_ID}/meet-swims/${SWIM_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});
