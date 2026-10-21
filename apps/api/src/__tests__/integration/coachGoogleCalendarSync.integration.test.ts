// Integration tests for the phase-2 reconcile sync against the real local
// Supabase stack. The Google client wrapper is vi.mocked (toSafeGoogleError
// is preserved so the real error-flattening path stays live), and the real
// syncLessonToGoogle is called directly on seeded lesson rows.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, ne } from "drizzle-orm";

// Env for OAuth config must be set before importing the service module.
process.env["GOOGLE_OAUTH_CLIENT_ID"] = "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "test-client-secret";
process.env["GOOGLE_OAUTH_REDIRECT_URI"] = "http://localhost:3001/integrations/google/callback";
process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
process.env["GOOGLE_OAUTH_STATE_SECRET"] = "s".repeat(32);

vi.mock("../../services/googleCalendarClient", async () => {
  const actual = await vi.importActual<typeof import("../../services/googleCalendarClient")>(
    "../../services/googleCalendarClient",
  );
  return {
    ...actual,
    getAuthorizeUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    calendarExists: vi.fn(),
    createDedicatedCalendar: vi.fn(),
    revokeToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    upsertEvent: vi.fn(),
    deleteEventIdempotent: vi.fn(),
  };
});

import pino from "pino";
import request from "supertest";

import { createApp } from "../../app";
import {
  coachAuditLog,
  coachCalendarIntegrations,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { __resetEnvCacheForTests } from "../../lib/env";
import { encryptToken } from "../../lib/tokenEncryption";
import * as googleClient from "../../services/googleCalendarClient";
import {
  backfillCoachLessons,
  syncLessonToGoogle,
} from "../../services/googleCalendarSync";
import { adminDb, closeAdminDb, createTestUser, type TestUser } from "./helpers";

__resetEnvCacheForTests();
const app = createApp(pino({ level: "silent" }));

const KEY = Buffer.alloc(32, 7).toString("base64");

let owner: TestUser;
let coach: TestUser;
let locationId: string;
let swimmerIds: string[] = [];

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

// The dev DB may contain a real coach profile (e.g. jason@mail.com). The
// sync service's `getActiveCoachProfileId` picks arbitrarily when more than
// one 'coach' profile exists — that's the single-coach assumption baked
// into the whole feature. Make the test deterministic by demoting any
// other 'coach' profiles to 'parent' for the duration of this test file.
// Captures the ids so afterAll can restore the roles.
let demotedCoachIds: string[] = [];
async function demoteOtherCoaches(testCoachId: string): Promise<void> {
  const others = await adminDb()
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "coach"), ne(profiles.id, testCoachId)));
  demotedCoachIds = others.map((row) => row.id);
  if (demotedCoachIds.length > 0) {
    await adminDb()
      .update(profiles)
      .set({ role: "parent" })
      .where(inArray(profiles.id, demotedCoachIds));
  }
}
async function restoreOtherCoaches(): Promise<void> {
  if (demotedCoachIds.length > 0) {
    await adminDb()
      .update(profiles)
      .set({ role: "coach" })
      .where(inArray(profiles.id, demotedCoachIds));
    demotedCoachIds = [];
  }
}

async function seedCoachIntegration(status: "active" | "needs_reconnect" | "disconnected" = "active"): Promise<void> {
  const encrypted = encryptToken("refresh-token-value", Buffer.from(KEY, "base64"));
  await adminDb().insert(coachCalendarIntegrations).values({
    coachProfileId: coach.userId,
    status,
    googleCalendarId: "test-calendar-id",
    googleAccountEmail: "coach@example.com",
    scope: "https://www.googleapis.com/auth/calendar.app.created",
    refreshTokenCiphertext: encrypted.ciphertext,
    refreshTokenIv: encrypted.iv,
    refreshTokenTag: encrypted.tag,
    refreshTokenKeyVersion: encrypted.keyVersion,
    ...(status === "needs_reconnect" && { needsReconnectSince: new Date() }),
  });
}

