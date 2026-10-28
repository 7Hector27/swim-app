// Coach alerts HTTP surface — phase 2 of ADR 031. Three concerns:
//
// 1. Push subscriptions: register / list / remove / test. The register
//    endpoint upserts on (profile_id, endpoint) because the browser may
//    hand us the same subscription twice (idempotent on reload, revives a
//    row the coach removed from a different tab).
// 2. In-app notification list: list (unread-first), unread count, mark
//    one read, mark all read.
// 3. Per-coach preferences: get and patch. Reads lazily create the row via
//    getOrCreateCoachNotificationPreferences — same helper the sender uses.
//
// Auth: /coach/* already runs requireUser + requireCoach once in
// routes/coach.ts. These handlers trust req.profile.id.
//
// Response shapes: validated against the Zod schemas in
// packages/shared/src/schemas/coachAlerts.ts so the web client can parse
// the responses with the same schema.

import { Router } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  CoachNotificationListResponseSchema,
  CoachNotificationPreferencesPatchSchema,
  CoachNotificationUnreadCountResponseSchema,
  CoachPushSubscriptionListResponseSchema,
  CoachPushSubscriptionRegisterSchema,
  type CoachNotificationListItem,
  type CoachNotificationListResponse,
  type CoachNotificationPreferences,
  type CoachPushSubscriptionListItem,
  type CoachPushSubscriptionRegister,
} from "@swim-app/shared";
import { z } from "zod";

import { db } from "../db/client";
import {
  coachNotifications,
  coachPushSubscriptions,
} from "../db/schema";
import { getEnv } from "../lib/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import {
  getOrCreateCoachNotificationPreferences,
  readCoachNotificationPreferences,
  updateCoachNotificationPreferences,
} from "../services/notifications/preferences";
import { createPushTransport } from "../services/notifications/pushTransport";
import { renderPushBody } from "../services/notifications/renderPushBody";
import type { CoachNotificationPayload } from "../services/notifications/types";

export const coachAlertsRouter = Router();

// ── Push subscriptions ───────────────────────────────────────────────────────

coachAlertsRouter.post(
  "/push/subscriptions",
  validate({ body: CoachPushSubscriptionRegisterSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CoachPushSubscriptionRegister;
    const userAgent = (req.get("user-agent") ?? "").slice(0, 200) || null;

    // Upsert on (profile_id, endpoint): same browser re-subscribing should
    // land on the same row with fresh keys and is_active=true. If the coach
    // "removed" a device on /account and the browser re-registers, we
    // revive it rather than keeping a dead ghost.
    await db
      .insert(coachPushSubscriptions)
      .values({
        profileId: req.profile.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent,
        isActive: true,
        removedReason: null,
      })
      .onConflictDoUpdate({
        target: [coachPushSubscriptions.profileId, coachPushSubscriptions.endpoint],
        set: {
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          userAgent,
          isActive: true,
          removedReason: null,
          lastFailureAt: null,
          updatedAt: sql`now()`,
        },
      });

    res.status(201).end();
  }),
);

coachAlertsRouter.get(
  "/push/subscriptions",
  validate({}),
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: coachPushSubscriptions.id,
        userAgent: coachPushSubscriptions.userAgent,
        createdAt: coachPushSubscriptions.createdAt,
        lastDeliveryAt: coachPushSubscriptions.lastDeliveryAt,
      })
      .from(coachPushSubscriptions)
      .where(
        and(
          eq(coachPushSubscriptions.profileId, req.profile.id),
          eq(coachPushSubscriptions.isActive, true),
        ),
      )
      .orderBy(desc(coachPushSubscriptions.createdAt));

    const items: CoachPushSubscriptionListItem[] = rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    }));
    const parsed = CoachPushSubscriptionListResponseSchema.parse({ items });
    res.json(parsed);
  }),
);

const UuidParamsSchema = z.object({ id: z.string().uuid() });
type UuidParams = z.infer<typeof UuidParamsSchema>;

