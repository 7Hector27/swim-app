import { z } from "zod";

// Coach alert categories (ADR 031).
export const CoachNotificationCategorySchema = z.enum([
  "booking_request",
  "request_expiring_soon",
  "parent_change",
  "calendar_disconnected",
  "auto_approved_summary",
  "daily_summary",
]);
export type CoachNotificationCategory = z.infer<typeof CoachNotificationCategorySchema>;

export const CoachNotificationUrgencySchema = z.enum(["standard", "urgent"]);
export type CoachNotificationUrgency = z.infer<typeof CoachNotificationUrgencySchema>;

// In-app list row shape. Phase 2 renders rows against this. Scrubbed rows
// surface with `scrubbed=true` so the client renders a "No longer available"
// row without a working deep link.
export const CoachNotificationListItemSchema = z.object({
  id: z.string().uuid(),
  category: CoachNotificationCategorySchema,
  urgency: CoachNotificationUrgencySchema,
  title: z.string(),
  body: z.string(),
  clickUrl: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  lessonId: z.string().uuid().nullable(),
  batchId: z.string().uuid().nullable(),
  scrubbed: z.boolean(),
});
export type CoachNotificationListItem = z.infer<typeof CoachNotificationListItemSchema>;

export const CoachNotificationListResponseSchema = z.object({
  items: z.array(CoachNotificationListItemSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type CoachNotificationListResponse = z.infer<typeof CoachNotificationListResponseSchema>;

export const CoachNotificationUnreadCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type CoachNotificationUnreadCountResponse = z.infer<typeof CoachNotificationUnreadCountResponseSchema>;

// Register endpoint body matches browser PushSubscription.toJSON() so the
// client passes the subscription through unchanged.
export const CoachPushSubscriptionRegisterSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type CoachPushSubscriptionRegister = z.infer<typeof CoachPushSubscriptionRegisterSchema>;

export const CoachPushSubscriptionListItemSchema = z.object({
  id: z.string().uuid(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastDeliveryAt: z.string().nullable(),
});
export type CoachPushSubscriptionListItem = z.infer<typeof CoachPushSubscriptionListItemSchema>;

export const CoachPushSubscriptionListResponseSchema = z.object({
  items: z.array(CoachPushSubscriptionListItemSchema),
});
export type CoachPushSubscriptionListResponse = z.infer<typeof CoachPushSubscriptionListResponseSchema>;

// Lock-screen detail options.
export const LockScreenDetailSchema = z.enum(["first_initial", "full_name"]);
export type LockScreenDetail = z.infer<typeof LockScreenDetailSchema>;

export const AutoApprovedModeSchema = z.enum(["off", "summary", "immediate"]);
export type AutoApprovedMode = z.infer<typeof AutoApprovedModeSchema>;

// LA wall time "HH:MM" or "HH:MM:SS". The DB stores a Postgres `time` which
// pg returns as "HH:MM:SS"; the client sends "HH:MM". Both match.
const WallTimeSchema = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/);

export const CoachNotificationPreferencesSchema = z.object({
  bookingRequestEnabled: z.boolean(),
  bookingRequestEmailBackupEnabled: z.boolean(),
  requestExpiringSoonEnabled: z.boolean(),
  parentChangeEnabled: z.boolean(),
  autoApprovedMode: AutoApprovedModeSchema,
  dailySummaryEnabled: z.boolean(),
  dailySummaryTimeLocal: WallTimeSchema,
  quietHoursEnabled: z.boolean(),
  quietHoursStartLocal: WallTimeSchema,
  quietHoursEndLocal: WallTimeSchema,
  lockScreenDetail: LockScreenDetailSchema,
});
export type CoachNotificationPreferences = z.infer<typeof CoachNotificationPreferencesSchema>;

// All fields optional for PATCH /coach/notifications/preferences.
export const CoachNotificationPreferencesPatchSchema =
  CoachNotificationPreferencesSchema.partial();
export type CoachNotificationPreferencesPatch = z.infer<typeof CoachNotificationPreferencesPatchSchema>;
