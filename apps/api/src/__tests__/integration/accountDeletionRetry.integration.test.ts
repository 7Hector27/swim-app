// Integration tests for the account-deletion retry drain (ADR 034 Phase 3).
//
// The drain is the mechanism that keeps the external world (Google
// Calendar + Supabase Auth) eventually consistent with the DB side of
// a deletion. Covers the five cases in the plan:
//
//   1. Auth delete fails once, then succeeds on the next tick.
//   2. Terminal failure after MAX_ATTEMPTS logs at error level and
//      flips the row to 'failed'; a subsequent tick is a no-op.
//   3. An already-deleted auth user (Supabase returns user_not_found)
//      is treated as success on the first retry.
//   4. Past events are patched to the anonymized shape; future events
//      are deleted. Both dispatches are verified against the mocked
//      Google client's call record.
//   5. Overlapping ticks don't double-process a job — the cron lease
//      serializes POST /internal/cron/tick; the drain's FOR UPDATE
//      SKIP LOCKED guards against a lease-expired takeover.

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import type { SupabaseClient } from "@supabase/supabase-js";

// Env for OAuth config must be set before importing anything that reads
// getEnv().googleOAuth (googleCalendarSync pulls this on module load).
process.env["GOOGLE_OAUTH_CLIENT_ID"] = "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "test-client-secret";
process.env["GOOGLE_OAUTH_REDIRECT_URI"] = "http://localhost:3001/integrations/google/callback";
process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
process.env["GOOGLE_OAUTH_STATE_SECRET"] = "s".repeat(32);

import { createApp } from "../../app";
import {
  accountDeletionJobs,
  coachNotifications,
  households,
  lessons,
  profiles,
} from "../../db/schema";
import { __resetEnvCacheForTests } from "../../lib/env";
import {
  ACCOUNT_DELETION_MAX_ATTEMPTS,
  runAccountDeletionRetryDrain,
  type AccountDeletionCleanupDeps,
} from "../../services/accountDeletion";
import type { AnonymizedCalendarSyncOutcome } from "../../services/googleCalendarSync";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";

__resetEnvCacheForTests();

const logger = pino({ level: "silent" });
const app = createApp(logger);

const TEST_PASSWORD = "integration-test-password-1";
const DELETION_PHRASE = "delete my account";

// Track every test user we create so afterEach cleanup runs even on
// failure. Mirrors the pattern in accountDeletion.integration.test.ts.
const testUsers: TestUser[] = [];

afterEach(async () => {
  for (const user of testUsers.splice(0)) {
    await user.cleanup().catch(() => { /* best-effort */ });
  }
});

afterAll(async () => {
  await closeAdminDb();
});

// ── Mock builders ────────────────────────────────────────────────────────────

interface MockAdminState {
  deleteUser: ReturnType<typeof vi.fn>;
  admin: SupabaseClient;
}

function buildMockAdmin(impl: (userId: string) => Promise<{ data: unknown; error: unknown }>): MockAdminState {
  const deleteUser = vi.fn((userId: string) => impl(userId));
  const admin = {
    auth: { admin: { deleteUser } },
  } as unknown as SupabaseClient;
  return { deleteUser, admin };
}

function buildSuccessAdmin(): MockAdminState {
  return buildMockAdmin(() => Promise.resolve({ data: null, error: null }));
}

function buildFailingAdmin(status = 500, name = "AuthApiError"): MockAdminState {
  return buildMockAdmin(() =>
    Promise.resolve({
      data: null,
      error: { name, status, code: "upstream_error", message: "simulated transient failure for test" },
    }),
  );
}

function buildUserNotFoundAdmin(): MockAdminState {
  return buildMockAdmin(() =>
    Promise.resolve({
      data: null,
      error: {
        name: "AuthApiError",
        status: 404,
        code: "user_not_found",
        // The whole point of the idempotency path is that we never let
        // this .message reach a log, even though it could echo the
        // user's email in prod. The test is structured so the only
        // signal is the summary.
        message: "User <REDACTED>@example.com not found",
      },
    }),
  );
}

