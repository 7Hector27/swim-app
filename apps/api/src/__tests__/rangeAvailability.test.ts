import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import pino from "pino";

// ── IDs ───────────────────────────────────────────────────────────────────────

const PROFILE_PARENT_ID  = "aa000001-0000-0000-0000-000000000001";
const PROFILE_COACH_ID   = "aa000001-0000-0000-0000-000000000002";
const HOUSEHOLD_A_ID     = "ff000001-0000-0000-0000-000000000010";
const HOUSEHOLD_B_ID     = "ff000001-0000-0000-0000-000000000011";
const LOCATION_PUBLIC_ID = "cc000001-0000-0000-0000-000000000001";
const LOCATION_HOME_A_ID = "cc000001-0000-0000-0000-000000000002";
const LOCATION_HOME_B_ID = "cc000001-0000-0000-0000-000000000003";
const OWN_LESSON_ID      = "dd000001-0000-0000-0000-000000000001";
const OTHER_LESSON_ID    = "dd000001-0000-0000-0000-000000000002";

// Frozen clock: Mon 2026-11-02 at noon PST = 20:00 UTC.
const ANCHOR_NOW = new Date("2026-11-02T20:00:00.000Z");

const now = ANCHOR_NOW;

// ── Fixed test dates relative to ANCHOR_NOW ───────────────────────────────────

// Mon 2026-11-23 — 3 weeks from ANCHOR, within the 10-week booking window.
const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;
const TEST_DATE = new Date(ANCHOR_NOW.getTime() + THREE_WEEKS_MS).toISOString().slice(0, 10);

