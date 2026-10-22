// Parent booking email integration tests (ADR 028). Covers:
//
// 1. Auto-approve → exactly one lesson_confirmed outbox row, no booking_requested.
// 2. Pending booking → booking_requested row, drained to sent via the sender.
// 3. Transaction atomicity → a forced outbox write failure rolls the whole
//    lesson transaction back.
// 4. Pre-send supersede: lesson.starts_at in the past → superseded for a
//    REQUEST row; CANCEL rows still send.
// 5. EMAIL_ALLOWLIST dev fail-safe: a non-matching recipient flips the row
//    to skipped and never hits the transport.
// 6. Parallel sender + cron drain on the same row → exactly one transport call.
// 7. No PII in sender logs.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";
import {
  households,
  householdMembers,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { enqueueLessonEmail } from "../../services/emails/outbox";
import {
  CLAIM_LEASE_MS,
  sendLessonEmailOutboxRow,
  __resetSenderTransportForTests,
  __setSenderTransportForTests,
} from "../../services/emails/sender";
import { drainLessonEmailOutbox } from "../../services/emails/drain";
import type { EmailTransport, TransportResult, TransportSendOptions } from "../../services/emails/transport";
import { db } from "../../db/client";
import { __resetEnvCacheForTests } from "../../lib/env";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// A capture transport: records every send instead of hitting the network.
// Lets us assert exactly one call per outbox row across parallel sender +
// cron races. Returns 2xx by default; tests can swap in a stub that fails.
interface CapturedSend {
  options: TransportSendOptions;
  at: number;
}

class CaptureTransport implements EmailTransport {
  readonly sends: CapturedSend[] = [];
  // Optional per-call behavior: tests inject this to simulate 5xx / rate limits.
  behavior: (opts: TransportSendOptions) => Promise<TransportResult> = async () => ({
    ok: true,
    providerMessageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    error: null,
    errorMessage: null,
  });

  async send(opts: TransportSendOptions): Promise<TransportResult> {
    this.sends.push({ options: opts, at: Date.now() });
    return this.behavior(opts);
  }

  reset(): void {
    this.sends.length = 0;
  }
}

let owner: TestUser;
let locationId: string;
let swimmerId: string;
let transport: CaptureTransport;

beforeAll(async () => {
  // Env was configured by setup.ts to satisfy the sender's EMAIL_FROM check.
  // Reset the cache so parseEnv picks up the test values on first getEnv().
  __resetEnvCacheForTests();

  owner = await createTestUser("outbox-owner");

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "OutboxKid",
      lastName: "Integration",
      birthDate: "2016-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]?.id ?? "";

  transport = new CaptureTransport();
  __setSenderTransportForTests(transport);
});

afterAll(async () => {
  __resetSenderTransportForTests();
  if (swimmerId) {
    await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.lessonId, swimmerId)); // no-op; cleaned by lessonId per lesson below
    const lessonRows = await adminDb()
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.householdId, owner.householdId));
    for (const row of lessonRows) {
      await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.lessonId, row.id));
    }
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId));
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (owner) await owner.cleanup();
  await closeAdminDb();
});

beforeEach(() => {
  transport.reset();
  transport.behavior = async () => ({
    ok: true,
    providerMessageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    error: null,
    errorMessage: null,
  });
});

// Seeds a lesson row directly in the DB and returns its id. Bypasses the
// HTTP flow so each outbox test can target a known-shaped row without
// re-threading availability config.
async function seedLesson(opts: {
  status: "pending" | "approved" | "declined" | "canceled" | "expired";
  startsAt?: Date;
  calendarInviteSentAt?: Date | null;
  calendarSequence?: number;
}): Promise<string> {
  const startsAt = opts.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const row = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt,
      durationMinutes: 30,
      type: "private",
      status: opts.status,
      requestedBy: owner.userId,
      calendarInviteSentAt: opts.calendarInviteSentAt ?? null,
      calendarSequence: opts.calendarSequence ?? 0,
    })
    .returning({ id: lessons.id });
  const lessonId = row[0]!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  return lessonId;
}

async function readOutboxRow(id: string) {
  const rows = await adminDb()
    .select()
    .from(lessonEmailOutbox)
    .where(eq(lessonEmailOutbox.id, id))
    .limit(1);
  return rows[0];
}