coachAlertsRouter.delete(
  "/push/subscriptions/:id",
  validate({ params: UuidParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as UuidParams;
    const result = await db
      .update(coachPushSubscriptions)
      .set({
        isActive: false,
        removedReason: "coach_disabled",
      })
      .where(
        and(
          eq(coachPushSubscriptions.id, id),
          eq(coachPushSubscriptions.profileId, req.profile.id),
          eq(coachPushSubscriptions.isActive, true),
        ),
      )
      .returning({ id: coachPushSubscriptions.id });

    if (result.length === 0) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    res.status(204).end();
  }),
);

coachAlertsRouter.post(
  "/push/test",
  validate({}),
  asyncHandler(async (req, res) => {
    const env = getEnv();
    if (!env.vapid) {
      res.status(503).json({ error: "Push notifications are not configured on the server" });
      return;
    }

    const subscriptions = await db
      .select({
        id: coachPushSubscriptions.id,
        endpoint: coachPushSubscriptions.endpoint,
        p256dh: coachPushSubscriptions.p256dh,
        auth: coachPushSubscriptions.auth,
      })
      .from(coachPushSubscriptions)
      .where(
        and(
          eq(coachPushSubscriptions.profileId, req.profile.id),
          eq(coachPushSubscriptions.isActive, true),
        ),
      );
    if (subscriptions.length === 0) {
      res.status(404).json({ error: "No active push subscriptions. Enable notifications first." });
      return;
    }

    const transport = createPushTransport();
    if (!transport) {
      res.status(503).json({ error: "Push transport is not available" });
      return;
    }

    // Direct push, bypassing the outbox — a test should not clutter the
    // in-app notification list or persist as a row. Fan out sequentially,
    // same shape as the sender. 404/410 deactivates the subscription;
    // other failures leave it alone.
    const pushBody = {
      title: "Test notification",
      body: "If you see this, push alerts are working.",
      tag: `test:${req.profile.id}`,
      click_url: "/account",
      urgency: "standard" as const,
    };
    const now = new Date();
    let deliveredCount = 0;
    for (const subscription of subscriptions) {
      const result = await transport.send(subscription, pushBody);
      if (result.outcome === "ok") {
        deliveredCount++;
        await db
          .update(coachPushSubscriptions)
          .set({ lastDeliveryAt: now })
          .where(eq(coachPushSubscriptions.id, subscription.id));
      } else if (result.outcome === "gone") {
        await db
          .update(coachPushSubscriptions)
          .set({
            isActive: false,
            removedReason: "gone",
            lastFailureAt: now,
          })
          .where(eq(coachPushSubscriptions.id, subscription.id));
      } else {
        await db
          .update(coachPushSubscriptions)
          .set({ lastFailureAt: now })
          .where(eq(coachPushSubscriptions.id, subscription.id));
        req.log.error(
          {
            subscriptionId: subscription.id,
            statusCode: result.statusCode,
            error: result.shortError,
          },
          "coach-alerts test push failed",
        );
      }
    }

    res.json({ deliveredCount, subscriptionCount: subscriptions.length });
  }),
);

// ── In-app notification list ─────────────────────────────────────────────────

// 20 items is a dropdown page. The full /coach/notifications page re-queries
// with the same endpoint — in v1 it also caps at 20; pagination is a
// follow-up. The sort order (`read_at NULLS FIRST, created_at DESC`) matches
// the partial index coach_notifications_list_idx.
const LIST_LIMIT = 20;