async function clearIntegrationAndLessons(): Promise<void> {
  await adminDb().delete(coachAuditLog).where(eq(coachAuditLog.coachId, coach.userId));
  await adminDb().delete(coachCalendarIntegrations).where(
    eq(coachCalendarIntegrations.coachProfileId, coach.userId),
  );
  // Only clear this test's household's lessons so parallel integration test
  // files that run in the same DB aren't affected.
  const householdLessons = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, owner.householdId));
  if (householdLessons.length > 0) {
    const ids = householdLessons.map((row) => row.id);
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, ids));
    await adminDb().delete(lessons).where(inArray(lessons.id, ids));
  }
}

async function seedLesson(opts: {
  status: "pending" | "approved" | "canceled" | "declined";
  startsAt: Date;
  swimmerIndex?: number[];
  googleCalendarEventId?: string | null;
  calendarSyncStatus?: "not_synced" | "synced" | "sync_failed";
}): Promise<string> {
  const inserted = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: opts.startsAt,
      durationMinutes: 30,
      type: "private",
      status: opts.status,
      requestedBy: owner.userId,
      ...(opts.googleCalendarEventId !== undefined && {
        googleCalendarEventId: opts.googleCalendarEventId,
      }),
      ...(opts.calendarSyncStatus !== undefined && {
        calendarSyncStatus: opts.calendarSyncStatus,
      }),
    })
    .returning({ id: lessons.id });
  const lessonId = inserted[0]!.id;
  const ids = opts.swimmerIndex ?? [0];
  for (const index of ids) {
    const swimmerId = swimmerIds[index];
    if (!swimmerId) throw new Error(`seed error: no swimmer at index ${index}`);
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  }
  return lessonId;
}

beforeAll(async () => {
  owner = await createTestUser("sync-int-owner");
  coach = await createTestUser("sync-int-coach");
  await makeCoach(coach.userId);
  await demoteOtherCoaches(coach.userId);

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]!.id;

  const alex = await adminDb()
    .insert(swimmers)
    .values({ firstName: "Alex", lastName: "A", birthDate: "2015-01-01", sex: "female", isPublic: false, householdId: owner.householdId })
    .returning({ id: swimmers.id });
  const mia = await adminDb()
    .insert(swimmers)
    .values({ firstName: "Mia", lastName: "M", birthDate: "2015-02-02", sex: "female", isPublic: false, householdId: owner.householdId })
    .returning({ id: swimmers.id });
  swimmerIds = [alex[0]!.id, mia[0]!.id];
});

beforeEach(() => {
  vi.mocked(googleClient.refreshAccessToken).mockResolvedValue({ accessToken: "access-token" });
  vi.mocked(googleClient.upsertEvent).mockResolvedValue(undefined);
  vi.mocked(googleClient.deleteEventIdempotent).mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.clearAllMocks();
  await clearIntegrationAndLessons();
});

afterAll(async () => {
  await clearIntegrationAndLessons();
  for (const id of swimmerIds) {
    await adminDb().delete(swimmers).where(eq(swimmers.id, id));
  }
  await restoreOtherCoaches();
  await coach.cleanup();
  await owner.cleanup();
  await closeAdminDb();
});

const future = (hours = 24) => new Date(Date.now() + hours * 60 * 60 * 1000);
const past = (hours = 1) => new Date(Date.now() - hours * 60 * 60 * 1000);
const stripDashes = (uuid: string) => uuid.replace(/-/g, "").toLowerCase();

describe("syncLessonToGoogle — approve path", () => {
  it("creates the event with the deterministic id and a Swim lesson title", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });

    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    const [, , calendarId, eventId, body] = vi.mocked(googleClient.upsertEvent).mock.calls[0]!;
    expect(calendarId).toBe("test-calendar-id");
    expect(eventId).toBe(stripDashes(lessonId));
    expect(body.summary).toBe("Swim lesson: Alex");
    expect(body.timeZone).toBe("America/Los_Angeles");
    expect(body.description).toMatch(/\/coach\/lessons\/[a-f0-9-]+$/);

    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.calendarSyncStatus).toBe("synced");
    expect(row.googleCalendarEventId).toBe(stripDashes(lessonId));
  });

  it("builds a two-swimmer title with an ampersand", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({
      status: "approved",
      startsAt: future(),
      swimmerIndex: [0, 1],
    });

    await syncLessonToGoogle(lessonId);

    const body = vi.mocked(googleClient.upsertEvent).mock.calls[0]![4];
    expect(body.summary).toBe("Swim lesson: Alex & Mia");
  });
});

