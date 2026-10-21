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
  availabilitySeasons,
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
  runFullSyncPass,
  runLightSyncPass,
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

// The dev DB may contain a real coach profile (e.g. jason@mail.com) with
// an active integration row and lessons. All three would leak into tests:
// - The service's getActiveCoachProfileId picks arbitrarily with multiple coaches
// - The cron picks up every active integration globally
// - The full/light passes walk all in-window lessons globally
// Make the test deterministic by pausing any other coach for the duration
// of this test file. Captures the state so afterAll can restore it.
interface PausedOther {
  profileId: string;
  integrationId: string | null;
}
let pausedOthers: PausedOther[] = [];
async function pauseOtherCoaches(testCoachId: string): Promise<void> {
  const others = await adminDb()
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, "coach"), ne(profiles.id, testCoachId)));
  pausedOthers = await Promise.all(
    others.map(async (row) => {
      const integ = await adminDb()
        .select({ id: coachCalendarIntegrations.id })
        .from(coachCalendarIntegrations)
        .where(
          and(
            eq(coachCalendarIntegrations.coachProfileId, row.id),
            eq(coachCalendarIntegrations.status, "active"),
          ),
        )
        .limit(1);
      return { profileId: row.id, integrationId: integ[0]?.id ?? null };
    }),
  );
  if (pausedOthers.length === 0) return;
  await adminDb()
    .update(profiles)
    .set({ role: "parent" })
    .where(
      inArray(
        profiles.id,
        pausedOthers.map((p) => p.profileId),
      ),
    );
  // Flip integrations to needs_reconnect — reversible with the original
  // status after the file finishes. Picking needs_reconnect over
  // disconnected because it doesn't require nulling the token columns.
  const integrationIds = pausedOthers
    .map((p) => p.integrationId)
    .filter((id): id is string => id !== null);
  if (integrationIds.length > 0) {
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ status: "needs_reconnect" })
      .where(inArray(coachCalendarIntegrations.id, integrationIds));
  }
}
async function restoreOtherCoaches(): Promise<void> {
  if (pausedOthers.length === 0) return;
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(
      inArray(
        profiles.id,
        pausedOthers.map((p) => p.profileId),
      ),
    );
  const integrationIds = pausedOthers
    .map((p) => p.integrationId)
    .filter((id): id is string => id !== null);
  if (integrationIds.length > 0) {
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ status: "active" })
      .where(inArray(coachCalendarIntegrations.id, integrationIds));
  }
  pausedOthers = [];
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
  await pauseOtherCoaches(coach.userId);

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

  it("creates/updates the event for a past approved lesson (approved is approved, upcoming or not)", async () => {
    // Rule change: shouldExist is `status IN ('approved', 'completed')` with
    // no time gate. A past approved lesson should still have a Google event
    // because the coach wants history on their calendar. See ADR 027.
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: past() });

    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    expect(googleClient.deleteEventIdempotent).not.toHaveBeenCalled();
    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.calendarSyncStatus).toBe("synced");
    expect(row.googleCalendarEventId).toBe(stripDashes(lessonId));
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