// Mon 2027-03-22 — ~20 weeks from ANCHOR, beyond the 10-week max advance.
const FAR_FUTURE_DATE = new Date(ANCHOR_NOW.getTime() + 140 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

// A past Monday that is always in the past.
const PAST_DATE = "2020-01-06";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockClassifySlots,
  mockNeedsApproval,
} = vi.hoisted(() => ({
  mockGetUser:      vi.fn(),
  mockDbSelect:     vi.fn(),
  mockClassifySlots: vi.fn(),
  mockNeedsApproval: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("../lib/slots", async () => {
  const actual = await vi.importActual<typeof import("../lib/slots")>("../lib/slots");
  return { ...actual, classifyDaySlots: mockClassifySlots };
});

vi.mock("../lib/lessonApproval", () => ({
  needsApproval:         mockNeedsApproval,
  notifyBookingCreated:  vi.fn(),
  notifyLessonApproved:  vi.fn(),
  notifyLessonDeclined:  vi.fn(),
  notifyCoachOfChange:   vi.fn(),
  chargeLessonComplete:  vi.fn(),
  syncCalendarApproved:  vi.fn(),
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const parentProfile = {
  id: PROFILE_PARENT_ID,
  role: "parent" as const,
  fullName: "Test Parent",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const coachProfile = {
  id: PROFILE_COACH_ID,
  role: "coach" as const,
  fullName: "Test Coach",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const publicLocation = {
  id: LOCATION_PUBLIC_ID,
  householdId: null as string | null,
  isActive: true,
};

const homeLocationA = {
  id: LOCATION_HOME_A_ID,
  householdId: HOUSEHOLD_A_ID,
  isActive: true,
};

const homeLocationB = {
  id: LOCATION_HOME_B_ID,
  householdId: HOUSEHOLD_B_ID,
  isActive: true,
};

const configRow = {
  id: "cfg-range-01",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00:00",
  defaultEndTime: "20:00:00",
};

// School-year season covering Mon–Fri with 16:30 start, 19:30 end LA time.
// Dates in the past so it always applies for ANCHOR_NOW onward.
const schoolYearSeason = {
  id: "season-sy-01",
  name: "School year",
  startDate: "2020-01-01",
  endDate: "2099-12-31",
  teachesDays: [1, 2, 3, 4, 5],
  weekdayStartTime: "16:30" as string | null,
  weekdayEndTime: "19:30" as string | null,
  weekendStartTime: null as string | null,
  weekendEndTime: null as string | null,
  startsAtDst: false,
  createdAt: now,
  updatedAt: now,
};

const availableSlot = {
  startsAt: "2025-09-16T23:30:00.000Z",
  state: "available" as const,
};

const unavailableSlot = {
  startsAt: "2025-09-16T23:45:00.000Z",
  state: "unavailable" as const,
};

type AnyProfile = { id: string; role: string; [key: string]: unknown };

// ── Mock helpers ──────────────────────────────────────────────────────────────

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

function locationSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function householdSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function configSelect(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ limit }) };
}

function directFromSelect(rows: unknown[]) {
  return { from: vi.fn().mockResolvedValue(rows) };
}

function whereFromSelect(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// Sets up the sequential db.select() calls for a parent caller on a public location.
function setupParentSelects(opts: {
  profile?: AnyProfile;
  locationRows?: unknown[];
  memberRows?: unknown[];
  configRows?: unknown[];
  lessonRows?: unknown[];
  seasonRows?: unknown[];
  overrideRows?: unknown[];
} = {}) {
  const {
    profile      = parentProfile,
    locationRows = [publicLocation],
    memberRows   = [{ householdId: HOUSEHOLD_A_ID }],
    configRows   = [configRow],
    lessonRows   = [],
    seasonRows   = [schoolYearSeason],
    overrideRows = [],
  } = opts;

  mockDbSelect
    .mockReturnValueOnce(requireUserSelect(profile))           // 1: requireUser
    .mockReturnValueOnce(locationSelect(locationRows))          // 2: location check
    .mockReturnValueOnce(householdSelect(memberRows))           // 3: household member
    .mockReturnValueOnce(configSelect(configRows))              // 4: availabilityConfig
    .mockReturnValueOnce(directFromSelect([]))                  // 5: blockedTimes
    .mockReturnValueOnce(directFromSelect([]))                  // 6: travelBufferOverrides
    .mockReturnValueOnce(whereFromSelect(lessonRows))           // 7: existing lessons
    .mockReturnValueOnce(directFromSelect(seasonRows))          // 8: availabilitySeasons
    .mockReturnValueOnce(directFromSelect(overrideRows));       // 9: availabilityOverrides
}

// Sets up db.select() calls for a coach caller (no household step).
function setupCoachSelects(opts: {
  locationRows?: unknown[];
  configRows?: unknown[];
  lessonRows?: unknown[];
  seasonRows?: unknown[];
  overrideRows?: unknown[];
} = {}) {
  const {
    locationRows = [publicLocation],
    configRows   = [configRow],
    lessonRows   = [],
    seasonRows   = [schoolYearSeason],
    overrideRows = [],
  } = opts;

  mockDbSelect
    .mockReturnValueOnce(requireUserSelect(coachProfile))       // 1: requireUser
    .mockReturnValueOnce(locationSelect(locationRows))           // 2: location check
    // no household step for coach
    .mockReturnValueOnce(configSelect(configRows))               // 3: availabilityConfig
    .mockReturnValueOnce(directFromSelect([]))                   // 4: blockedTimes
    .mockReturnValueOnce(directFromSelect([]))                   // 5: travelBufferOverrides
    .mockReturnValueOnce(whereFromSelect(lessonRows))            // 6: existing lessons
    .mockReturnValueOnce(directFromSelect(seasonRows))           // 7: availabilitySeasons
    .mockReturnValueOnce(directFromSelect(overrideRows));        // 8: availabilityOverrides
}

// Base query string for the week view using TEST_DATE.
function weekQuery(extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    view: "week",
    date: TEST_DATE,
    durationMinutes: "30",
    locationId: LOCATION_PUBLIC_ID,
    ...extra,
  });
  return `/lessons/available-range?${p.toString()}`;
}

function monthQuery(extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    view: "month",
    date: TEST_DATE,
    durationMinutes: "30",
    locationId: LOCATION_PUBLIC_ID,
    ...extra,
  });
  return `/lessons/available-range?${p.toString()}`;
}

beforeAll(() => {
  vi.useFakeTimers({ now: ANCHOR_NOW });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetAllMocks();
  // Default: classifyDaySlots returns one available slot so route produces real output.
  mockClassifySlots.mockReturnValue([availableSlot]);
  mockNeedsApproval.mockResolvedValue(false);
});

// ── Auth / access guard tests ─────────────────────────────────────────────────

describe("GET /lessons/available-range — auth", () => {
  it("returns 401 when no Authorization header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "no token" } });
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app).get(weekQuery());
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller role is neither parent nor coach", async () => {
    const otherProfile = { ...parentProfile, role: "admin" };
    authAs(otherProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(otherProfile));

    const res = await request(app).get(weekQuery()).set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });
});