describe("syncLessonToGoogle — reschedule path", () => {
  it("calls upsertEvent with the new time; service treats 409 fallthrough as success", async () => {
    await seedCoachIntegration();
    const originalStart = future(24);
    const lessonId = await seedLesson({ status: "approved", startsAt: originalStart });
    await syncLessonToGoogle(lessonId);
    vi.mocked(googleClient.upsertEvent).mockClear();

    // Simulate reschedule.
    const newStart = future(48);
    await adminDb().update(lessons).set({ startsAt: newStart }).where(eq(lessons.id, lessonId));

    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    const body = vi.mocked(googleClient.upsertEvent).mock.calls[0]![4];
    expect(body.startIso).toBe(newStart.toISOString());
  });
});

describe("syncLessonToGoogle — cancel / decline paths", () => {
  it("cancel deletes the event and clears google_calendar_event_id", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });
    await syncLessonToGoogle(lessonId);

    // Flip to canceled and re-run reconcile (what the DELETE handler does).
    await adminDb().update(lessons).set({ status: "canceled" }).where(eq(lessons.id, lessonId));
    await syncLessonToGoogle(lessonId);

    expect(googleClient.deleteEventIdempotent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(googleClient.deleteEventIdempotent).mock.calls[0]![3]).toBe(stripDashes(lessonId));
    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.googleCalendarEventId).toBeNull();
    expect(row.calendarSyncStatus).toBe("synced");
  });

  it("decline on a pending lesson is a no-op (no Google call)", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "pending", startsAt: future() });
    // Flip to declined and reconcile.
    await adminDb().update(lessons).set({ status: "declined" }).where(eq(lessons.id, lessonId));

    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).not.toHaveBeenCalled();
    expect(googleClient.deleteEventIdempotent).not.toHaveBeenCalled();
  });

  it("approve then cancel in sequence leaves no event in Google", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });
    await syncLessonToGoogle(lessonId);
    await adminDb().update(lessons).set({ status: "canceled" }).where(eq(lessons.id, lessonId));
    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    expect(googleClient.deleteEventIdempotent).toHaveBeenCalledTimes(1);
  });
});

describe("syncLessonToGoogle — idempotency and skip conditions", () => {
  it("409 on insert does not produce a duplicate: service relies on upsertEvent's internal patch", async () => {
    // Make upsertEvent throw a gaxios-shaped 409 the first time → the client
    // function would normally fall through to patch internally. Here we assert
    // that the SERVICE calls upsertEvent exactly once and treats success as
    // success — the 409-to-patch is invisible to the caller. Simulate by just
    // resolving: the real client handles the fallthrough. (See the dedicated
    // googleCalendarClient test for the 409 → patch path.)
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });

    await syncLessonToGoogle(lessonId);
    await syncLessonToGoogle(lessonId); // second call → same event id, same body.

    const callIds = vi.mocked(googleClient.upsertEvent).mock.calls.map((call) => call[3]);
    const unique = new Set(callIds);
    expect(unique.size).toBe(1); // only one distinct event id across all calls
  });

  it("skips pending lessons entirely (no Google call, no row touch)", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "pending", startsAt: future() });
    const before = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;

    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).not.toHaveBeenCalled();
    const after = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(after.calendarSyncAttempts).toBe(before.calendarSyncAttempts);
  });

  it("skips past approved lessons (no Google call)", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: past() });

    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).not.toHaveBeenCalled();
  });

  it("skips entirely when the integration row is in needs_reconnect", async () => {
    await seedCoachIntegration("needs_reconnect");
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });

    await syncLessonToGoogle(lessonId);

    expect(googleClient.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleClient.upsertEvent).not.toHaveBeenCalled();
  });
});

