import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const PROFILE_COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_A_ID = "cccccccc-0000-0000-0000-000000000003";
const SESSION_ID = "dddddddd-0000-0000-0000-000000000004";
const SKILL_ID = "eeeeeeee-0000-0000-0000-000000000005";
const NOTE_ID = "ffffffff-0000-0000-0000-000000000006";
const RATING_ID = "11111111-0000-0000-0000-000000000007";

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

const t1 = new Date("2025-01-10T12:00:00.000Z");
const t2 = new Date("2025-01-05T12:00:00.000Z");
const t3 = new Date("2025-01-01T12:00:00.000Z");

const profileCoach = {
  id: PROFILE_COACH_ID,
  role: "coach" as const,
  fullName: "Coach",
  phone: null,
  ageAttestedAt: t1,
  disabledAt: null,
  createdAt: t1,
  updatedAt: t1,
};

const profileParent = {
  id: PROFILE_PARENT_ID,
  role: "parent" as const,
  fullName: "Parent",
  phone: null,
  ageAttestedAt: t1,
  disabledAt: null,
  createdAt: t1,
  updatedAt: t1,
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
  const limit = vi.fn().mockResolvedValue(found ? [{ id: SWIMMER_A_ID }] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function notesSelect(rows: object[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function ratingNotesSelect(rows: object[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function sessionsSelect(rows: object[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function setupTimeline(
  options: {
    swimmerFound?: boolean;
    notes?: object[];
    ratingNotes?: object[];
    sessions?: object[];
  } = {},
) {
  const {
    swimmerFound = true,
    notes = [],
    ratingNotes = [],
    sessions = [],
  } = options;

  mockDbSelect
    .mockReturnValueOnce(requireUserSelect(profileCoach))
    .mockReturnValueOnce(swimmerExistsSelect(swimmerFound));

  if (swimmerFound) {
    mockDbSelect
      .mockReturnValueOnce(notesSelect(notes))
      .mockReturnValueOnce(ratingNotesSelect(ratingNotes))
      .mockReturnValueOnce(sessionsSelect(sessions));
  }
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Auth guards ───────────────────────────────────────────────────────────────

describe("GET /coach/swimmers/:id/timeline — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app).get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for parent role", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("GET /coach/swimmers/:id/timeline — validation", () => {
  it("returns 422 for non-UUID id", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));
    const res = await request(app)
      .get("/coach/swimmers/not-a-uuid/timeline")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });
});

// ── 404 cases ─────────────────────────────────────────────────────────────────

describe("GET /coach/swimmers/:id/timeline — 404", () => {
  it("returns 404 when swimmer does not exist", async () => {
    authAs(profileCoach);
    setupTimeline({ swimmerFound: false });
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 404 when swimmer is archived (isActiveSwimmer filter excludes them)", async () => {
    authAs(profileCoach);
    setupTimeline({ swimmerFound: false });
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });
});

// ── Timeline content ──────────────────────────────────────────────────────────

describe("GET /coach/swimmers/:id/timeline — content", () => {
  it("returns empty array when swimmer has no timeline entries", async () => {
    authAs(profileCoach);
    setupTimeline();
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns items from all three sources merged and sorted newest first", async () => {
    authAs(profileCoach);
    setupTimeline({
      notes: [{ id: NOTE_ID, body: "Great effort", sessionId: null, lessonId: null, createdAt: t1 }],
      ratingNotes: [{ id: RATING_ID, note: "Good arm pull", sessionId: SESSION_ID, skillId: SKILL_ID, createdAt: t2 }],
      sessions: [{ id: SESSION_ID, coachingPriority: "Work on turns", createdAt: t3 }],
    });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    expect(res.body[0]).toMatchObject({ type: "note", id: NOTE_ID, body: "Great effort" });
    expect(res.body[1]).toMatchObject({ type: "rating_note", id: RATING_ID, body: "Good arm pull" });
    expect(res.body[2]).toMatchObject({ type: "coaching_priority", id: SESSION_ID, body: "Work on turns" });
  });

  it("excludes voided skill ratings (query filters them server-side; none returned in mock)", async () => {
    authAs(profileCoach);
    setupTimeline({
      ratingNotes: [],
      sessions: [{ id: SESSION_ID, coachingPriority: "Turns", createdAt: t1 }],
    });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.every((item: { type: string }) => item.type !== "rating_note")).toBe(true);
  });

  it("excludes skill ratings whose note is null (not returned by mock)", async () => {
    authAs(profileCoach);
    setupTimeline({ ratingNotes: [] });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.every((item: { type: string }) => item.type !== "rating_note")).toBe(true);
  });

  it("sets tiedTo on rating_note with sessionId and skillId", async () => {
    authAs(profileCoach);
    setupTimeline({
      ratingNotes: [{ id: RATING_ID, note: "Note", sessionId: SESSION_ID, skillId: SKILL_ID, createdAt: t1 }],
    });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body[0].tiedTo).toMatchObject({ sessionId: SESSION_ID, skillId: SKILL_ID });
  });

  it("omits tiedTo on standalone note (no sessionId or lessonId)", async () => {
    authAs(profileCoach);
    setupTimeline({
      notes: [{ id: NOTE_ID, body: "Standalone", sessionId: null, lessonId: null, createdAt: t1 }],
    });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body[0].tiedTo).toBeUndefined();
  });

  it("sets tiedTo.sessionId on coaching_priority", async () => {
    authAs(profileCoach);
    setupTimeline({
      sessions: [{ id: SESSION_ID, coachingPriority: "Focus on kick", createdAt: t1 }],
    });

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}/timeline`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body[0].tiedTo).toMatchObject({ sessionId: SESSION_ID });
  });
});