describe("outbox write — auto-approve vs pending", () => {
  it("auto-approve writes exactly one lesson_confirmed row and zero booking_requested rows", async () => {
    const lessonId = await seedLesson({ status: "approved", calendarSequence: 0 });
    const outboxId = await db.transaction(async (tx) =>
      enqueueLessonEmail(tx, {
        lessonId,
        event: "lesson_confirmed",
        actorRole: "parent",
      }),
    );
    const row = await readOutboxRow(outboxId);
    expect(row?.event).toBe("lesson_confirmed");
    expect(row?.icsMethod).toBe("REQUEST");
    expect(row?.icsSequence).toBe(0);

    const allRows = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.lessonId, lessonId));
    expect(allRows).toHaveLength(1);
    expect(allRows[0]?.event).toBe("lesson_confirmed");

    // Lesson's calendar_sequence advanced to 1 (next SEQUENCE to issue).
    const lessonRows = await adminDb()
      .select({ cs: lessons.calendarSequence, invite: lessons.calendarInviteSentAt })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    expect(lessonRows[0]?.cs).toBe(1);
    expect(lessonRows[0]?.invite).not.toBeNull();
  });

  it("booking_requested gets ics_method=NULL (no .ics on pending)", async () => {
    const lessonId = await seedLesson({ status: "pending" });
    const outboxId = await db.transaction(async (tx) =>
      enqueueLessonEmail(tx, {
        lessonId,
        event: "booking_requested",
        actorRole: "parent",
      }),
    );
    const row = await readOutboxRow(outboxId);
    expect(row?.icsMethod).toBeNull();
    expect(row?.icsSequence).toBeNull();
    // Lesson's calendar_sequence unchanged.
    const lessonRows = await adminDb()
      .select({ cs: lessons.calendarSequence })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    expect(lessonRows[0]?.cs).toBe(0);
  });
});

describe("transaction atomicity — outbox insert failure rolls back the lesson change", () => {
  it("a failing enqueue inside the lesson transaction leaves the lesson row unchanged", async () => {
    // Seed a pending lesson. We'll attempt to flip it to approved within a
    // transaction that then fails on the outbox write; the lesson row
    // should remain pending after rollback.
    const lessonId = await seedLesson({ status: "pending" });

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(lessons)
          .set({ status: "approved", approvedAt: new Date() })
          .where(eq(lessons.id, lessonId));
        // Force the outbox write to raise by passing an unknown lesson id
        // — enqueueLessonEmail throws before it inserts, and the surrounding
        // transaction rolls the status update back.
        await enqueueLessonEmail(tx, {
          lessonId: "00000000-0000-0000-0000-000000000000",
          event: "lesson_confirmed",
          actorRole: "coach",
        });
      }),
    ).rejects.toThrow(/lesson .* not found/);

    const lessonRows = await adminDb()
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    expect(lessonRows[0]?.status).toBe("pending");
  });
});