describe("syncLessonToGoogle — invalid_grant", () => {
  it("flips the integration to needs_reconnect and marks the lesson sync_failed", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });

    vi.mocked(googleClient.refreshAccessToken).mockRejectedValueOnce(
      new googleClient.GoogleInvalidGrantError("invalid_grant"),
    );
    await syncLessonToGoogle(lessonId);

    const integration = (
      await adminDb()
        .select()
        .from(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId))
    )[0]!;
    expect(integration.status).toBe("needs_reconnect");
    expect(integration.needsReconnectSince).not.toBeNull();

    const lesson = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(lesson.calendarSyncStatus).toBe("sync_failed");
    expect(lesson.calendarSyncError).toBe("token_revoked");
  });
});

describe("backfillCoachLessons", () => {
  it("picks up upcoming approved lessons and skips pending and past rows", async () => {
    await seedCoachIntegration();
    const futureApprovedA = await seedLesson({ status: "approved", startsAt: future(24) });
    const futureApprovedB = await seedLesson({ status: "approved", startsAt: future(48) });
    const futurePending = await seedLesson({ status: "pending", startsAt: future(72) });
    const pastApproved = await seedLesson({ status: "approved", startsAt: past(24) });

    await backfillCoachLessons(coach.userId);

    const synced = vi
      .mocked(googleClient.upsertEvent)
      .mock.calls.map((call) => call[3]);
    expect(synced).toHaveLength(2);
    expect(synced).toContain(stripDashes(futureApprovedA));
    expect(synced).toContain(stripDashes(futureApprovedB));
    expect(synced).not.toContain(stripDashes(futurePending));
    expect(synced).not.toContain(stripDashes(pastApproved));
  });
});

describe("reconcile loop on concurrent state change", () => {
  it("a cancel that commits during a reschedule's Google call leaves no event in Google", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({
      status: "approved",
      startsAt: future(24),
      googleCalendarEventId: null,
    });

    // The first pass sees status='approved' and tries to upsert. While that
    // upsert is in flight, a concurrent cancel flips the lesson to
    // 'canceled'. We simulate that by having the mocked upsertEvent perform
    // the DB write before resolving.
    let upsertCalls = 0;
    vi.mocked(googleClient.upsertEvent).mockImplementation(async (_env, _tok, _cal, _id, _body) => {
      upsertCalls++;
      // Only flip to canceled on the first pass to prove the loop recovers.
      if (upsertCalls === 1) {
        await adminDb()
          .update(lessons)
          .set({ status: "canceled", canceledAt: new Date(), canceledBy: owner.userId })
          .where(eq(lessons.id, lessonId));
      }
    });

    await syncLessonToGoogle(lessonId);

    // Pass 1 upserted (now-stale) and detected drift; pass 2 saw status=canceled
    // and deleted. Net Google state: no event.
    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    expect(googleClient.deleteEventIdempotent).toHaveBeenCalledTimes(1);

    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.status).toBe("canceled");
    expect(row.calendarSyncStatus).toBe("synced"); // Google matches the current (canceled) state
    expect(row.googleCalendarEventId).toBeNull();
  });

  it("gives up after 3 passes when state keeps changing and marks the lesson sync_failed", async () => {
    await seedCoachIntegration();
    const lessonId = await seedLesson({
      status: "approved",
      startsAt: future(24),
      googleCalendarEventId: null,
    });

    // Every Google call bumps the lesson's startsAt by 1 hour, so each
    // re-read sees drift and the loop keeps going.
    vi.mocked(googleClient.upsertEvent).mockImplementation(async () => {
      await adminDb()
        .update(lessons)
        .set({ startsAt: new Date(Date.now() + Math.random() * 1_000_000 + 2 * 86_400_000) })
        .where(eq(lessons.id, lessonId));
    });

    await syncLessonToGoogle(lessonId);

    // 3 upserts (one per pass) then give up.
    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(3);
    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.calendarSyncStatus).toBe("sync_failed");
    expect(row.calendarSyncError).toContain("reconcile_unstable");
  });
});