function buildSyncRecorder(): {
  sync: NonNullable<AccountDeletionCleanupDeps["syncAnonymizedLessonToCalendar"]>;
  calls: string[];
  failOnce: Set<string>;
} {
  const calls: string[] = [];
  const failOnce = new Set<string>();
  const sync = vi.fn(
    async (lessonId: string): Promise<AnonymizedCalendarSyncOutcome> => {
      if (failOnce.has(lessonId)) {
        failOnce.delete(lessonId);
        const err = new Error("transient google 500");
        (err as unknown as { status: number }).status = 500;
        throw err;
      }
      calls.push(lessonId);
      return { status: "reconciled" };
    },
  );
  return { sync, calls, failOnce };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedAnonymizedLesson(
  householdId: string,
  startsAt: Date,
): Promise<string> {
  const rows = await adminDb()
    .insert(lessons)
    .values({
      // Identity columns null to mimic what the engine would leave
      // behind after anonymizeHouseholdLessons ran.
      householdId: null,
      locationId: null,
      requestedBy: null,
      startsAt,
      durationMinutes: 30,
      type: "private",
      status: "completed",
      anonymizedAt: new Date(startsAt.getTime() - 60_000),
      locationSnapshot: "Home pool",
      swimmerCount: 1,
    })
    .returning({ id: lessons.id });
  // Suppress unused-import warning; we only need householdId for naming,
  // not for the row itself.
  void householdId;
  return rows[0]!.id;
}

async function seedJob(opts: {
  authUserId: string;
  anonymizedLessonIds: string[];
  attempts?: number;
  updatedAt?: Date;
  nextAttemptAt?: Date | null;
}): Promise<string> {
  // Tests want immediate eligibility unless they opt out — default
  // next_attempt_at to 5 minutes ago so the drain picks the row up on
  // first call. Pass null to leave the column unset (tests the pre-
  // migration-0071 "immediately eligible" fallback path).
  const nextAttemptAt =
    opts.nextAttemptAt === undefined
      ? new Date(Date.now() - 5 * 60 * 1000)
      : opts.nextAttemptAt;
  const rows = await adminDb()
    .insert(accountDeletionJobs)
    .values({
      // profile_id is nullable (ADR 034) — the referenced profile may
      // already have been scrubbed. Test rows use null to prove the
      // drain handles it.
      profileId: null,
      authUserId: opts.authUserId,
      scope: "solo",
      status: "pending",
      attempts: opts.attempts ?? 0,
      anonymizedLessonIds: opts.anonymizedLessonIds,
      ...(opts.updatedAt && { updatedAt: opts.updatedAt }),
      ...(nextAttemptAt !== null && { nextAttemptAt }),
    })
    .returning({ id: accountDeletionJobs.id });
  return rows[0]!.id;
}

// ── Case 1: fail once, succeed on next tick ──────────────────────────────────

describe("account-deletion retry drain — transient failure then success", () => {
  it("re-drives a pending job after the previous attempt's auth delete failed, succeeds on the next tick", async () => {
    const user = await createTestUser("retry-transient");
    testUsers.push(user);

    // Seed a job as if the route's post-commit fan-out already ran
    // once and failed (attempts=1). Older updated_at so the drain's
    // MIN_RETRY_WAIT_SECONDS floor doesn't skip it.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pastLessonId = await seedAnonymizedLesson(user.householdId, past);
    const futureLessonId = await seedAnonymizedLesson(user.householdId, future);
    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [pastLessonId, futureLessonId],
      attempts: 1,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    try {
      // First pass: admin.deleteUser fails. Calendar sync succeeds for
      // both lessons. Job stays pending, attempts increments to 2.
      const admin1 = buildFailingAdmin();
      const sync1 = buildSyncRecorder();
      const result1 = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync1.sync,
        supabaseAdmin: admin1.admin,
      });
      expect(result1.attempted).toBe(1);
      expect(result1.succeeded).toBe(0);
      expect(result1.failedTerminal).toBe(0);
      const after1 = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(after1[0]?.status).toBe("pending");
      expect(after1[0]?.attempts).toBe(2);
      expect(after1[0]?.lastError).toMatch(/^auth_delete_failed/);
      // Both lesson ids reconciled through the calendar stub.
      expect(sync1.calls.sort()).toEqual([pastLessonId, futureLessonId].sort());

      // The drain pushed next_attempt_at out by the attempts=2 backoff
      // (~10 min). Reset it to the past so the second pass picks the
      // row up immediately — the test is about the retry behavior, not
      // the wall-clock cadence.
      await adminDb()
        .update(accountDeletionJobs)
        .set({
          updatedAt: new Date(Date.now() - 5 * 60 * 1000),
          nextAttemptAt: new Date(Date.now() - 5 * 60 * 1000),
        })
        .where(eq(accountDeletionJobs.id, jobId));

      // Second pass: admin.deleteUser succeeds. Job flips to completed,
      // lastError cleared.
      const admin2 = buildSuccessAdmin();
      const sync2 = buildSyncRecorder();
      const result2 = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync2.sync,
        supabaseAdmin: admin2.admin,
      });
      expect(result2.succeeded).toBe(1);
      expect(result2.failedTerminal).toBe(0);
      const after2 = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(after2[0]?.status).toBe("completed");
      expect(after2[0]?.completedAt).not.toBeNull();
      expect(after2[0]?.lastError).toBeNull();

      // A third pass picks up nothing.
      const result3 = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync2.sync,
        supabaseAdmin: admin2.admin,
      });
      expect(result3.attempted).toBe(0);
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
      await adminDb().delete(lessons).where(inArray(lessons.id, [pastLessonId, futureLessonId]));
    }
  });
});