coachAlertsRouter.get(
  "/notifications",
  validate({}),
  asyncHandler(async (req, res) => {
    // Read-only — a notifications list fetch should never create a
    // preferences row. Only PATCH /notifications/preferences and the
    // sender write. See services/notifications/preferences.ts.
    const prefs = await readCoachNotificationPreferences(req.profile.id);

    const rows = await db
      .select({
        id: coachNotifications.id,
        category: coachNotifications.category,
        urgency: coachNotifications.urgency,
        payload: coachNotifications.payload,
        clickUrl: coachNotifications.clickUrl,
        createdAt: coachNotifications.createdAt,
        readAt: coachNotifications.readAt,
        lessonId: coachNotifications.lessonId,
        batchId: coachNotifications.batchId,
      })
      .from(coachNotifications)
      .where(eq(coachNotifications.profileId, req.profile.id))
      .orderBy(sql`${coachNotifications.readAt} IS NULL DESC`, desc(coachNotifications.createdAt))
      .limit(LIST_LIMIT);

    const unreadCountRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.profileId, req.profile.id),
          isNull(coachNotifications.readAt),
        ),
      );
    const unreadCount = Number(unreadCountRows[0]?.count ?? 0);

    const items: CoachNotificationListItem[] = rows.map((row) =>
      buildListItem(row, prefs.lockScreenDetail),
    );

    const body: CoachNotificationListResponse = { items, unreadCount };
    res.json(CoachNotificationListResponseSchema.parse(body));
  }),
);

coachAlertsRouter.get(
  "/notifications/unread-count",
  validate({}),
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.profileId, req.profile.id),
          isNull(coachNotifications.readAt),
        ),
      );
    const body = { count: Number(rows[0]?.count ?? 0) };
    res.json(CoachNotificationUnreadCountResponseSchema.parse(body));
  }),
);

coachAlertsRouter.post(
  "/notifications/read-all",
  validate({}),
  asyncHandler(async (req, res) => {
    await db
      .update(coachNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(coachNotifications.profileId, req.profile.id),
          isNull(coachNotifications.readAt),
        ),
      );
    res.status(204).end();
  }),
);

coachAlertsRouter.post(
  "/notifications/:id/read",
  validate({ params: UuidParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as UuidParams;
    const result = await db
      .update(coachNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(coachNotifications.id, id),
          eq(coachNotifications.profileId, req.profile.id),
          isNull(coachNotifications.readAt),
        ),
      )
      .returning({ id: coachNotifications.id });

    // Idempotent: a row that's already read, or a row the coach never
    // owned, both return 204. The client's "mark read on click" fires once
    // per tap and a double-tap shouldn't 404.
    if (result.length === 0) {
      // Still verify the row belongs to this coach so we don't lie about a
      // foreign id.
      const exists = await db
        .select({ id: coachNotifications.id })
        .from(coachNotifications)
        .where(
          and(
            eq(coachNotifications.id, id),
            eq(coachNotifications.profileId, req.profile.id),
          ),
        )
        .limit(1);
      if (exists.length === 0) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }
    }

    res.status(204).end();
  }),
);

// ── Preferences ──────────────────────────────────────────────────────────────

coachAlertsRouter.get(
  "/notifications/preferences",
  validate({}),
  asyncHandler(async (req, res) => {
    const prefs = await getOrCreateCoachNotificationPreferences(req.profile.id);
    res.json(toPreferencesResponse(prefs));
  }),
);