// ── Location access ───────────────────────────────────────────────────────────

describe("GET /lessons/available-range — location access", () => {
  it("returns 404 when location does not exist", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(locationSelect([])); // location not found

    const res = await request(app).get(weekQuery()).set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 404 when a home-pool location belongs to a different household", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(locationSelect([homeLocationB]))               // HOUSEHOLD_B location
      .mockReturnValueOnce(householdSelect([{ householdId: HOUSEHOLD_A_ID }])); // caller in A

    const q = new URLSearchParams({
      view: "week",
      date: TEST_DATE,
      durationMinutes: "30",
      locationId: LOCATION_HOME_B_ID,
    });
    const res = await request(app)
      .get(`/lessons/available-range?${q.toString()}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("parent can access their own home-pool location", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(locationSelect([homeLocationA]))               // caller's own pool
      .mockReturnValueOnce(householdSelect([{ householdId: HOUSEHOLD_A_ID }]))
      .mockReturnValueOnce(configSelect([configRow]))
      .mockReturnValueOnce(directFromSelect([]))
      .mockReturnValueOnce(directFromSelect([]))
      .mockReturnValueOnce(whereFromSelect([]))
      .mockReturnValueOnce(directFromSelect([schoolYearSeason]))
      .mockReturnValueOnce(directFromSelect([]));

    const q = new URLSearchParams({
      view: "week",
      date: TEST_DATE,
      durationMinutes: "30",
      locationId: LOCATION_HOME_A_ID,
    });
    const res = await request(app)
      .get(`/lessons/available-range?${q.toString()}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
  });

  it("coach can access any location regardless of householdId", async () => {
    authAs(coachProfile);
    setupCoachSelects({ locationRows: [homeLocationB] });

    const q = new URLSearchParams({
      view: "week",
      date: TEST_DATE,
      durationMinutes: "30",
      locationId: LOCATION_HOME_B_ID,
    });
    const res = await request(app)
      .get(`/lessons/available-range?${q.toString()}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
  });
});

// ── Week view shape ───────────────────────────────────────────────────────────

describe("GET /lessons/available-range — week view", () => {
  it("returns exactly 7 days, Monday through Sunday", async () => {
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);

    // First day must be a Monday (ISO weekday 1)
    const { getISODayOfWeek } = await import("../lib/slots");
    const firstDay: string = res.body.days[0].date;
    expect(getISODayOfWeek(firstDay)).toBe(1);

    // Last day must be a Sunday (ISO weekday 7)
    const lastDay: string = res.body.days[6].date;
    expect(getISODayOfWeek(lastDay)).toBe(7);
  });

  it("each day has a 'slots' array", async () => {
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    for (const day of res.body.days) {
      expect(Array.isArray(day.slots)).toBe(true);
    }
  });

  it("openCount for open days matches the number of 'available' slots", async () => {
    // Return 2 slots: one available, one unavailable
    mockClassifySlots.mockReturnValue([availableSlot, unavailableSlot]);
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const openDays = res.body.days.filter((d: { dayState: string }) => d.dayState === "open");
    for (const day of openDays) {
      const countFromSlots = (day.slots as { state: string }[]).filter((s) => s.state === "available").length;
      expect(day.openCount).toBe(countFromSlots);
    }
  });

  it("past day has dayState='past', openCount=0, and empty slots array", async () => {
    authAs(parentProfile);
    setupParentSelects();

    // Include PAST_DATE in the week query; the route computes day states using real Date.now()
    const res = await request(app)
      .get(weekQuery({ date: PAST_DATE }))
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    // Weekday (Mon–Fri) days are past; Sat/Sun are closed (not in lessonDays)
    const { getISODayOfWeek } = await import("../lib/slots");
    for (const day of res.body.days) {
      const iso = getISODayOfWeek(day.date);
      if (iso >= 1 && iso <= 5) {
        expect(day.dayState).toBe("past");
      } else {
        expect(day.dayState).toBe("closed");
      }
      expect(day.openCount).toBe(0);
      expect(day.slots).toHaveLength(0);
    }
    // classifyDaySlots should NOT have been called (no open days)
    expect(mockClassifySlots).not.toHaveBeenCalled();
  });

  it("closed day (Saturday — ISO 6, not in lessonDays [1-5]) has dayState='closed'", async () => {
    authAs(parentProfile);
    setupParentSelects();

    // 2025-03-15 is a Saturday — always in the past but usable to test closed logic.
    // Use a future Saturday: find the next Saturday after TEST_DATE.
    const testMs = new Date(TEST_DATE).getTime();
    const d = new Date(testMs);
    // getUTCDay(): 0=Sun,1=Mon,...,6=Sat
    const daysToSat = (6 - d.getUTCDay() + 7) % 7 || 7;
    const saturdayDate = new Date(testMs + daysToSat * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const res = await request(app)
      .get(weekQuery({ date: saturdayDate }))
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const satDay = res.body.days.find((d: { date: string }) => d.date === saturdayDate);
    expect(satDay?.dayState).toBe("closed");
    expect(satDay?.openCount).toBe(0);
    expect(satDay?.slots).toHaveLength(0);
  });

  it("not_open_yet day has dayState='not_open_yet' and empty slots array", async () => {
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery({ date: FAR_FUTURE_DATE }))
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    // All days in a week 20 weeks from now should be not_open_yet or closed
    for (const day of res.body.days) {
      expect(["not_open_yet", "closed"]).toContain(day.dayState);
      expect(day.openCount).toBe(0);
      expect(day.slots).toHaveLength(0);
    }
    expect(mockClassifySlots).not.toHaveBeenCalled();
  });
});

// ── Month view shape ──────────────────────────────────────────────────────────

describe("GET /lessons/available-range — month view", () => {
  it("returns between 28 and 42 days covering full Mon–Sun weeks", async () => {
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(monthQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const count: number = res.body.days.length;
    expect(count).toBeGreaterThanOrEqual(28);
    expect(count).toBeLessThanOrEqual(42);
    expect(count % 7).toBe(0); // always a whole number of weeks

    // First day is a Monday
    const { getISODayOfWeek } = await import("../lib/slots");
    expect(getISODayOfWeek(res.body.days[0].date)).toBe(1);
    // Last day is a Sunday
    expect(getISODayOfWeek(res.body.days[res.body.days.length - 1].date)).toBe(7);
  });

  it("no day in month view has a 'slots' key", async () => {
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(monthQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    for (const day of res.body.days) {
      expect(day).not.toHaveProperty("slots");
    }
  });
});

// ── needsApproval ─────────────────────────────────────────────────────────────

describe("GET /lessons/available-range — needsApproval", () => {
  it("returns needsApproval=true when the household has no prior approved lessons", async () => {
    mockNeedsApproval.mockResolvedValue(true);
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.needsApproval).toBe(true);
  });

  it("returns needsApproval=false when the household has an approved lesson at this pool", async () => {
    mockNeedsApproval.mockResolvedValue(false);
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.needsApproval).toBe(false);
  });

  it("coach always gets needsApproval=false (no household context)", async () => {
    authAs(coachProfile);
    setupCoachSelects();

    const res = await request(app)
      .get(weekQuery())
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.needsApproval).toBe(false);
    expect(mockNeedsApproval).not.toHaveBeenCalled();
  });
});

// ── excludeLessonId ───────────────────────────────────────────────────────────

describe("GET /lessons/available-range — excludeLessonId", () => {
  const ownLesson = {
    id: OWN_LESSON_ID,
    householdId: HOUSEHOLD_A_ID,
    startsAt: new Date(),
    durationMinutes: 30,
    locationId: LOCATION_PUBLIC_ID,
  };
  const otherLesson = {
    id: OTHER_LESSON_ID,
    householdId: HOUSEHOLD_B_ID,
    startsAt: new Date(),
    durationMinutes: 30,
    locationId: LOCATION_PUBLIC_ID,
  };

  it("excludes the lesson when it belongs to the caller's household", async () => {
    authAs(parentProfile);
    setupParentSelects({ lessonRows: [ownLesson] });

    await request(app)
      .get(weekQuery({ excludeLessonId: OWN_LESSON_ID }))
      .set("Authorization", "Bearer token");

    // classifyDaySlots should be called with existingLessons that does NOT include OWN_LESSON_ID
    const calls = mockClassifySlots.mock.calls;
    for (const [params] of calls) {
      // existingLessons should be empty (the only lesson was excluded)
      expect((params.existingLessons as unknown[]).length).toBe(0);
    }
  });

  it("silently ignores excludeLessonId that belongs to a different household", async () => {
    authAs(parentProfile);
    setupParentSelects({ lessonRows: [otherLesson] });

    await request(app)
      .get(weekQuery({ excludeLessonId: OTHER_LESSON_ID }))
      .set("Authorization", "Bearer token");

    // classifyDaySlots should be called WITH the other lesson still present
    const calls = mockClassifySlots.mock.calls;
    for (const [params] of calls) {
      expect((params.existingLessons as unknown[]).length).toBe(1);
    }
  });
});

// ── DST week ──────────────────────────────────────────────────────────────────

describe("GET /lessons/available-range — DST week", () => {
  it("week containing a fall-back day returns 7 days in correct Mon–Sun order", async () => {
    // 2025-11-02 is the US fall-back Sunday; its week is Mon 2025-10-27 → Sun 2025-11-02.
    // All days are in the past from today (Oct 2026+), so dayState will be 'past'.
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery({ date: "2025-11-02" }))
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[0].date).toBe("2025-10-27"); // Monday
    expect(res.body.days[6].date).toBe("2025-11-02"); // Sunday (fall-back day)
    // Weekday (Mon–Fri) days are past; Sat/Sun are closed (not in lessonDays)
    for (const day of res.body.days) {
      expect(["past", "closed"]).toContain(day.dayState);
    }
    // Mon–Fri specifically must be past
    const { getISODayOfWeek } = await import("../lib/slots");
    for (const day of res.body.days) {
      const iso = getISODayOfWeek(day.date);
      if (iso >= 1 && iso <= 5) expect(day.dayState).toBe("past");
    }
  });

  it("week containing a spring-forward day returns 7 days in correct Mon–Sun order", async () => {
    // 2025-03-09 is the US spring-forward Sunday; its week is Mon 2025-03-03 → Sun 2025-03-09.
    authAs(parentProfile);
    setupParentSelects();

    const res = await request(app)
      .get(weekQuery({ date: "2025-03-09" }))
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[0].date).toBe("2025-03-03"); // Monday
    expect(res.body.days[6].date).toBe("2025-03-09"); // Sunday (spring-forward day)
    // Weekday (Mon–Fri) days are past; Sat/Sun are closed (not in lessonDays)
    const { getISODayOfWeek } = await import("../lib/slots");
    for (const day of res.body.days) {
      const iso = getISODayOfWeek(day.date);
      if (iso >= 1 && iso <= 5) expect(day.dayState).toBe("past");
      else expect(day.dayState).toBe("closed");
    }
  });
});

// ── Query validation ──────────────────────────────────────────────────────────

describe("GET /lessons/available-range — validation", () => {
  it("returns 422 when view is missing", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const q = new URLSearchParams({
      date: TEST_DATE,
      durationMinutes: "30",
      locationId: LOCATION_PUBLIC_ID,
    });
    const res = await request(app)
      .get(`/lessons/available-range?${q.toString()}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
  });

  it("returns 422 when durationMinutes is not 30, 45, or 60", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const q = new URLSearchParams({
      view: "week",
      date: TEST_DATE,
      durationMinutes: "20",
      locationId: LOCATION_PUBLIC_ID,
    });
    const res = await request(app)
      .get(`/lessons/available-range?${q.toString()}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
  });
});
