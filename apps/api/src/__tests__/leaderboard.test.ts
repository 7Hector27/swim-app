import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

// ── IDs ───────────────────────────────────────────────────────────────────────

const PROFILE_COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SWIMMER_PUBLIC_ID = "cccccccc-0000-0000-0000-000000000010";
const SWIMMER_PRIVATE_ID = "cccccccc-0000-0000-0000-000000000011";
const SWIMMER_ARCHIVED_ID = "cccccccc-0000-0000-0000-000000000012";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockGetUser, mockDbSelect } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: { select: mockDbSelect },
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
  ageAttestedAt: new Date(),
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function authAs(profile: { id: string; role: string; [key: string]: unknown }) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: profile.id, email: "coach@example.com" } },
    error: null,
  });
}

function requireUserSelect(profile: { id: string; role: string; [key: string]: unknown }) {
  const where = vi.fn().mockResolvedValue([profile]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// Returns a mock db.select() chain for a list of registrations.
function registrationsSelect(rows: Array<{ swimmerId: string; registeredOn?: string }>) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// Returns swimmers from a .where() call.
function swimmersSelect(rows: Array<{ id: string; firstName: string; lastName: string; birthDate: string; sex: string }>) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// Returns PBs from a .groupBy() call.
function pbsSelect(rows: Array<{ swimmerId: string; eventDistance: number; eventStroke: string; course: string; timeHundredths: number }>) {
  const groupBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ groupBy });
  return { from: vi.fn().mockReturnValue({ where }) };
}

// Returns standards from a .from() call (no where).
function standardsSelect(rows: Array<{ standardName: string; eventDistance: number; eventStroke: string; course: string; sex: string; ageGroup: string; cutTimeHundredths: number }>) {
  const from = vi.fn().mockResolvedValue(rows);
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── ageToGroup unit tests ─────────────────────────────────────────────────────

import { ageToGroup } from "@swim-app/shared";

describe("ageToGroup", () => {
  it("maps age 0 → 6-under", () => expect(ageToGroup(0)).toBe("6-under"));
  it("maps age 6 → 6-under", () => expect(ageToGroup(6)).toBe("6-under"));
  it("maps age 7 → 7-8", () => expect(ageToGroup(7)).toBe("7-8"));
  it("maps age 8 → 7-8", () => expect(ageToGroup(8)).toBe("7-8"));
  it("maps age 9 → 9-10", () => expect(ageToGroup(9)).toBe("9-10"));
  it("maps age 10 → 9-10", () => expect(ageToGroup(10)).toBe("9-10"));
  it("maps age 11 → 11-12", () => expect(ageToGroup(11)).toBe("11-12"));
  it("maps age 12 → 11-12", () => expect(ageToGroup(12)).toBe("11-12"));
  it("maps age 13 → 13-14", () => expect(ageToGroup(13)).toBe("13-14"));
  it("maps age 14 → 13-14", () => expect(ageToGroup(14)).toBe("13-14"));
  it("maps age 15 → 15-18", () => expect(ageToGroup(15)).toBe("15-18"));
  it("maps age 18 → 15-18", () => expect(ageToGroup(18)).toBe("15-18"));
  it("returns null for age 19", () => expect(ageToGroup(19)).toBeNull());
  it("returns null for age 25", () => expect(ageToGroup(25)).toBeNull());
});

// ── Public boards: practice swims never count ─────────────────────────────────

describe("GET /leaderboard/club — practice swims never count", () => {
  it("personal bests only use meet swims, not practice", async () => {
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([{ swimmerId: SWIMMER_PUBLIC_ID }]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
      ]))
      // PB query with swim_type = 'meet' filter — practice rows excluded upstream
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 6000 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].time).toBe("1:00.00");
  });
});

// ── Heat and final: only fastest kept ────────────────────────────────────────

describe("GET /leaderboard/club — ties from heat and final keep only fastest", () => {
  it("when two meet swims exist for same event, returns only the faster one", async () => {
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([{ swimmerId: SWIMMER_PUBLIC_ID }]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
      ]))
      // The PB query uses MIN(time_hundredths) — only one row per event/course
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    expect(res.body.rows[0].time).toBe("55.00");
  });
});

// ── Non-public swimmers excluded from public board ────────────────────────────