coachAlertsRouter.patch(
  "/notifications/preferences",
  validate({ body: CoachNotificationPreferencesPatchSchema }),
  asyncHandler(async (req, res) => {
    const patch = req.body as Partial<CoachNotificationPreferences>;
    // The DB stores Postgres `time` which comes back as "HH:MM:SS"; the
    // client may send "HH:MM". Normalize up-front so the DB sees a
    // consistent shape.
    const normalized: Partial<CoachNotificationPreferences> = { ...patch };
    if (patch.dailySummaryTimeLocal) normalized.dailySummaryTimeLocal = normalizeWallTime(patch.dailySummaryTimeLocal);
    if (patch.quietHoursStartLocal) normalized.quietHoursStartLocal = normalizeWallTime(patch.quietHoursStartLocal);
    if (patch.quietHoursEndLocal) normalized.quietHoursEndLocal = normalizeWallTime(patch.quietHoursEndLocal);

    const updated = await updateCoachNotificationPreferences(req.profile.id, normalized);
    res.json(toPreferencesResponse(updated));
  }),
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeWallTime(value: string): string {
  // Accept "HH:MM" or "HH:MM:SS"; strip to "HH:MM:SS" for DB.
  return value.length === 5 ? `${value}:00` : value;
}

interface PreferencesLike {
  bookingRequestEnabled: boolean;
  bookingRequestEmailBackupEnabled: boolean;
  requestExpiringSoonEnabled: boolean;
  parentChangeEnabled: boolean;
  autoApprovedMode: "off" | "summary" | "immediate";
  dailySummaryEnabled: boolean;
  dailySummaryTimeLocal: string;
  quietHoursEnabled: boolean;
  quietHoursStartLocal: string;
  quietHoursEndLocal: string;
  lockScreenDetail: "first_initial" | "full_name";
}

function toPreferencesResponse(row: PreferencesLike): CoachNotificationPreferences {
  return {
    bookingRequestEnabled: row.bookingRequestEnabled,
    bookingRequestEmailBackupEnabled: row.bookingRequestEmailBackupEnabled,
    requestExpiringSoonEnabled: row.requestExpiringSoonEnabled,
    parentChangeEnabled: row.parentChangeEnabled,
    autoApprovedMode: row.autoApprovedMode,
    dailySummaryEnabled: row.dailySummaryEnabled,
    dailySummaryTimeLocal: row.dailySummaryTimeLocal,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStartLocal: row.quietHoursStartLocal,
    quietHoursEndLocal: row.quietHoursEndLocal,
    lockScreenDetail: row.lockScreenDetail,
  };
}

interface ListRowInput {
  id: string;
  category: string;
  urgency: string;
  payload: unknown;
  clickUrl: string;
  createdAt: Date;
  readAt: Date | null;
  lessonId: string | null;
  batchId: string | null;
}

function buildListItem(
  row: ListRowInput,
  lockScreenDetail: "first_initial" | "full_name",
): CoachNotificationListItem {
  const scrubbed = isScrubbedPayload(row.payload);
  if (scrubbed) {
    return {
      id: row.id,
      category: row.category as CoachNotificationListItem["category"],
      urgency: row.urgency as CoachNotificationListItem["urgency"],
      title: categoryFallbackLabel(row.category),
      // Short-form of the created date — enough to anchor the row in time
      // without implying any surviving detail.
      body: `No longer available · ${row.createdAt.toISOString().slice(0, 10)}`,
      clickUrl: "",
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      lessonId: row.lessonId,
      batchId: row.batchId,
      scrubbed: true,
    };
  }

  const payload = row.payload as CoachNotificationPayload;
  const rendered = renderPushBody(payload, lockScreenDetail);
  // Prefer the payload's listTitle for in-app rows (it's the short label
  // enqueueCoachNotification composes at write time). Fall back to the
  // push title the renderer returns.
  const title = "listTitle" in payload && typeof payload.listTitle === "string"
    ? payload.listTitle
    : rendered.title;
  return {
    id: row.id,
    category: row.category as CoachNotificationListItem["category"],
    urgency: row.urgency as CoachNotificationListItem["urgency"],
    title,
    body: rendered.body,
    clickUrl: row.clickUrl,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    lessonId: row.lessonId,
    batchId: row.batchId,
    scrubbed: false,
  };
}

function isScrubbedPayload(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === "object" &&
    "_scrubbed_at" in payload
  );
}

function categoryFallbackLabel(category: string): string {
  switch (category) {
    case "booking_request":
      return "Booking request";
    case "request_expiring_soon":
      return "Request expiring";
    case "parent_change":
      return "Lesson change";
    case "calendar_disconnected":
      return "Calendar disconnected";
    case "auto_approved_summary":
      return "Auto-approved booking";
    case "daily_summary":
      return "Daily summary";
    default:
      return "Notification";
  }
}