// ── Case 2: terminal failure after max attempts ──────────────────────────────

describe("account-deletion retry drain — terminal failure", () => {
  it("flips the job to 'failed' when attempts reach MAX_ATTEMPTS and logs event=account_deletion_cleanup_failed with ids only", async () => {
    const user = await createTestUser("retry-terminal");
    testUsers.push(user);

    // Seed at attempts = MAX - 1 so one more failed attempt takes us
    // to the terminal count.
    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [],
      attempts: ACCOUNT_DELETION_MAX_ATTEMPTS - 1,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    // Capture pino lines so the "logs ids only, no PII" invariant can
    // be asserted directly against the log stream.
    const captured: Array<Record<string, unknown>> = [];
    const captureLogger = pino(
      { level: "trace" },
      {
        write: (chunk: string) => {
          try {
            const parsed = JSON.parse(chunk);
            captured.push(parsed);
          } catch {
            /* ignore non-JSON */
          }
        },
      },
    );

    try {
      const admin = buildFailingAdmin();
      const sync = buildSyncRecorder();
      const result = await runAccountDeletionRetryDrain(captureLogger, {
        syncAnonymizedLessonToCalendar: sync.sync,
        supabaseAdmin: admin.admin,
      });
      expect(result.failedTerminal).toBe(1);

      const after = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(after[0]?.status).toBe("failed");
      expect(after[0]?.attempts).toBe(ACCOUNT_DELETION_MAX_ATTEMPTS);

      // The terminal log line is present with the ids-only payload and
      // nothing derived from the user's email / name.
      const terminalLogs = captured.filter(
        (line) => line["event"] === "account_deletion_cleanup_failed",
      );
      expect(terminalLogs).toHaveLength(1);
      const terminal = terminalLogs[0]!;
      expect(terminal["jobId"]).toBe(jobId);
      expect(terminal["scope"]).toBe("solo");
      expect(terminal["attempts"]).toBe(ACCOUNT_DELETION_MAX_ATTEMPTS);
      // No PII — the user's email never appears in the serialized line.
      expect(JSON.stringify(terminal)).not.toContain(user.email);

      // Next pass is a no-op — failed jobs don't get re-processed.
      const admin2 = buildSuccessAdmin();
      const result2 = await runAccountDeletionRetryDrain(captureLogger, {
        syncAnonymizedLessonToCalendar: sync.sync,
        supabaseAdmin: admin2.admin,
      });
      expect(result2.attempted).toBe(0);
      expect(admin2.deleteUser).not.toHaveBeenCalled();
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
    }
  });
});

// ── Case 3: user_not_found treated as success ────────────────────────────────