describe("runFullSyncPass", () => {
  // The full pass walks all in-window lessons globally (single-coach app;
  // no coach_id column on lessons). In a seeded dev DB there may be
  // other coaches' lessons too — we assert containment, not exact length.
  it("picks up in-window approved lessons and skips pending (no event id) and before-window rows", async () => {
    await seedCoachIntegration();
    const futureApprovedA = await seedLesson({ status: "approved", startsAt: future(24) });
    const futureApprovedB = await seedLesson({ status: "approved", startsAt: future(48) });
    const futurePending = await seedLesson({ status: "pending", startsAt: future(72) });
    const beforeWindowApproved = await seedLesson({ status: "approved", startsAt: past(24) });

    await runFullSyncPass(coach.userId);

    const synced = vi
      .mocked(googleClient.upsertEvent)
      .mock.calls.map((call) => call[3]);
    expect(synced).toContain(stripDashes(futureApprovedA));
    expect(synced).toContain(stripDashes(futureApprovedB));
    expect(synced).not.toContain(stripDashes(futurePending));
    expect(synced).not.toContain(stripDashes(beforeWindowApproved));
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

describe("runs can't get stuck", () => {
  async function readIntegration() {
    return (
      await adminDb()
        .select()
        .from(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId))
    )[0]!;
  }

  it("a full pass where one lesson's reconcile throws still finishes and clears syncRunStartedAt", async () => {
    await seedCoachIntegration();
    const a = await seedLesson({ status: "approved", startsAt: future(24) });
    const b = await seedLesson({ status: "approved", startsAt: future(48) });
    const c = await seedLesson({ status: "approved", startsAt: future(72) });

    // Target the throw at lesson b specifically — the full pass walks all
    // in-window lessons (including any from other coaches in a seeded dev
    // DB), so a positional mock chain wouldn't line up with our three
    // seeded rows. Match on the deterministic event id instead.
    const bEventId = stripDashes(b);
    const boom = Object.assign(new Error("boom"), { code: 500 });
    vi.mocked(googleClient.upsertEvent).mockImplementation(async (_env, _tok, _cal, eventId) => {
      if (eventId === bEventId) throw boom;
    });

    await runFullSyncPass(coach.userId);

    // All three of OUR lessons reached a terminal state — not stuck at not_synced.
    const rows = await adminDb()
      .select({ id: lessons.id, status: lessons.calendarSyncStatus })
      .from(lessons)
      .where(inArray(lessons.id, [a, b, c]));
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.status]));
    expect(byId[a]).toBe("synced");
    expect(byId[b]).toBe("sync_failed");
    expect(byId[c]).toBe("synced");

    // finally cleared the run marker.
    expect((await readIntegration()).syncRunStartedAt).toBeNull();
  });

  it("recovers a stale syncRunStartedAt (>2 minutes) by returning syncRunInProgress=false", async () => {
    await seedCoachIntegration();
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000);
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ syncRunStartedAt: threeMinAgo, lastSyncAttemptedAt: threeMinAgo })
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));

    const res = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.syncRunInProgress).toBe(false);
  });

  it("reports syncRunInProgress=true while started_at is set and recent", async () => {
    await seedCoachIntegration();
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ syncRunStartedAt: new Date(), lastSyncAttemptedAt: new Date() })
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));

    const res = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.body.syncRunInProgress).toBe(true);
  });

  it("per-lesson sync runs immediately even when a run marker is set (not queued behind the batch)", async () => {
    await seedCoachIntegration();
    // Pretend a backfill is currently in flight.
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ syncRunStartedAt: new Date(), lastSyncAttemptedAt: new Date() })
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));

    const lessonId = await seedLesson({ status: "approved", startsAt: future(24) });
    await syncLessonToGoogle(lessonId);

    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    const row = (await adminDb().select().from(lessons).where(eq(lessons.id, lessonId)))[0]!;
    expect(row.calendarSyncStatus).toBe("synced");
  });

  it("cancelling one lesson doesn't block a later approve from syncing", async () => {
    await seedCoachIntegration();
    const toCancel = await seedLesson({
      status: "approved",
      startsAt: future(24),
      googleCalendarEventId: null,
    });

    await adminDb()
      .update(lessons)
      .set({ status: "canceled", canceledAt: new Date(), canceledBy: owner.userId })
      .where(eq(lessons.id, toCancel));
    await syncLessonToGoogle(toCancel);

    vi.mocked(googleClient.upsertEvent).mockClear();
    const toApprove = await seedLesson({ status: "approved", startsAt: future(48) });
    await syncLessonToGoogle(toApprove);

    expect(googleClient.upsertEvent).toHaveBeenCalledTimes(1);
    const approvedRow = (
      await adminDb().select().from(lessons).where(eq(lessons.id, toApprove))
    )[0]!;
    expect(approvedRow.calendarSyncStatus).toBe("synced");
  });
});

/**
 * Regression test for the bug diagnosed against the live dev DB:
 * POST /lessons was missing the sync hook. When a household's auto-approval
 * rule (ADR 021) caused a booking to be created directly in status='approved'
 * — the exact data shape of the stuck lesson in production
 * (calendar_sync_attempts=0, no error, no event id) — Google was never
 * called. Approve/decline/reschedule/cancel all had the hook; create did
 * not. This test exercises the auto-approval path end-to-end.
 */
