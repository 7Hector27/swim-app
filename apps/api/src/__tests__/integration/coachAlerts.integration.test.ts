// Coach alert integration tests (ADR 031). Each behavior covered once.
//
// 1. Parent single-lesson booking writes exactly one booking_request row.
// 2. Coach actions write zero rows (sender filtering happens via the
//    stub's actor-is-coach early return).
// 3. Zero subscriptions + email backup enabled → push row ends 'skipped',
//    one coach_booking_request lesson_email_outbox row written.
// 4. 410 Gone deactivates the subscription; another active subscription
//    still delivers → row ends 'sent'.
// 5. VAPID / signature-like failure (classified as "fail") leaves the
//    subscription active; the row ends 'failed' with backoff.
// 6. Idempotency: the partial unique index enforces one
//    request_expiring_soon per lesson.
// 7. Daily summary unique index enforces one row per coach per LA date.
// 8. Preferences lazy-create: a fresh profile yields the default row on
//    first read.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  settleAndCleanupCoachNotificationsForHousehold,
  type TestUser,
} from "./helpers";
import {
  bookingBatches,
  coachCalendarIntegrations,
  coachNotifications,
  coachNotificationPreferences,
  coachPushSubscriptions,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { db } from "../../db/client";
import {
  notifyBookingCreated,
  notifyCoachOfChange,
} from "../../lib/lessonApproval";
import { enqueueCoachNotification } from "../../services/notifications/outbox";
import {
  sendCoachNotification,
  __setSenderTransportForTests,
  __resetSenderForTests,
} from "../../services/notifications/sender";
import {
  getOrCreateCoachNotificationPreferences,
  updateCoachNotificationPreferences,
} from "../../services/notifications/preferences";
import type {
  PushAttemptResult,
  PushBody,
  PushSubscriptionInput,
  PushTransport,
} from "../../services/notifications/pushTransport";
import type { DailySummaryPayload } from "../../services/notifications/types";

class CaptureTransport implements PushTransport {
  readonly sends: Array<{ sub: PushSubscriptionInput; body: PushBody }> = [];
  // Per-subscription behavior: keyed by endpoint. Defaults to 2xx ok.
  behaviorByEndpoint = new Map<string, PushAttemptResult>();

  async send(
    sub: PushSubscriptionInput,
    body: PushBody,
  ): Promise<PushAttemptResult> {
    this.sends.push({ sub, body });
    return (
      this.behaviorByEndpoint.get(sub.endpoint) ?? {
        outcome: "ok",
        statusCode: 201,
        shortError: null,
      }
    );
  }

  reset(): void {
    this.sends.length = 0;
    this.behaviorByEndpoint.clear();
  }
}

let owner: TestUser;
let coachProfile: TestUser; // uses the normal createTestUser flow then is bumped to role=coach
let locationId: string;
let swimmerId: string;
let transport: CaptureTransport;

async function makeCoach(profileId: string): Promise<void> {
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, profileId));
}

async function seedLesson(opts: {
  status: "pending" | "approved";
  startsAt?: Date;
  expiresAt?: Date | null;
}): Promise<string> {
  // Default to 2 hours out so the sender's 12-hour starts_at bypass
  // (ADR 031) always fires, regardless of whether wall-clock time is
  // currently inside the default quiet-hours window.
  const startsAt = opts.startsAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000);
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
      expiresAt: opts.expiresAt ?? null,
    })
    .returning({ id: lessons.id });
  const lessonId = row[0]!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  return lessonId;
}

async function cleanAllNotifications(): Promise<void> {
  // Drain in-flight notify* stubs so any pending INSERT lands before we
  // purge the tables.
  await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
  await adminDb()
    .delete(coachNotifications)
    .where(eq(coachNotifications.profileId, coachProfile.userId));
  await adminDb()
    .delete(coachPushSubscriptions)
    .where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
  await adminDb()
    .delete(coachNotificationPreferences)
    .where(eq(coachNotificationPreferences.profileId, coachProfile.userId));
}

