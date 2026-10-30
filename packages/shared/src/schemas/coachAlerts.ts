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
//
// Keys arrive from `PushSubscription.toJSON().keys`. The Push API spec
// says this is base64url, but older Safari builds and some polyfilled
// callers send standard base64 (`+`, `/`, padding `=`). web-push's
// crypto layer only accepts base64url and raises "Unsupported characters
// set use the URL or filename-safe Base64 characters set" for standard
// base64, so we normalize up front and then validate the shape — any
// character outside the base64url alphabet after normalization is a bug
// in the caller and we reject it.
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function normalizeBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const SubscriptionKeySchema = z
  .string()
  .min(1)
  .transform(normalizeBase64Url)
  .refine((value) => BASE64URL_RE.test(value), {
    message: "must be base64 or base64url (chars [A-Za-z0-9_/+-], optional '=' padding)",
  });

export const CoachPushSubscriptionRegisterSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: SubscriptionKeySchema,
    auth: SubscriptionKeySchema,
  }),
});
export type CoachPushSubscriptionRegister = z.infer<typeof CoachPushSubscriptionRegisterSchema>;

// Exported so the one-time migration backfill and the API test fixtures
// can run the same transform the HTTP endpoint uses. Keep it a pure
// function — any divergence from the Zod transform silently drifts the
// migration away from the live write path.
export { normalizeBase64Url as normalizeSubscriptionKey };

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