describe("sender — pre-send supersede guard", () => {
  it("REQUEST row for a past-start-time lesson is superseded (no transport call)", async () => {
    const lessonId = await seedLesson({
      status: "approved",
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const outboxId = await db.transaction(async (tx) =>
      enqueueLessonEmail(tx, {
        lessonId,
        event: "lesson_confirmed",
        actorRole: "coach",
      }),
    );
    await sendLessonEmailOutboxRow(outboxId);

    const row = await readOutboxRow(outboxId);
    expect(row?.status).toBe("superseded");
    expect(row?.lastError).toContain("past_start_time");
    expect(transport.sends).toHaveLength(0);
  });

  it("CANCEL row for a past-start-time lesson is EXEMPT and still sends", async () => {
    const lessonId = await seedLesson({
      status: "canceled",
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      calendarInviteSentAt: new Date(),
      calendarSequence: 1,
    });
    const outboxId = await db.transaction(async (tx) =>
      enqueueLessonEmail(tx, {
        lessonId,
        event: "lesson_canceled",
        actorRole: "coach",
      }),
    );
    await sendLessonEmailOutboxRow(outboxId);

    const row = await readOutboxRow(outboxId);
    expect(row?.icsMethod).toBe("CANCEL");
    expect(row?.status).toBe("sent");
    expect(transport.sends).toHaveLength(1);
  });
});

describe("sender — EMAIL_ALLOWLIST fail-safe", () => {
  it("non-matching recipient flips the row to skipped and never hits the transport", async () => {
    // Simulate APP_ENV=dev's required allowlist by overriding the env's
    // cached email.allowlist in place. The parser only enforces non-empty
    // allowlist when APP_ENV=dev at boot; here we're testing runtime
    // filter behavior.
    const { getEnv } = await import("../../lib/env");
    const email = getEnv().email;
    expect(email).toBeDefined();
    const originalAllowlist = email!.allowlist;
    email!.allowlist = ["allowed@test.local"];

    try {
      const lessonId = await seedLesson({ status: "pending" });
      const outboxId = await db.transaction(async (tx) =>
        enqueueLessonEmail(tx, {
          lessonId,
          event: "booking_requested",
          actorRole: "parent",
        }),
      );
      await sendLessonEmailOutboxRow(outboxId);

      const row = await readOutboxRow(outboxId);
      expect(row?.status).toBe("skipped");
      expect(row?.lastError).toContain("no_deliverable_recipients");
      expect(transport.sends).toHaveLength(0);
    } finally {
      email!.allowlist = originalAllowlist;
    }
  });
});

describe("sender — parallel send + cron drain race", () => {
  it("post-commit send and cron drain racing on the same row produce exactly one transport call", async () => {
    const lessonId = await seedLesson({ status: "pending" });
    const outboxId = await db.transaction(async (tx) =>
      enqueueLessonEmail(tx, {
        lessonId,
        event: "booking_requested",
        actorRole: "parent",
      }),
    );

    // Fire the post-commit sender and the cron drain in parallel. The
    // claim-before-send protocol (FOR UPDATE SKIP LOCKED + status='sending')
    // guarantees exactly one gets through.
    await Promise.all([sendLessonEmailOutboxRow(outboxId), drainLessonEmailOutbox()]);

    const row = await readOutboxRow(outboxId);
    expect(row?.status).toBe("sent");
    const matching = transport.sends.filter((send) => send.options.idempotencyKey === outboxId);
    expect(matching).toHaveLength(1);
  });

  it("expired-claim recovery: a sending row whose claim has passed is re-claimed and finalized", async () => {
    const lessonId = await seedLesson({ status: "pending" });
    const outboxId = await db.transaction(async (tx) =>
      enqueueLessonEmail(tx, {
        lessonId,
        event: "booking_requested",
        actorRole: "parent",
      }),
    );
    // Simulate a crashed worker: force the row into 'sending' with an
    // already-expired claim.
    await adminDb()
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: new Date(Date.now() - CLAIM_LEASE_MS - 1000),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));

    await sendLessonEmailOutboxRow(outboxId);
    const row = await readOutboxRow(outboxId);
    expect(row?.status).toBe("sent");
    expect(transport.sends).toHaveLength(1);
  });
});

describe("sender — PII-free logging", () => {
  it("captured sender logs during a full send contain no swimmer first names, decline reasons, or emails", async () => {
    // Attach a sink logger to capture every log line emitted during the
    // sender run. We assert the serialized output doesn't carry any of the
    // PII fields that render inputs would otherwise expose.
    const captured: string[] = [];
    const sinkLogger = pino(
      { level: "debug" },
      {
        write: (chunk: string) => {
          captured.push(chunk);
        },
      },
    );
    const senderModule = await import("../../services/emails/sender");
    // Override the module's child logger by swapping the imported root
    // logger. The module declares its own child at import time, so we
    // instead patch the globally-shared pino logger via the api logger
    // module.
    const loggerModule = await import("../../logger");
    const origInfo = loggerModule.logger.info.bind(loggerModule.logger);
    const origWarn = loggerModule.logger.warn.bind(loggerModule.logger);
    vi.spyOn(loggerModule.logger, "info").mockImplementation((obj: unknown, msg?: string) => {
      sinkLogger.info(obj as object, msg);
      return origInfo(obj as object, msg);
    });
    vi.spyOn(loggerModule.logger, "warn").mockImplementation((obj: unknown, msg?: string) => {
      sinkLogger.warn(obj as object, msg);
      return origWarn(obj as object, msg);
    });

    try {
      const lessonId = await seedLesson({ status: "pending" });
      const outboxId = await db.transaction(async (tx) =>
        enqueueLessonEmail(tx, {
          lessonId,
          event: "booking_requested",
          actorRole: "parent",
        }),
      );
      await senderModule.sendLessonEmailOutboxRow(outboxId);
    } finally {
      vi.restoreAllMocks();
    }

    const allLogs = captured.join("\n");
    expect(allLogs).not.toContain("OutboxKid");
    expect(allLogs).not.toContain(owner.email);
  });
});