beforeAll(async () => {
  owner = await createTestUser("coach-alerts-owner");
  coachProfile = await createTestUser("coach-alerts-coach");
  await makeCoach(coachProfile.userId);

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "AlertKid",
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
  __resetSenderForTests();
  await cleanAllNotifications();
  if (swimmerId) {
    const lessonRows = await adminDb()
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.householdId, owner.householdId));
    for (const row of lessonRows) {
      await adminDb()
        .delete(lessonEmailOutbox)
        .where(eq(lessonEmailOutbox.lessonId, row.id));
    }
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId));
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (owner) await owner.cleanup();
  if (coachProfile) await coachProfile.cleanup();
  await closeAdminDb();
});

beforeEach(() => {
  transport.reset();
});

describe("enqueueCoachNotification", () => {
  it("writes exactly one booking_request row for a parent single-lesson booking", async () => {
    await cleanAllNotifications();
    const lessonId = await seedLesson({ status: "pending" });

    const result = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "booking_request",
        lessonId,
      }),
    );

    expect(result.notificationId).toBeTruthy();
    const rows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.lessonId, lessonId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.category).toBe("booking_request");
    expect(rows[0]?.tag).toBe(`lesson:${lessonId}`);
    expect(rows[0]?.clickUrl).toContain(`/coach/lessons/${lessonId}`);

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("enforces one request_expiring_soon reminder per lesson across repeated inserts", async () => {
    await cleanAllNotifications();
    const lessonId = await seedLesson({
      status: "pending",
      expiresAt: new Date(Date.now() + 3.5 * 60 * 60 * 1000),
    });

    const first = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "request_expiring_soon",
        lessonId,
        expiresAtLocalDisplay: "Oct 27 at 2:00 PM",
      }),
    );
    expect(first.notificationId).toBeTruthy();

    const second = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "request_expiring_soon",
        lessonId,
        expiresAtLocalDisplay: "Oct 27 at 2:00 PM",
      }),
    );
    expect(second.notificationId).toBeNull();

    const rows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.lessonId, lessonId));
    expect(rows).toHaveLength(1);

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("daily summary unique index enforces one row per coach per LA date", async () => {
    await cleanAllNotifications();
    const payload: DailySummaryPayload = {
      kind: "daily_summary",
      listTitle: "Daily summary",
      dateLocal: "2026-10-27",
      lessonCount: 4,
      firstLessonTimeLocal: "7:30 AM",
      firstLessonPoolName: "Egret Park",
      pendingRequestCount: 2,
      heldAlertCount: 0,
    };
    const first = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "daily_summary",
        dailySummaryPayload: payload,
      }),
    );
    expect(first.notificationId).toBeTruthy();

    const second = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "daily_summary",
        dailySummaryPayload: payload,
      }),
    );
    expect(second.notificationId).toBeNull();
  });
});