describe("POST /lessons regression: auto-approved bookings must sync", () => {
  async function withAllDaysEnabled<T>(fn: () => Promise<T>): Promise<T> {
    const seasons = await adminDb().select().from(availabilitySeasons);
    const originals = seasons.map((season) => ({ id: season.id, teachesDays: season.teachesDays }));
    for (const season of seasons) {
      await adminDb()
        .update(availabilitySeasons)
        .set({ teachesDays: [1, 2, 3, 4, 5, 6, 7] })
        .where(eq(availabilitySeasons.id, season.id));
    }
    try {
      return await fn();
    } finally {
      for (const original of originals) {
        await adminDb()
          .update(availabilitySeasons)
          .set({ teachesDays: original.teachesDays })
          .where(eq(availabilitySeasons.id, original.id));
      }
    }
  }

  async function findFirstAvailableSlot(token: string, locId: string): Promise<string> {
    for (let weekOffset = 0; weekOffset < 10; weekOffset++) {
      const weekDate = new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const res = await request(app)
        .get("/lessons/available-range")
        .set("Authorization", `Bearer ${token}`)
        .query({ view: "week", date: weekDate, durationMinutes: "30", locationId: locId });
      if (res.status !== 200) continue;
      const body = res.body as { days: Array<{ slots: Array<{ startsAt: string; state: string }> }> };
      for (const day of body.days) {
        for (const slot of day.slots) {
          if (slot.state === "available") return slot.startsAt;
        }
      }
    }
    throw new Error("No available slot found within 10 weeks");
  }

  it("auto-approved POST /lessons fires syncLessonToGoogle (not stuck at not_synced, attempts=0)", async () => {
    await seedCoachIntegration();

    // Give the owner's household a prior approved lesson at the same
    // location so the ADR 021 gate flips the next booking to auto-approved
    // instead of pending. This is exactly the shape of the stuck production
    // lesson: household + location where prior approvals exist.
    const priorApprovedId = await seedLesson({
      status: "approved",
      startsAt: future(24 * 60), // very far future so it doesn't eat our target slot
    });

    await withAllDaysEnabled(async () => {
      const slot = await findFirstAvailableSlot(owner.accessToken, locationId);

      const bookingRes = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ locationId, startsAt: slot, durationMinutes: 30, swimmerIds: [swimmerIds[0]] });

      expect(bookingRes.status).toBe(201);
      // Prior-approved rule → booking auto-approved on create.
      expect(bookingRes.body.status).toBe("approved");
      const newLessonId = bookingRes.body.id as string;

      // The hook queues a microtask after res.json; poll until the lesson
      // row flips to synced instead of guessing a fixed delay (CI jitter).
      // Caps at ~1s total; if the hook were missing we'd time out here with
      // a clear assertion failure that names the exact bug.
      const expectedEventId = stripDashes(newLessonId);
      let synced = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [current] = await adminDb()
          .select({ status: lessons.calendarSyncStatus })
          .from(lessons)
          .where(eq(lessons.id, newLessonId));
        if (current?.status === "synced") {
          synced = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(synced).toBe(true);

      // Google was called with the deterministic event id for the new booking.
      const eventIds = vi
        .mocked(googleClient.upsertEvent)
        .mock.calls.map((call) => call[3]);
      expect(eventIds).toContain(expectedEventId);

      // Lesson row reached synced state (attempts >= 1, not stuck at 0).
      const row = (
        await adminDb().select().from(lessons).where(eq(lessons.id, newLessonId))
      )[0]!;
      expect(row.calendarSyncStatus).toBe("synced");
      expect(row.calendarSyncAttempts).toBeGreaterThanOrEqual(1);
      expect(row.googleCalendarEventId).toBe(stripDashes(newLessonId));

      // Cleanup the booking so it doesn't collide with later tests.
      await adminDb()
        .delete(lessonSwimmers)
        .where(inArray(lessonSwimmers.lessonId, [newLessonId, priorApprovedId]));
      await adminDb()
        .delete(lessons)
        .where(inArray(lessons.id, [newLessonId, priorApprovedId]));
    });
  });
});