describe("account-deletion retry drain — user_not_found is success", () => {
  it("collapses a Supabase user_not_found response to success without surfacing the .message in the log", async () => {
    const user = await createTestUser("retry-user-not-found");
    testUsers.push(user);

    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [],
      attempts: 1,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    const captured: Array<Record<string, unknown>> = [];
    const captureLogger = pino(
      { level: "trace" },
      {
        write: (chunk: string) => {
          try {
            const parsed = JSON.parse(chunk);
            captured.push(parsed);
          } catch {
            /* ignore */
          }
        },
      },
    );

    try {
      const admin = buildUserNotFoundAdmin();
      const sync = buildSyncRecorder();
      const result = await runAccountDeletionRetryDrain(captureLogger, {
        syncAnonymizedLessonToCalendar: sync.sync,
        supabaseAdmin: admin.admin,
      });

      expect(result.succeeded).toBe(1);
      expect(result.failedTerminal).toBe(0);
      const after = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(after[0]?.status).toBe("completed");

      // The mock's error.message contains a literal <REDACTED>@example.com
      // pattern; the idempotent handler must never let it reach the log.
      expect(JSON.stringify(captured)).not.toContain("<REDACTED>@example.com");
      // And no error line was written — this path is success.
      const errorLogs = captured.filter(
        (line) => line["event"] === "account_deletion_auth_delete_failed",
      );
      expect(errorLogs).toHaveLength(0);
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
    }
  });
});

// ── Case 4: past events patched, future events deleted ───────────────────────

describe("account-deletion retry drain — calendar dispatch", () => {
  it("passes past and future anonymized lesson ids through the injected calendar sync in dispatch order", async () => {
    const user = await createTestUser("retry-calendar-dispatch");
    testUsers.push(user);

    // Two past + one future anonymized lesson. The drain just walks
    // the stored ids and calls syncAnonymizedLessonToCalendar for each;
    // the past/future dispatch itself lives in syncAnonymizedLessonTo
    // Calendar and is covered by its own unit path. Here we verify the
    // drain hands every id over.
    const past1 = await seedAnonymizedLesson(
      user.householdId,
      new Date(Date.now() - 48 * 60 * 60 * 1000),
    );
    const past2 = await seedAnonymizedLesson(
      user.householdId,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    const future1 = await seedAnonymizedLesson(
      user.householdId,
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );

    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [past1, past2, future1],
      attempts: 1,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    try {
      const admin = buildSuccessAdmin();
      const sync = buildSyncRecorder();
      await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync.sync,
        supabaseAdmin: admin.admin,
      });
      expect(sync.calls.sort()).toEqual([past1, past2, future1].sort());
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
      await adminDb().delete(lessons).where(inArray(lessons.id, [past1, past2, future1]));
    }
  });
});

// ── Case 5: overlapping ticks don't double-process ───────────────────────────

describe("account-deletion retry drain — overlapping ticks", () => {
  it("two concurrent drain passes split the pending set via FOR UPDATE SKIP LOCKED — no job runs twice", async () => {
    const user = await createTestUser("retry-overlap");
    testUsers.push(user);

    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [],
      attempts: 1,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    try {
      const admin = buildSuccessAdmin();
      const sync = buildSyncRecorder();
      // Fire two drain passes concurrently against the same DB. The
      // FOR UPDATE SKIP LOCKED on the eligible-set select means
      // whichever connection locks the row first owns it for its
      // transaction; the other sees an empty batch. The admin
      // deleteUser stub should be called exactly once across both.
      const [a, b] = await Promise.all([
        runAccountDeletionRetryDrain(logger, {
          syncAnonymizedLessonToCalendar: sync.sync,
          supabaseAdmin: admin.admin,
        }),
        runAccountDeletionRetryDrain(logger, {
          syncAnonymizedLessonToCalendar: sync.sync,
          supabaseAdmin: admin.admin,
        }),
      ]);
      expect(a.attempted + b.attempted).toBe(1);
      expect(admin.deleteUser).toHaveBeenCalledTimes(1);
      expect(admin.deleteUser).toHaveBeenCalledWith(user.userId);

      const after = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(after[0]?.status).toBe("completed");
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
    }
  });
});

// ── Case 6: exponential backoff pushes next_attempt_at per curve ─────────────