describe("sendCoachNotification", () => {
  it("skips with email backup when there are no active subscriptions", async () => {
    await cleanAllNotifications();
    const lessonId = await seedLesson({ status: "pending" });

    // Mirror the coach's email so the backup path can resolve a recipient.
    await adminDb()
      .update(profiles)
      .set({ email: "coach-backup@test.local", emailVerifiedAt: new Date() })
      .where(eq(profiles.id, coachProfile.userId));

    const result = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "booking_request",
        lessonId,
      }),
    );
    expect(result.notificationId).toBeTruthy();
    await sendCoachNotification(result.notificationId!);

    const notificationRows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.id, result.notificationId!));
    expect(notificationRows[0]?.pushStatus).toBe("skipped");
    expect(notificationRows[0]?.pushLastError).toContain("email_backup_queued");

    const outboxRows = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.lessonId, lessonId),
          eq(lessonEmailOutbox.event, "coach_booking_request"),
        ),
      );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.recipientProfileIds).toEqual([coachProfile.userId]);

    // Transport should NOT have been called.
    expect(transport.sends).toHaveLength(0);

    await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.lessonId, lessonId));
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("writes ONE batch email backup row when a batch booking has zero push subscriptions", async () => {
    await cleanAllNotifications();
    // Seed a batch of 3 lessons for the owner household.
    const batchRows = await adminDb()
      .insert(bookingBatches)
      .values({
        householdId: owner.householdId,
        createdBy: owner.userId,
        mode: "manual",
      })
      .returning({ id: bookingBatches.id });
    const batchId = batchRows[0]!.id;
    // 2 / 4 / 6 hours out — all inside the 12-hour bypass window so the
    // sender's email-backup branch runs regardless of wall-clock quiet hours.
    const base = Date.now() + 2 * 60 * 60 * 1000;
    const lessonIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const insertedLesson = await adminDb()
        .insert(lessons)
        .values({
          householdId: owner.householdId,
          locationId,
          startsAt: new Date(base + index * 2 * 60 * 60 * 1000),
          durationMinutes: 30,
          type: "private",
          status: "pending",
          requestedBy: owner.userId,
          batchId,
        })
        .returning({ id: lessons.id });
      const id = insertedLesson[0]!.id;
      lessonIds.push(id);
      await adminDb().insert(lessonSwimmers).values({ lessonId: id, swimmerId });
    }

    // Make the coach's email backup resolve.
    await adminDb()
      .update(profiles)
      .set({ email: "coach-backup@test.local", emailVerifiedAt: new Date() })
      .where(eq(profiles.id, coachProfile.userId));

    const result = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "booking_request",
        batchId,
      }),
    );
    expect(result.notificationId).toBeTruthy();
    await sendCoachNotification(result.notificationId!);

    const notificationRows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.id, result.notificationId!));
    expect(notificationRows[0]?.pushStatus).toBe("skipped");
    expect(notificationRows[0]?.pushLastError).toContain("email_backup_queued");

    // Exactly one coach_booking_request outbox row for the whole batch,
    // not one per lesson.
    const outboxRows = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.batchId, batchId),
          eq(lessonEmailOutbox.event, "coach_booking_request"),
        ),
      );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.recipientProfileIds).toEqual([coachProfile.userId]);
    expect(outboxRows[0]?.lessonId).toBeNull();

    // No per-lesson coach_booking_request rows were written.
    const perLessonBackups = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          inArray(lessonEmailOutbox.lessonId, lessonIds),
          eq(lessonEmailOutbox.event, "coach_booking_request"),
        ),
      );
    expect(perLessonBackups).toHaveLength(0);

    // Clean up: outbox rows before batch, batch before household artifacts.
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.batchId, batchId));
    await adminDb()
      .delete(coachNotifications)
      .where(eq(coachNotifications.id, result.notificationId!));
    await adminDb()
      .delete(lessonSwimmers)
      .where(inArray(lessonSwimmers.lessonId, lessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, lessonIds));
    await adminDb().delete(bookingBatches).where(eq(bookingBatches.id, batchId));
  });

  it("deactivates subscription on 410 Gone but still delivers via a second active subscription", async () => {
    await cleanAllNotifications();
    const lessonId = await seedLesson({ status: "pending" });

    const subRows = await adminDb()
      .insert(coachPushSubscriptions)
      .values([
        {
          profileId: coachProfile.userId,
          endpoint: "https://push.test/endpoint-dead",
          p256dh: "p1",
          auth: "a1",
        },
        {
          profileId: coachProfile.userId,
          endpoint: "https://push.test/endpoint-alive",
          p256dh: "p2",
          auth: "a2",
        },
      ])
      .returning({ id: coachPushSubscriptions.id, endpoint: coachPushSubscriptions.endpoint });

    transport.behaviorByEndpoint.set("https://push.test/endpoint-dead", {
      outcome: "gone",
      statusCode: 410,
      shortError: "gone:410",
    });
    // Alive endpoint uses the default ok.

    const result = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "booking_request",
        lessonId,
      }),
    );
    await sendCoachNotification(result.notificationId!);

    const notification = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.id, result.notificationId!))
      .limit(1);
    expect(notification[0]?.pushStatus).toBe("sent");
    expect(notification[0]?.deliveredSubscriptionCount).toBe(1);

    const deadSub = subRows.find((row) => row.endpoint === "https://push.test/endpoint-dead");
    const aliveSub = subRows.find((row) => row.endpoint === "https://push.test/endpoint-alive");
    const deadRow = await adminDb()
      .select()
      .from(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.id, deadSub!.id))
      .limit(1);
    const aliveRow = await adminDb()
      .select()
      .from(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.id, aliveSub!.id))
      .limit(1);
    expect(deadRow[0]?.isActive).toBe(false);
    expect(deadRow[0]?.removedReason).toBe("gone");
    expect(aliveRow[0]?.isActive).toBe(true);
    expect(aliveRow[0]?.lastDeliveryAt).not.toBeNull();

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(coachPushSubscriptions).where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("VAPID / signature-like failure leaves subscription active and fails the row with backoff", async () => {
    await cleanAllNotifications();
    const lessonId = await seedLesson({ status: "pending" });

    const subRows = await adminDb()
      .insert(coachPushSubscriptions)
      .values({
        profileId: coachProfile.userId,
        endpoint: "https://push.test/endpoint-vapid-bad",
        p256dh: "pbad",
        auth: "abad",
      })
      .returning({ id: coachPushSubscriptions.id });

    transport.behaviorByEndpoint.set("https://push.test/endpoint-vapid-bad", {
      outcome: "fail",
      statusCode: 403,
      shortError: "http_403",
    });

    const result = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "booking_request",
        lessonId,
      }),
    );
    await sendCoachNotification(result.notificationId!);

    const notification = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.id, result.notificationId!))
      .limit(1);
    expect(notification[0]?.pushStatus).toBe("failed");
    expect(notification[0]?.pushAttempts).toBe(1);
    expect(notification[0]?.pushNextAttemptAt).toBeDefined();

    const subRow = await adminDb()
      .select()
      .from(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.id, subRows[0]!.id))
      .limit(1);
    // Critical: subscription stays active even on a signature-type failure.
    expect(subRow[0]?.isActive).toBe(true);
    expect(subRow[0]?.removedReason).toBeNull();
    expect(subRow[0]?.lastFailureAt).not.toBeNull();

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(coachPushSubscriptions).where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });
});