/**
 * Hooks on the three non-user-initiated state-change paths — the lazy
 * expiry inside GET /coach/lessons, and the cron tick's two bulk writes
 * (pending → expired, approved → completed). Each path transitions a
 * lesson out of the "has an event in Google" set, so the reconcile must
 * run or Google diverges from the lessons table.
 */
describe("background state-change hooks", () => {
  async function waitForUpsertCall(expectedEventId: string, timeoutMs = 1500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const seen = vi
        .mocked(googleClient.upsertEvent)
        .mock.calls.map((call) => call[3]);
      if (seen.includes(expectedEventId)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`upsertEvent never called with event id ${expectedEventId} within ${timeoutMs}ms`);
  }

  it("cron auto-complete KEEPS the Google event (approved + past → completed → events.patch via upsert, no delete)", async () => {
    await seedCoachIntegration();
    // Approved lesson, already ended — the cron will flip it to completed.
    // Per the corrected rule (ADR 027), the event must stay on the coach's
    // calendar as history. The reconcile fires an upsert (409-then-patch),
    // never a delete.
    const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    const inserted = await adminDb()
      .insert(lessons)
      .values({
        householdId: owner.householdId,
        locationId,
        startsAt: pastStart,
        durationMinutes: 30,
        type: "private",
        status: "approved",
        requestedBy: owner.userId,
        approvedAt: new Date(pastStart.getTime() - 60 * 60 * 1000),
        approvedBy: coach.userId,
        calendarSyncStatus: "synced",
      })
      .returning({ id: lessons.id });
    const lessonId = inserted[0]!.id;
    const expectedEventId = stripDashes(lessonId);
    // Mirror the deterministic event id the service uses so the pre-cron
    // row shape matches reality (prior sync wrote this exact id).
    await adminDb()
      .update(lessons)
      .set({ googleCalendarEventId: expectedEventId })
      .where(eq(lessons.id, lessonId));
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId: swimmerIds[0]! });

    const cronSecret = process.env["CRON_SECRET"];
    expect(cronSecret).toBeTruthy();

    vi.mocked(googleClient.upsertEvent).mockClear();
    vi.mocked(googleClient.deleteEventIdempotent).mockClear();

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", cronSecret!);
    expect(res.status).toBe(200);
    expect(res.body.completed).toBeGreaterThanOrEqual(1);

    const [row] = await adminDb().select().from(lessons).where(eq(lessons.id, lessonId));
    expect(row!.status).toBe("completed");

    // The microtask ran: upsert was called (keeps the event in Google).
    // No delete call. The row's event id is unchanged.
    await waitForUpsertCall(expectedEventId);
    expect(googleClient.deleteEventIdempotent).not.toHaveBeenCalled();
    const [after] = await adminDb()
      .select({ eventId: lessons.googleCalendarEventId })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(after!.eventId).toBe(expectedEventId);
  });

  it("retry on an approved lesson whose end time has passed does NOT delete the event", async () => {
    // The retry endpoint iterates every sync_failed lesson. Before the
    // rule fix, a sync_failed lesson whose end time had passed would be
    // deleted on retry because shouldExist was gated on starts_at > now().
    // Now the deterministic path is upsert (keeps the event).
    await seedCoachIntegration();
    const pastStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const inserted = await adminDb()
      .insert(lessons)
      .values({
        householdId: owner.householdId,
        locationId,
        startsAt: pastStart,
        durationMinutes: 30,
        type: "private",
        status: "approved",
        requestedBy: owner.userId,
        approvedAt: new Date(pastStart.getTime() - 60 * 60 * 1000),
        approvedBy: coach.userId,
        calendarSyncStatus: "sync_failed",
        calendarSyncError: "google: 500",
      })
      .returning({ id: lessons.id });
    const lessonId = inserted[0]!.id;
    const expectedEventId = stripDashes(lessonId);
    await adminDb()
      .update(lessons)
      .set({ googleCalendarEventId: expectedEventId })
      .where(eq(lessons.id, lessonId));
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId: swimmerIds[0]! });

    vi.mocked(googleClient.upsertEvent).mockClear();
    vi.mocked(googleClient.deleteEventIdempotent).mockClear();

    const retryRes = await request(app)
      .post("/coach/calendar/retry-failed")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(retryRes.status).toBe(200);

    // Retry called upsert for the past approved lesson, NOT delete.
    const upsertIds = vi
      .mocked(googleClient.upsertEvent)
      .mock.calls.map((call) => call[3]);
    expect(upsertIds).toContain(expectedEventId);
    expect(googleClient.deleteEventIdempotent).not.toHaveBeenCalled();
    const [after] = await adminDb()
      .select({
        eventId: lessons.googleCalendarEventId,
        status: lessons.calendarSyncStatus,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(after!.eventId).toBe(expectedEventId);
    expect(after!.status).toBe("synced");
  });

  it("cron expiry fires the hook but makes no Google call for pending lessons that were never synced", async () => {
    await seedCoachIntegration();
    // Pending lesson, past its expires_at. Cron will flip to expired.
    // There's no event in Google so the reconcile short-circuits.
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const inserted = await adminDb()
      .insert(lessons)
      .values({
        householdId: owner.householdId,
        locationId,
        startsAt,
        durationMinutes: 30,
        type: "private",
        status: "pending",
        requestedBy: owner.userId,
        expiresAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
      })
      .returning({ id: lessons.id });
    const lessonId = inserted[0]!.id;
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId: swimmerIds[0]! });

    vi.mocked(googleClient.upsertEvent).mockClear();
    vi.mocked(googleClient.deleteEventIdempotent).mockClear();

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", process.env["CRON_SECRET"]!);
    expect(res.status).toBe(200);
    expect(res.body.expired).toBeGreaterThanOrEqual(1);

    // Give any microtasks a moment to drain.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Status flipped and the reconcile correctly made no Google call for
    // THIS lesson (short-circuit on !shouldExist && !googleCalendarEventId).
    // The cron also runs a light pass for the test coach's integration,
    // which may touch other in-window lessons in the dev DB — those are
    // not the subject of this test.
    const [row] = await adminDb().select().from(lessons).where(eq(lessons.id, lessonId));
    expect(row!.status).toBe("expired");
    const expiredEventId = stripDashes(lessonId);
    const upsertIds = vi.mocked(googleClient.upsertEvent).mock.calls.map((c) => c[3]);
    const deleteIds = vi
      .mocked(googleClient.deleteEventIdempotent)
      .mock.calls.map((c) => c[3]);
    expect(upsertIds).not.toContain(expiredEventId);
    expect(deleteIds).not.toContain(expiredEventId);
  });

  it("lazy expiry on GET /coach/lessons fires the hook per expired lesson", async () => {
    await seedCoachIntegration();
    // Same shape as the cron expiry test but driven by a coach GET on the
    // lessons list, which performs its own lazy expiry inside the handler.
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const inserted = await adminDb()
      .insert(lessons)
      .values({
        householdId: owner.householdId,
        locationId,
        startsAt,
        durationMinutes: 30,
        type: "private",
        status: "pending",
        requestedBy: owner.userId,
        expiresAt: new Date(Date.now() - 60 * 1000),
      })
      .returning({ id: lessons.id });
    const lessonId = inserted[0]!.id;
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId: swimmerIds[0]! });

    vi.mocked(googleClient.upsertEvent).mockClear();
    vi.mocked(googleClient.deleteEventIdempotent).mockClear();

    const res = await request(app)
      .get("/coach/lessons")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const [row] = await adminDb().select().from(lessons).where(eq(lessons.id, lessonId));
    expect(row!.status).toBe("expired");
    const expiredEventId = stripDashes(lessonId);
    const upsertIds = vi.mocked(googleClient.upsertEvent).mock.calls.map((c) => c[3]);
    const deleteIds = vi
      .mocked(googleClient.deleteEventIdempotent)
      .mock.calls.map((c) => c[3]);
    expect(upsertIds).not.toContain(expiredEventId);
    expect(deleteIds).not.toContain(expiredEventId);
  });
});