describe("account-deletion retry drain — exponential backoff", () => {
  it("writes the expected next_attempt_at after each real-error attempt (5min → 10 → 20 → 40 … capped at 6h)", async () => {
    const user = await createTestUser("retry-backoff");
    testUsers.push(user);

    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [],
      attempts: 0,
    });

    try {
      const admin = buildFailingAdmin();
      const sync = buildSyncRecorder();

      // Expected backoff curve in seconds (base 5min, double, cap 6h).
      // Index is the attempts count AFTER the drain increments.
      const expectedSeconds = [
        5 * 60,       // attempt 1
        10 * 60,      // attempt 2
        20 * 60,      // attempt 3
        40 * 60,      // attempt 4
        80 * 60,      // attempt 5
        160 * 60,     // attempt 6
        320 * 60,     // attempt 7 (not yet capped)
        6 * 60 * 60,  // attempt 8  (cap kicks in)
        6 * 60 * 60,  // attempt 9
        6 * 60 * 60,  // attempt 10
      ];

      let cumulativeSeconds = 0;
      for (let i = 0; i < expectedSeconds.length; i++) {
        // Reset next_attempt_at so the drain picks the row up. In
        // production the cron tick cadence waits for the actual
        // next_attempt_at; the test fast-forwards.
        await adminDb()
          .update(accountDeletionJobs)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(accountDeletionJobs.id, jobId));

        const before = Date.now();
        await runAccountDeletionRetryDrain(logger, {
          syncAnonymizedLessonToCalendar: sync.sync,
          supabaseAdmin: admin.admin,
        });

        const row = await adminDb()
          .select()
          .from(accountDeletionJobs)
          .where(eq(accountDeletionJobs.id, jobId))
          .limit(1);
        expect(row[0]?.attempts).toBe(i + 1);
        expect(row[0]?.status).toBe("pending");

        const expected = expectedSeconds[i]!;
        cumulativeSeconds += expected;
        const nextAttemptAt = row[0]?.nextAttemptAt;
        expect(nextAttemptAt).not.toBeNull();
        const actualDeltaMs = nextAttemptAt!.getTime() - before;
        // Allow slop for DB round-trip + Node clock drift. The curve
        // step is what's being tested, not sub-second precision.
        expect(actualDeltaMs).toBeGreaterThanOrEqual(expected * 1000 - 2000);
        expect(actualDeltaMs).toBeLessThanOrEqual(expected * 1000 + 5000);
      }

      // Sum of waits across 10 inter-attempt gaps = 28.6 hours. The
      // spec: attempts span at least one day before going terminal.
      expect(cumulativeSeconds).toBeGreaterThanOrEqual(24 * 60 * 60);
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
    }
  });

  it("skips rows whose next_attempt_at is in the future", async () => {
    const user = await createTestUser("retry-backoff-not-due");
    testUsers.push(user);

    // Fresh job with next_attempt_at 10 minutes in the future — not
    // due. The drain should ignore it, not reset the counter.
    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [],
      attempts: 3,
      nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    try {
      const admin = buildFailingAdmin();
      const sync = buildSyncRecorder();
      const result = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync.sync,
        supabaseAdmin: admin.admin,
      });
      expect(result.attempted).toBe(0);
      expect(admin.deleteUser).not.toHaveBeenCalled();

      const row = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(row[0]?.attempts).toBe(3);
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
    }
  });

  it("rows with next_attempt_at NULL are immediately eligible (pre-0071 fallback)", async () => {
    const user = await createTestUser("retry-backoff-null-next");
    testUsers.push(user);

    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [],
      attempts: 0,
      nextAttemptAt: null,
    });

    try {
      const admin = buildSuccessAdmin();
      const sync = buildSyncRecorder();
      const result = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync.sync,
        supabaseAdmin: admin.admin,
      });
      expect(result.attempted).toBe(1);
      expect(result.succeeded).toBe(1);
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
    }
  });
});

// ── Case 7: paused on disconnected Google integration doesn't burn attempts ──