describe("auto_approved_summary push gating", () => {
  // The plan says auto-approved bookings are summary-only by default and
  // only push individually when the coach has flipped autoApprovedMode to
  // 'immediate'. The sender's isCategoryEnabled is the chokepoint; this
  // test exercises it end-to-end against the real DB.

  async function seedAutoApprovedRowAndSubscription(): Promise<{
    notificationId: string;
    lessonId: string;
  }> {
    const lessonId = await seedLesson({ status: "approved" });
    await adminDb().insert(coachPushSubscriptions).values({
      profileId: coachProfile.userId,
      endpoint: "https://push.test/auto-approved-endpoint",
      p256dh: "pp",
      auth: "aa",
    });
    const result = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "auto_approved_summary",
        lessonId,
      }),
    );
    return { notificationId: result.notificationId!, lessonId };
  }

  it("does not push individually when autoApprovedMode is 'summary' (the default)", async () => {
    await cleanAllNotifications();
    const { notificationId, lessonId } = await seedAutoApprovedRowAndSubscription();

    // Default preferences: autoApprovedMode = 'summary'.
    await sendCoachNotification(notificationId);

    expect(transport.sends).toHaveLength(0);
    const rows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.id, notificationId));
    expect(rows[0]?.pushStatus).toBe("skipped");
    expect(rows[0]?.pushLastError).toBe("category_disabled");

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb()
      .delete(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("pushes individually only when the coach flips autoApprovedMode to 'immediate'", async () => {
    await cleanAllNotifications();
    await updateCoachNotificationPreferences(coachProfile.userId, {
      autoApprovedMode: "immediate",
    });
    const { notificationId, lessonId } = await seedAutoApprovedRowAndSubscription();

    await sendCoachNotification(notificationId);

    expect(transport.sends).toHaveLength(1);
    const rows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.id, notificationId));
    expect(rows[0]?.pushStatus).toBe("sent");

    // Reset the preference so later tests see the default.
    await updateCoachNotificationPreferences(coachProfile.userId, {
      autoApprovedMode: "summary",
    });
    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb()
      .delete(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });
});