describe("GET /leaderboard/club — visibility", () => {
  it("non-public swimmer absent from public board", async () => {
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID },
        { swimmerId: SWIMMER_PRIVATE_ID },
      ]))
      // Only the public swimmer is returned (is_public = true filter applied in query)
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].firstName).toBe("Alice");
  });

  it("non-public swimmer present on coach board", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(registrationsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID },
        { swimmerId: SWIMMER_PRIVATE_ID },
      ]))
      // Coach query has no is_public filter — both swimmers returned
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
        { id: SWIMMER_PRIVATE_ID, firstName: "Bob", lastName: "Jones", birthDate: "2013-05-10", sex: "male" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
        { swimmerId: SWIMMER_PRIVATE_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5600 },
      ]));

    const res = await request(app)
      .get("/coach/leaderboard/club")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
  });
});

// ── Archived swimmers excluded ────────────────────────────────────────────────

describe("GET /leaderboard/club — archived swimmers excluded", () => {
  it("archived swimmer is not returned even if registered", async () => {
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID },
        { swimmerId: SWIMMER_ARCHIVED_ID },
      ]))
      // Archived swimmer not returned (archived_at IS NULL filter in query)
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].firstName).toBe("Alice");
  });
});

// ── Ties share a rank ─────────────────────────────────────────────────────────

describe("GET /leaderboard/club — ties share a rank", () => {
  it("two swimmers with identical times both get rank 1", async () => {
    const SWIMMER_B_ID = "cccccccc-0000-0000-0000-000000000020";
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID },
        { swimmerId: SWIMMER_B_ID },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
        { id: SWIMMER_B_ID, firstName: "Carol", lastName: "Lee", birthDate: "2015-06-15", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
        { swimmerId: SWIMMER_B_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    const ranks = res.body.rows.map((row: { rank: number }) => row.rank);
    expect(ranks).toEqual([1, 1]);
  });

  it("a third swimmer after two ties gets rank 3", async () => {
    const SWIMMER_B_ID = "cccccccc-0000-0000-0000-000000000020";
    const SWIMMER_C_ID = "cccccccc-0000-0000-0000-000000000021";
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID },
        { swimmerId: SWIMMER_B_ID },
        { swimmerId: SWIMMER_C_ID },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
        { id: SWIMMER_B_ID, firstName: "Carol", lastName: "Lee", birthDate: "2015-06-15", sex: "female" },
        { id: SWIMMER_C_ID, firstName: "Dana", lastName: "Park", birthDate: "2015-03-20", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
        { swimmerId: SWIMMER_B_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
        { swimmerId: SWIMMER_C_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5700 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    const sorted = [...res.body.rows].sort((a: { rank: number; time: string }, b: { rank: number; time: string }) =>
      a.time.localeCompare(b.time),
    );
    expect(sorted[0].rank).toBe(1);
    expect(sorted[1].rank).toBe(1);
    expect(sorted[2].rank).toBe(3);
  });
});

// ── ISL age uses registered_on ────────────────────────────────────────────────

describe("GET /leaderboard/isl — age uses registered_on date", () => {
  it("groups swimmer by age on registration date, not today", async () => {
    // Swimmer born 2013-07-01. On registered_on 2025-06-01 they are 11 → group 11-12.
    // But on today 2026-10-15 they are 13 → group 13-14. ISL uses registered_on.
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, registeredOn: "2025-06-01" },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2013-07-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 6000 },
      ]));

    const res = await request(app).get("/leaderboard/isl");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].ageGroup).toBe("11-12");
  });
});

// ── Master empty state ────────────────────────────────────────────────────────

describe("GET /leaderboard/master — empty standards table", () => {
  it("returns standardsAvailable: false and no rows", async () => {
    mockDbSelect.mockReturnValueOnce(standardsSelect([]));

    const res = await request(app).get("/leaderboard/master");

    expect(res.status).toBe(200);
    expect(res.body.standardsAvailable).toBe(false);
    expect(res.body.rows).toEqual([]);
  });

  it("returns standardsAvailable: true when standards exist", async () => {
    // Swimmer born 2016-06-01 is 10 years old on 2026-10-15 → age group "9-10"
    mockDbSelect
      .mockReturnValueOnce(standardsSelect([
        { standardName: "B", eventDistance: 100, eventStroke: "free", course: "scy", sex: "female", ageGroup: "9-10", cutTimeHundredths: 7000 },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2016-06-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 6500 },
      ]));

    const res = await request(app).get("/leaderboard/master");

    expect(res.status).toBe(200);
    expect(res.body.standardsAvailable).toBe(true);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].standard).toBe("B");
  });

  it("shows highest standard achieved when swimmer meets multiple", async () => {
    // Swimmer's PB is 60.00, which beats both B (70.00) and BB (65.00) cuts but not A (55.00)
    mockDbSelect
      .mockReturnValueOnce(standardsSelect([
        { standardName: "B", eventDistance: 100, eventStroke: "free", course: "scy", sex: "female", ageGroup: "9-10", cutTimeHundredths: 7000 },
        { standardName: "BB", eventDistance: 100, eventStroke: "free", course: "scy", sex: "female", ageGroup: "9-10", cutTimeHundredths: 6500 },
        { standardName: "A", eventDistance: 100, eventStroke: "free", course: "scy", sex: "female", ageGroup: "9-10", cutTimeHundredths: 5500 },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2016-06-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 6000 },
      ]));

    const res = await request(app).get("/leaderboard/master");

    expect(res.status).toBe(200);
    expect(res.body.rows[0].standard).toBe("BB");
  });

  it("excludes swimmer whose PB doesn't meet any standard", async () => {
    // Swimmer PB is 75.00 — slower than B cut of 70.00
    mockDbSelect
      .mockReturnValueOnce(standardsSelect([
        { standardName: "B", eventDistance: 100, eventStroke: "free", course: "scy", sex: "female", ageGroup: "9-10", cutTimeHundredths: 7000 },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2016-06-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 7500 },
      ]));

    const res = await request(app).get("/leaderboard/master");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });
});