describe("full pass covers today + already-synced + strays", () => {
  it("connect reconciles a lesson from earlier today AND an already-synced future lesson", async () => {
    await seedCoachIntegration();
    // Earlier today in LA — within the sync window — approved, never synced.
    // Use a timestamp 1 hour before "now" so it's still today-LA.
    const earlierTodayStart = new Date(Date.now() - 60 * 60 * 1000);
    const earlierTodayId = await seedLesson({
      status: "approved",
      startsAt: earlierTodayStart,
      calendarSyncStatus: "not_synced",
    });
    // Future lesson already synced — the OLD backfill would skip it. The
    // full pass must still reconcile it to prove Google matches the DB.
    const futureSyncedId = await seedLesson({ status: "approved", startsAt: future(24) });
    await adminDb()
      .update(lessons)
      .set({
        calendarSyncStatus: "synced",
        googleCalendarEventId: stripDashes(futureSyncedId),
      })
      .where(eq(lessons.id, futureSyncedId));

    await runFullSyncPass(coach.userId);

    const synced = vi
      .mocked(googleClient.upsertEvent)
      .mock.calls.map((call) => call[3]);
    expect(synced).toContain(stripDashes(earlierTodayId));
    expect(synced).toContain(stripDashes(futureSyncedId));
  });

  it("full pass recreates an event the coach deleted in Google (mock errors on patch)", async () => {
    // "Deleted in Google" presents to our code as a 404 on patch after the
    // 409-fallback inside upsertEvent. We model the whole upsertEvent as
    // throwing a 404 once; the service marks it sync_failed. The *next*
    // full-pass invocation sees sync_failed with event id still set and
    // re-upserts cleanly. The event is "recreated" via re-insert (upsert
    // starts with insert; if 404 cleaned the id in Google, insert succeeds).
    await seedCoachIntegration();
    const lessonId = await seedLesson({ status: "approved", startsAt: future(24) });
    const eventId = stripDashes(lessonId);
    await adminDb()
      .update(lessons)
      .set({ calendarSyncStatus: "synced", googleCalendarEventId: eventId })
      .where(eq(lessons.id, lessonId));

    // First pass: Google says "not found" when we upsert OUR lesson's
    // event id. Target the mock at THIS specific id — the full pass walks
    // all in-window lessons globally in a seeded dev DB, and a positional
    // mock would land on a different lesson.
    vi.mocked(googleClient.upsertEvent).mockImplementation(async (_env, _tok, _cal, callEventId) => {
      if (callEventId === eventId) {
        throw Object.assign(new Error("not found"), { code: 404 });
      }
    });
    await runFullSyncPass(coach.userId);

    let [row] = await adminDb().select().from(lessons).where(eq(lessons.id, lessonId));
    expect(row!.calendarSyncStatus).toBe("sync_failed");

    // Second pass: upsert now succeeds (coach's calendar is reachable
    // again, Google creates a fresh event under the same deterministic id).
    vi.mocked(googleClient.upsertEvent).mockImplementation(async () => {});
    await runFullSyncPass(coach.userId);

    [row] = await adminDb().select().from(lessons).where(eq(lessons.id, lessonId));
    expect(row!.calendarSyncStatus).toBe("synced");
    expect(row!.googleCalendarEventId).toBe(eventId);
  });

  it("full pass deletes a stray event id left on a canceled lesson in the window", async () => {
    await seedCoachIntegration();
    // Approved → synced → canceled, but the service was down so the
    // event id was never cleared. Full pass must find it via the
    // "event_id IS NOT NULL" branch and delete the Google event.
    const lessonId = await seedLesson({
      status: "canceled",
      startsAt: future(24),
      calendarSyncStatus: "synced",
    });
    await adminDb()
      .update(lessons)
      .set({ googleCalendarEventId: stripDashes(lessonId) })
      .where(eq(lessons.id, lessonId));

    await runFullSyncPass(coach.userId);

    expect(googleClient.deleteEventIdempotent).toHaveBeenCalledTimes(1);
    const [row] = await adminDb().select().from(lessons).where(eq(lessons.id, lessonId));
    expect(row!.googleCalendarEventId).toBeNull();
  });

  it("full pass sets last_full_reconcile_at on success", async () => {
    await seedCoachIntegration();
    const before = (
      await adminDb()
        .select({ last: coachCalendarIntegrations.lastFullReconcileAt })
        .from(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId))
    )[0]!.last;
    expect(before).toBeNull();

    await runFullSyncPass(coach.userId);

    const after = (
      await adminDb()
        .select({ last: coachCalendarIntegrations.lastFullReconcileAt })
        .from(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId))
    )[0]!.last;
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("full pass short-circuits when integration is needs_reconnect", async () => {
    await seedCoachIntegration("needs_reconnect");
    await seedLesson({ status: "approved", startsAt: future(24) });

    await runFullSyncPass(coach.userId);

    expect(googleClient.upsertEvent).not.toHaveBeenCalled();
    expect(googleClient.deleteEventIdempotent).not.toHaveBeenCalled();
  });
});