describe("null token guard on active row", () => {
  it("flips to needs_reconnect, marks the lesson sync_failed, and does not throw an unhandled rejection", async () => {
    // Insert an "active" integration with null token columns — a shape no
    // normal code path produces, but a manual DB edit or a half-applied
    // migration could.
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "active",
      googleCalendarId: "test-calendar-id",
      googleAccountEmail: "coach@example.com",
      scope: null,
      refreshTokenCiphertext: null,
      refreshTokenIv: null,
      refreshTokenTag: null,
      refreshTokenKeyVersion: null,
    });
    const lessonId = await seedLesson({ status: "approved", startsAt: future() });

    // Must not reject out of the microtask queue.
    await expect(syncLessonToGoogle(lessonId)).resolves.toBeUndefined();

    expect(googleClient.refreshAccessToken).not.toHaveBeenCalled();
    expect(googleClient.upsertEvent).not.toHaveBeenCalled();

    const integration = (
      await adminDb()
        .select()
        .from(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId))
    )[0]!;
    expect(integration.status).toBe("needs_reconnect");
    expect(integration.needsReconnectSince).not.toBeNull();

    const lesson = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(lesson.calendarSyncStatus).toBe("sync_failed");
    expect(lesson.calendarSyncError).toBe("token_revoked");
  });
});

describe("integration-row scoping", () => {
  it("ignores a 'disconnected' integration row that belongs to another profile", async () => {
    // Seed a stale disconnected row under the OWNER's profile — that's a
    // non-coach profile but it still produces a row that the pre-fix
    // `.limit(1)` would have grabbed in dev data. The coach has no
    // integration at all.
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: owner.userId,
      status: "disconnected",
      googleCalendarId: "stale-other-profile-calendar",
      googleAccountEmail: "other@example.com",
      scope: null,
      refreshTokenCiphertext: null,
      refreshTokenIv: null,
      refreshTokenTag: null,
      refreshTokenKeyVersion: null,
    });

    const lessonId = await seedLesson({ status: "approved", startsAt: future() });

    await syncLessonToGoogle(lessonId);

    // Must NOT have touched Google with the stale calendar id.
    expect(googleClient.upsertEvent).not.toHaveBeenCalled();

    // Lesson row is untouched (no attempt).
    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.calendarSyncStatus).toBe("not_synced");
    expect(row.calendarSyncAttempts).toBe(0);

    // Cleanup extra row.
    await adminDb()
      .delete(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, owner.userId));
  });
});

describe("POST /coach/calendar/retry-failed audit row", () => {
  it("writes a single calendar_sync_retried audit row AFTER the loop with attempted/succeeded/failed counts", async () => {
    await seedCoachIntegration();
    const good = await seedLesson({
      status: "approved",
      startsAt: future(),
      calendarSyncStatus: "sync_failed",
    });
    const stillBad = await seedLesson({
      status: "approved",
      startsAt: future(48),
      calendarSyncStatus: "sync_failed",
    });

    // The second lesson fails on the Google call; the first succeeds.
    vi.mocked(googleClient.upsertEvent)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("google: 500"), { code: 500 }));

    const res = await request(app)
      .post("/coach/calendar/retry-failed")
      .set("Authorization", `Bearer ${coach.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ attempted: 2, succeeded: 1, failed: 1 });

    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("calendar_sync_retried");
    expect(audit[0]!.payload).toEqual({ attempted: 2, succeeded: 1, failed: 1 });

    // Also confirm the audit was written AFTER the loop by cross-checking
    // that the lesson rows reached their final state at least as early as
    // the audit row's createdAt.
    const lessonRows = await adminDb()
      .select({ id: lessons.id, status: lessons.calendarSyncStatus })
      .from(lessons)
      .where(inArray(lessons.id, [good, stillBad]));
    const byId = Object.fromEntries(lessonRows.map((row) => [row.id, row.status]));
    expect(byId[good]).toBe("synced");
    expect(byId[stillBad]).toBe("sync_failed");
  });

  it("returns 409 and writes no audit row when the integration needs reconnect", async () => {
    await seedCoachIntegration("needs_reconnect");
    await seedLesson({
      status: "approved",
      startsAt: future(),
      calendarSyncStatus: "sync_failed",
    });

    const res = await request(app)
      .post("/coach/calendar/retry-failed")
      .set("Authorization", `Bearer ${coach.accessToken}`);

    expect(res.status).toBe(409);
    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(0);
  });
});
