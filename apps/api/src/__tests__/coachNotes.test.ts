import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const PROFILE_COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_COACH2_ID = "aaaaaaaa-0000-0000-0000-000000000008";
const PROFILE_PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_A_ID = "cccccccc-0000-0000-0000-000000000003";
const SESSION_ID = "dddddddd-0000-0000-0000-000000000004";
const SKILL_ID = "eeeeeeee-0000-0000-0000-000000000005";
const NOTE_ID = "ffffffff-0000-0000-0000-000000000006";
const RATING_ID = "11111111-0000-0000-0000-000000000007";
const LESSON_ID = "22222222-0000-0000-0000-000000000009";

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
  db: { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate, delete: mockDbDelete },
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

const profileCoach2 = {
  id: PROFILE_COACH2_ID,
  role: "coach" as const,
  fullName: "Coach2",
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

// ── POST helpers ──────────────────────────────────────────────────────────────

function setupInsert(rows: object[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const values = vi.fn().mockReturnValue({ returning });
  mockDbInsert.mockReturnValue({ values });
}

function setupUpdate() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  mockDbUpdate.mockReturnValue({ set });
}

function setupDelete() {
  const where = vi.fn().mockResolvedValue([]);
  mockDbDelete.mockReturnValue({ where });
}

function sessionExistsSelect(found: boolean, swimmerId = SWIMMER_A_ID) {
  const limit = vi.fn().mockResolvedValue(
    found ? [{ id: SESSION_ID, swimmerId }] : [],
  );
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function lessonLinkSelect(found: boolean) {
  const limit = vi.fn().mockResolvedValue(
    found ? [{ lessonId: LESSON_ID }] : [],
  );
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function noteByIdSelect(found: boolean, createdBy = PROFILE_COACH_ID) {
  const limit = vi.fn().mockResolvedValue(
    found ? [{ id: NOTE_ID, swimmerId: SWIMMER_A_ID, createdBy }] : [],
  );
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

// ── POST /coach/swimmers/:id/notes ────────────────────────────────────────────

describe("POST /coach/swimmers/:id/notes — auth", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .send({ body: "Note" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for parent role", async () => {
    authAs(profileParent);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileParent));
    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note" });
    expect(res.status).toBe(403);
  });
});

describe("POST /coach/swimmers/:id/notes — 201 standalone", () => {
  it("creates a standalone note and returns 201 with id + createdAt", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(true));
    setupInsert([{ id: NOTE_ID, createdAt: t1 }]);

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Great effort" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: NOTE_ID });
  });
});

describe("POST /coach/swimmers/:id/notes — 404", () => {
  it("returns 404 when swimmer does not exist", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(false));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note" });

    expect(res.status).toBe(404);
  });

  it("returns 404 when swimmer is archived", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(false));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note" });

    expect(res.status).toBe(404);
  });
});

describe("POST /coach/swimmers/:id/notes — session mismatch", () => {
  it("returns 422 session_swimmer_mismatch when session belongs to different swimmer", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(sessionExistsSelect(true, "00000000-dead-beef-0000-000000000000"));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note", sessionId: SESSION_ID });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("session_swimmer_mismatch");
  });

  it("returns 422 session_swimmer_mismatch when session not found", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(sessionExistsSelect(false));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note", sessionId: SESSION_ID });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("session_swimmer_mismatch");
  });
});

describe("POST /coach/swimmers/:id/notes — lesson mismatch", () => {
  it("returns 422 lesson_swimmer_mismatch when swimmer not in lesson", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(lessonLinkSelect(false));

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note", lessonId: LESSON_ID });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("lesson_swimmer_mismatch");
  });

  it("creates note when swimmer is in lesson", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(lessonLinkSelect(true));
    setupInsert([{ id: NOTE_ID, createdAt: t1 }]);

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Note", lessonId: LESSON_ID });

    expect(res.status).toBe(201);
  });
});

describe("POST /coach/swimmers/:id/notes — valid sessionId", () => {
  it("creates note tied to session", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerExistsSelect(true))
      .mockReturnValueOnce(sessionExistsSelect(true, SWIMMER_A_ID));
    setupInsert([{ id: NOTE_ID, createdAt: t1 }]);

    const res = await request(app)
      .post(`/coach/swimmers/${SWIMMER_A_ID}/notes`)
      .set("Authorization", "Bearer token")
      .send({ body: "Session note", sessionId: SESSION_ID });

    expect(res.status).toBe(201);
  });
});

// ── PATCH /coach/swimmers/:id/notes/:noteId ───────────────────────────────────

describe("PATCH /coach/swimmers/:id/notes/:noteId", () => {
  it("returns 200 when author updates note", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(noteByIdSelect(true, PROFILE_COACH_ID));
    setupUpdate();

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token")
      .send({ body: "Updated note" });

    expect(res.status).toBe(200);
  });

  it("returns 403 when another coach tries to update", async () => {
    authAs(profileCoach2);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach2))
      .mockReturnValueOnce(noteByIdSelect(true, PROFILE_COACH_ID));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token")
      .send({ body: "Updated" });

    expect(res.status).toBe(403);
  });

  it("returns 422 for blank body", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token")
      .send({ body: "" });

    expect(res.status).toBe(422);
  });

  it("returns 404 when note belongs to different swimmer", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(noteByIdSelect(false));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token")
      .send({ body: "Updated" });

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .send({ body: "Updated" });
    expect(res.status).toBe(401);
  });
});

// ── DELETE /coach/swimmers/:id/notes/:noteId ──────────────────────────────────

describe("DELETE /coach/swimmers/:id/notes/:noteId", () => {
  it("returns 204 when author deletes note", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(noteByIdSelect(true, PROFILE_COACH_ID));
    setupDelete();

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });

  it("returns 403 when another coach tries to delete", async () => {
    authAs(profileCoach2);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach2))
      .mockReturnValueOnce(noteByIdSelect(true, PROFILE_COACH_ID));

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when note belongs to different swimmer", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(noteByIdSelect(false));

    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app)
      .delete(`/coach/swimmers/${SWIMMER_A_ID}/notes/${NOTE_ID}`);
    expect(res.status).toBe(401);
  });
});