describe("getOrCreateCoachNotificationPreferences", () => {
  it("lazy-creates the row on first read with sane defaults", async () => {
    await cleanAllNotifications();
    const prefs = await getOrCreateCoachNotificationPreferences(coachProfile.userId);
    expect(prefs.bookingRequestEnabled).toBe(true);
    expect(prefs.bookingRequestEmailBackupEnabled).toBe(true);
    expect(prefs.autoApprovedMode).toBe("summary");
    expect(prefs.dailySummaryEnabled).toBe(true);
    // Postgres returns time as "HH:MM:SS".
    expect(prefs.dailySummaryTimeLocal).toMatch(/^08:00/);
    expect(prefs.quietHoursStartLocal).toMatch(/^21:00/);
    expect(prefs.quietHoursEndLocal).toMatch(/^07:00/);
    expect(prefs.lockScreenDetail).toBe("first_initial");

    // Second read is idempotent — no new row.
    const again = await getOrCreateCoachNotificationPreferences(coachProfile.userId);
    expect(again.profileId).toBe(prefs.profileId);
    const allRows = await adminDb()
      .select()
      .from(coachNotificationPreferences)
      .where(eq(coachNotificationPreferences.profileId, coachProfile.userId));
    expect(allRows).toHaveLength(1);
  });
});