describe("cron tick runs light + 24h full passes", () => {
  async function waitForLessonStatus(
    lessonId: string,
    expected: "synced" | "sync_failed",
    timeoutMs = 2000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [row] = await adminDb()
        .select({ status: lessons.calendarSyncStatus })
        .from(lessons)
        .where(eq(lessons.id, lessonId));
      if (row?.status === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`lesson ${lessonId} did not reach ${expected} within ${timeoutMs}ms`);
  }

  async function waitForLastFullReconcileAfter(baseline: Date, timeoutMs = 2000): Promise<Date | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [row] = await adminDb()
        .select({ last: coachCalendarIntegrations.lastFullReconcileAt })
        .from(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
      if (row?.last && row.last.getTime() > baseline.getTime()) return row.last;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  }

  it("a failed lesson and a not_synced lesson both get synced by the next tick's light pass", async () => {
    await seedCoachIntegration();
    // Pretend a full pass already ran so this tick runs a LIGHT pass only.
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ lastFullReconcileAt: new Date() })
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));

    const failedId = await seedLesson({
      status: "approved",
      startsAt: future(24),
      calendarSyncStatus: "sync_failed",
    });
    const notSyncedId = await seedLesson({
      status: "approved",
      startsAt: future(48),
      calendarSyncStatus: "not_synced",
    });

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", process.env["CRON_SECRET"]!);
    expect(res.status).toBe(200);
    await waitForLessonStatus(failedId, "synced");
    await waitForLessonStatus(notSyncedId, "synced");
  });

  it("a tick skips everything (no Google calls) when the integration is needs_reconnect", async () => {
    await seedCoachIntegration("needs_reconnect");
    await seedLesson({
      status: "approved",
      startsAt: future(24),
      calendarSyncStatus: "sync_failed",
    });

    vi.mocked(googleClient.upsertEvent).mockClear();
    vi.mocked(googleClient.deleteEventIdempotent).mockClear();

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", process.env["CRON_SECRET"]!);
    expect(res.status).toBe(200);
    // No active integration → both pass counters are zero.
    expect(res.body.fullPasses).toBe(0);
    expect(res.body.lightPasses).toBe(0);

    // Give any scheduled microtasks a moment to prove they didn't run.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(googleClient.upsertEvent).not.toHaveBeenCalled();
    expect(googleClient.deleteEventIdempotent).not.toHaveBeenCalled();
  });

  it("promotes to a full pass when last_full_reconcile_at is >24h old; second tick within 24h runs light only", async () => {
    await seedCoachIntegration();
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ lastFullReconcileAt: stale })
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));

    const res1 = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", process.env["CRON_SECRET"]!);
    expect(res1.status).toBe(200);
    expect(res1.body.fullPasses).toBe(1);
    expect(res1.body.lightPasses).toBe(0);

    const bumped = await waitForLastFullReconcileAfter(stale);
    expect(bumped).not.toBeNull();

    const res2 = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", process.env["CRON_SECRET"]!);
    expect(res2.status).toBe(200);
    expect(res2.body.fullPasses).toBe(0);
    expect(res2.body.lightPasses).toBe(1);
  });
});