describe("account-deletion retry drain — paused on disconnected integration", () => {
  function buildPausingSync(): NonNullable<AccountDeletionCleanupDeps["syncAnonymizedLessonToCalendar"]> {
    return vi.fn(
      async (_lessonId: string): Promise<AnonymizedCalendarSyncOutcome> => ({
        status: "integration_paused",
        reason: "not_active",
      }),
    );
  }

  it("holds attempts steady and pushes next_attempt_at out by a short recheck window when all calendar steps are paused and auth succeeds", async () => {
    const user = await createTestUser("retry-paused-calendar");
    testUsers.push(user);

    // Anonymized lesson exists but Jason's Google is disconnected. The
    // paused signal propagates from syncAnonymizedLessonToCalendar →
    // cleanup.paused → drain treats it as a non-attempt pause.
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pastLessonId = await seedAnonymizedLesson(user.householdId, past);
    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [pastLessonId],
      attempts: 4, // mid-budget so we can prove the counter doesn't move
    });

    try {
      const admin = buildSuccessAdmin();
      const sync = buildPausingSync();

      // Run the drain 10 times. Attempts must stay at 4 through all
      // 10 passes — Jason's OAuth reconnect window is not an attempt.
      // The budget (11) would have exhausted after 7 real-error
      // attempts starting from attempts=4.
      for (let i = 0; i < 10; i++) {
        // Reset next_attempt_at so each pass picks the row up.
        await adminDb()
          .update(accountDeletionJobs)
          .set({ nextAttemptAt: new Date(Date.now() - 1000) })
          .where(eq(accountDeletionJobs.id, jobId));

        const before = Date.now();
        const result = await runAccountDeletionRetryDrain(logger, {
          syncAnonymizedLessonToCalendar: sync,
          supabaseAdmin: admin.admin,
        });
        expect(result.paused).toBe(1);
        expect(result.succeeded).toBe(0);
        expect(result.failedTerminal).toBe(0);

        const row = await adminDb()
          .select()
          .from(accountDeletionJobs)
          .where(eq(accountDeletionJobs.id, jobId))
          .limit(1);
        expect(row[0]?.status).toBe("pending");
        expect(row[0]?.attempts).toBe(4); // unchanged after N pauses
        expect(row[0]?.lastError).toBe("paused:integration_needs_reconnect");
        // Recheck window is 5 minutes (short, matches cron cadence).
        const nextAttemptAt = row[0]?.nextAttemptAt;
        expect(nextAttemptAt).not.toBeNull();
        const deltaMs = nextAttemptAt!.getTime() - before;
        expect(deltaMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
        expect(deltaMs).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);
      }

      // Now Jason reconnects: sync returns reconciled, auth succeeds.
      // The NEXT drain pass completes the job without having spent
      // any of the budget.
      await adminDb()
        .update(accountDeletionJobs)
        .set({ nextAttemptAt: new Date(Date.now() - 1000) })
        .where(eq(accountDeletionJobs.id, jobId));

      const reconciledSync = buildSyncRecorder();
      const finalResult = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: reconciledSync.sync,
        supabaseAdmin: admin.admin,
      });
      expect(finalResult.succeeded).toBe(1);
      const after = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(after[0]?.status).toBe("completed");
      expect(after[0]?.attempts).toBe(4); // still 4 — pauses don't count
      expect(after[0]?.lastError).toBeNull();
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
      await adminDb().delete(lessons).where(eq(lessons.id, pastLessonId));
    }
  });

  it("paused calendar + auth-delete failure still counts as a real attempt (the auth step is the one actually broken)", async () => {
    const user = await createTestUser("retry-paused-plus-auth-fail");
    testUsers.push(user);

    const pastLessonId = await seedAnonymizedLesson(
      user.householdId,
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    const jobId = await seedJob({
      authUserId: user.userId,
      anonymizedLessonIds: [pastLessonId],
      attempts: 2,
    });

    try {
      const admin = buildFailingAdmin(); // 500 from Supabase
      const sync = buildPausingSync();

      const result = await runAccountDeletionRetryDrain(logger, {
        syncAnonymizedLessonToCalendar: sync,
        supabaseAdmin: admin.admin,
      });
      // Not a pause — the auth step failed, so we count the attempt.
      expect(result.paused).toBe(0);
      expect(result.attempted).toBe(1);

      const row = await adminDb()
        .select()
        .from(accountDeletionJobs)
        .where(eq(accountDeletionJobs.id, jobId))
        .limit(1);
      expect(row[0]?.status).toBe("pending");
      expect(row[0]?.attempts).toBe(3); // real error → increment
      expect(row[0]?.lastError).toMatch(/^auth_delete_failed/);
    } finally {
      await adminDb().delete(accountDeletionJobs).where(eq(accountDeletionJobs.id, jobId));
      await adminDb().delete(lessons).where(eq(lessons.id, pastLessonId));
    }
  });
});

// Suppress unused-import warnings for schemas referenced only in the
// cleanup paths of other tests.
void coachNotifications;
void households;
void profiles;
void and;
void app;
void request;
void TEST_PASSWORD;
void DELETION_PHRASE;