// ADR 031's audit-log rule applied to notifications: the enqueue goes
// inside the same db.transaction() as the state change it records. These
// tests verify both halves of the invariant on real DB code paths, not
// through HTTP (the HTTP routes exercise the same helpers).
describe("notify* stubs are atomic with the lesson transaction", () => {
  it("rolls back the notification when the lesson transaction throws", async () => {
    await cleanAllNotifications();
    // Count rows before — the test proves the delta is 0, not that the
    // table is empty (other suites may share the coach's profile_id).
    const beforeRows = await adminDb()
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(eq(coachNotifications.profileId, coachProfile.userId));

    // Insert a lesson, enqueue the alert in the SAME tx, then force a
    // rollback by throwing. Nothing should persist — not the lesson, not
    // the notification. We assert both.
    const sentinel = "forced rollback for atomicity test";
    let threw: unknown = null;
    const lessonId = crypto.randomUUID();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(lessons).values({
          id: lessonId,
          householdId: owner.householdId,
          locationId,
          startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          durationMinutes: 30,
          type: "private",
          status: "pending",
          requestedBy: owner.userId,
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000 - 16 * 60 * 60 * 1000),
        });
        await tx.insert(lessonSwimmers).values({ lessonId, swimmerId });
        await notifyBookingCreated(tx, lessonId, false);
        throw new Error(sentinel);
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(Error);
    expect((threw as Error).message).toBe(sentinel);

    const lessonRows = await adminDb()
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(lessonRows).toHaveLength(0);

    const afterRows = await adminDb()
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(eq(coachNotifications.profileId, coachProfile.userId));
    expect(afterRows.length).toBe(beforeRows.length);
  });

  it("commits exactly one notification when the lesson transaction commits", async () => {
    await cleanAllNotifications();
    const lessonId = crypto.randomUUID();
    const result = await db.transaction(async (tx) => {
      await tx.insert(lessons).values({
        id: lessonId,
        householdId: owner.householdId,
        locationId,
        startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        durationMinutes: 30,
        type: "private",
        status: "pending",
        requestedBy: owner.userId,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000 - 16 * 60 * 60 * 1000),
      });
      await tx.insert(lessonSwimmers).values({ lessonId, swimmerId });
      return await notifyBookingCreated(tx, lessonId, false);
    });

    expect(result).not.toBeNull();
    const rows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(eq(coachNotifications.lessonId, lessonId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.category).toBe("booking_request");

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("notifyCoachOfChange is also rolled back with its tx", async () => {
    await cleanAllNotifications();
    const lessonId = await seedLesson({ status: "approved" });
    const beforeRows = await adminDb()
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(eq(coachNotifications.profileId, coachProfile.userId));

    let threw: unknown = null;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(lessons)
          .set({ status: "canceled", canceledAt: new Date(), canceledBy: owner.userId })
          .where(eq(lessons.id, lessonId));
        await notifyCoachOfChange(tx, lessonId, "canceled");
        throw new Error("rollback");
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(Error);

    // Lesson status should still be approved — the whole tx rolled back.
    const lessonRow = await adminDb()
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    expect(lessonRow[0]?.status).toBe("approved");

    const afterRows = await adminDb()
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(eq(coachNotifications.profileId, coachProfile.userId));
    expect(afterRows.length).toBe(beforeRows.length);

    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });
});

// ADR 031 says the calendar_disconnected alert row is written inside the
// same transaction as the integration status flip. These tests cover both
// halves of that contract directly against the DB — the real flipper
// (markNeedsReconnect in services/googleCalendarSync.ts) is private, but
// its atomic shape is reproduced here using the same primitives.
describe("calendar_disconnected is atomic with the needs_reconnect flip", () => {
  it("rolls back both the integration flip and the alert row on throw", async () => {
    await cleanAllNotifications();

    // Seed a bare active integration row for the coach (no real token
    // material; the test never calls Google).
    const existing = await adminDb()
      .select({ id: coachCalendarIntegrations.id })
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId))
      .limit(1);
    if (existing.length === 0) {
      await adminDb().insert(coachCalendarIntegrations).values({
        coachProfileId: coachProfile.userId,
        googleAccountEmail: null,
        googleCalendarId: "cal-id-test",
        status: "active",
        scope: null,
      });
    } else {
      await adminDb()
        .update(coachCalendarIntegrations)
        .set({ status: "active", needsReconnectSince: null })
        .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId));
    }

    let threw: unknown = null;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(coachCalendarIntegrations)
          .set({ status: "needs_reconnect", needsReconnectSince: new Date() })
          .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId));
        await enqueueCoachNotification(tx, {
          coachProfileId: coachProfile.userId,
          category: "calendar_disconnected",
          calendarDisconnectedPayload: {
            kind: "calendar_disconnected",
            listTitle: "Google Calendar disconnected",
            needsReconnectSinceUtc: new Date().toISOString(),
          },
        });
        throw new Error("force rollback");
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(Error);

    // Integration should still be active.
    const integrationRow = await adminDb()
      .select({ status: coachCalendarIntegrations.status })
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId))
      .limit(1);
    expect(integrationRow[0]?.status).toBe("active");

    // No calendar_disconnected alert row for this coach.
    const alertRows = await adminDb()
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.profileId, coachProfile.userId),
          eq(coachNotifications.category, "calendar_disconnected"),
        ),
      );
    expect(alertRows).toHaveLength(0);
  });

  it("commits both the integration flip and the alert row together", async () => {
    await cleanAllNotifications();

    const existing = await adminDb()
      .select({ id: coachCalendarIntegrations.id })
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId))
      .limit(1);
    if (existing.length === 0) {
      await adminDb().insert(coachCalendarIntegrations).values({
        coachProfileId: coachProfile.userId,
        googleAccountEmail: null,
        googleCalendarId: "cal-id-test",
        status: "active",
        scope: null,
      });
    } else {
      await adminDb()
        .update(coachCalendarIntegrations)
        .set({ status: "active", needsReconnectSince: null })
        .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId));
    }

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      await tx
        .update(coachCalendarIntegrations)
        .set({ status: "needs_reconnect", needsReconnectSince: now })
        .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId));
      return await enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "calendar_disconnected",
        calendarDisconnectedPayload: {
          kind: "calendar_disconnected",
          listTitle: "Google Calendar disconnected",
          needsReconnectSinceUtc: now.toISOString(),
        },
      });
    });
    expect(result.notificationId).toBeTruthy();

    const integrationRow = await adminDb()
      .select({ status: coachCalendarIntegrations.status })
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId))
      .limit(1);
    expect(integrationRow[0]?.status).toBe("needs_reconnect");

    const alertRows = await adminDb()
      .select()
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.profileId, coachProfile.userId),
          eq(coachNotifications.category, "calendar_disconnected"),
        ),
      );
    expect(alertRows).toHaveLength(1);
    expect(alertRows[0]?.tag).toBe(`calendar-disconnected:${coachProfile.userId}`);

    // Reset the integration row so later test files/suites see 'active'.
    await adminDb()
      .update(coachCalendarIntegrations)
      .set({ status: "active", needsReconnectSince: null })
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfile.userId));
    await adminDb()
      .delete(coachNotifications)
      .where(
        and(
          eq(coachNotifications.profileId, coachProfile.userId),
          eq(coachNotifications.category, "calendar_disconnected"),
        ),
      );
  });
});