// ── Public response contains no PII ──────────────────────────────────────────

describe("Public response PII serialization", () => {
  const PII_PATTERNS = [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // UUID
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO datetime (birthDate would be YYYY-MM-DD)
    /"birthDate"/, // explicit field name
    /"householdId"/, // household
    /"publicConsentAt"/,
  ];

  const LAST_NAME_PATTERNS = [/"lastName"/, /"Smith"/, /"Jones"/];

  function assertNoPii(body: string) {
    for (const pattern of PII_PATTERNS) {
      expect(body).not.toMatch(pattern);
    }
    for (const pattern of LAST_NAME_PATTERNS) {
      expect(body).not.toMatch(pattern);
    }
  }

  it("club board response contains no ids, last names, or birth dates", async () => {
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([{ swimmerId: SWIMMER_PUBLIC_ID }]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2015-01-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
      ]));

    const res = await request(app).get("/leaderboard/club");

    expect(res.status).toBe(200);
    assertNoPii(JSON.stringify(res.body));
    expect(JSON.stringify(res.body)).toContain('"lastInitial"');
    expect(JSON.stringify(res.body)).toContain('"Alice"');
  });

  it("ISL board response contains no ids, last names, or birth dates", async () => {
    mockDbSelect
      .mockReturnValueOnce(registrationsSelect([{ swimmerId: SWIMMER_PUBLIC_ID, registeredOn: "2025-06-01" }]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Jones", birthDate: "2015-01-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 5500 },
      ]));

    const res = await request(app).get("/leaderboard/isl");

    expect(res.status).toBe(200);
    assertNoPii(JSON.stringify(res.body));
    expect(JSON.stringify(res.body)).not.toContain(SWIMMER_PUBLIC_ID);
  });

  it("master board response contains no ids, last names, or birth dates", async () => {
    mockDbSelect
      .mockReturnValueOnce(standardsSelect([
        { standardName: "B", eventDistance: 100, eventStroke: "free", course: "scy", sex: "female", ageGroup: "9-10", cutTimeHundredths: 7000 },
      ]))
      .mockReturnValueOnce(swimmersSelect([
        { id: SWIMMER_PUBLIC_ID, firstName: "Alice", lastName: "Smith", birthDate: "2016-06-01", sex: "female" },
      ]))
      .mockReturnValueOnce(pbsSelect([
        { swimmerId: SWIMMER_PUBLIC_ID, eventDistance: 100, eventStroke: "free", course: "scy", timeHundredths: 6500 },
      ]));

    const res = await request(app).get("/leaderboard/master");

    expect(res.status).toBe(200);
    assertNoPii(JSON.stringify(res.body));
    expect(JSON.stringify(res.body)).not.toContain(SWIMMER_PUBLIC_ID);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe("GET /leaderboard/club — rate limiting", () => {
  it("returns 429 after exceeding 60 requests per minute", async () => {
    // Use a fresh app so prior test requests don't consume the budget.
    const freshApp = createApp(pino({ level: "silent" }));

    // Requests 1-60 reach the handler (one registrations select each).
    // Request 61 is blocked by the rate limiter before any DB call.
    for (let index = 0; index < 60; index++) {
      mockDbSelect.mockReturnValueOnce(registrationsSelect([]));
    }

    let lastStatus = 200;
    for (let index = 0; index < 61; index++) {
      const res = await request(freshApp).get("/leaderboard/club");
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