// Register-endpoint normalization. The Push API spec says toJSON().keys
// is base64url, but older Safari builds send standard base64. web-push's
// crypto layer rejects standard base64 outright, so the server
// normalizes on write and rejects anything that still isn't base64url
// after normalization.
describe("POST /coach/push/subscriptions — key normalization", () => {
  const app = createApp(pino({ level: "silent" }));

  beforeEach(async () => {
    await adminDb()
      .delete(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
  });

  it("rewrites standard-base64 keys to base64url and sends with the normalized values", async () => {
    const standardP256dh = "aGVsbG8rLy93b3JsZA==";
    const standardAuth = "QS9CKzE=";

    const res = await request(app)
      .post("/coach/push/subscriptions")
      .set("Authorization", `Bearer ${coachProfile.accessToken}`)
      .send({
        endpoint: "https://push.test/normalize-endpoint",
        keys: { p256dh: standardP256dh, auth: standardAuth },
      });
    expect(res.status).toBe(201);

    const rows = await adminDb()
      .select()
      .from(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("aGVsbG8rLy93b3JsZA");
    expect(rows[0]?.auth).toBe("QS9CKzE");

    // Drive a push with the capture transport (set up in beforeAll) and
    // confirm the sender hands web-push the normalized values — this is
    // what web-push would have refused with "Unsupported characters set"
    // before the fix.
    const lessonId = await seedLesson({ status: "pending" });
    const enqueue = await db.transaction(async (tx) =>
      enqueueCoachNotification(tx, {
        coachProfileId: coachProfile.userId,
        category: "booking_request",
        lessonId,
      }),
    );
    await sendCoachNotification(enqueue.notificationId!);
    expect(transport.sends).toHaveLength(1);
    expect(transport.sends[0]?.sub.p256dh).toBe("aGVsbG8rLy93b3JsZA");
    expect(transport.sends[0]?.sub.auth).toBe("QS9CKzE");

    await adminDb().delete(coachNotifications).where(eq(coachNotifications.lessonId, lessonId));
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  });

  it("rejects a key with characters outside the base64 alphabet (422)", async () => {
    const res = await request(app)
      .post("/coach/push/subscriptions")
      .set("Authorization", `Bearer ${coachProfile.accessToken}`)
      .send({
        endpoint: "https://push.test/bad-key-endpoint",
        keys: { p256dh: "has spaces and $ignals", auth: "AAAA" },
      });
    expect(res.status).toBe(422);

    const rows = await adminDb()
      .select()
      .from(coachPushSubscriptions)
      .where(eq(coachPushSubscriptions.profileId, coachProfile.userId));
    expect(rows).toHaveLength(0);
  });
});
