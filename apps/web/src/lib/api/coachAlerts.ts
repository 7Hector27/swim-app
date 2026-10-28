// Client-side helpers for the coach alerts endpoints. All go through the
// web app's thin proxies at /api/coach/* so the Supabase session cookie
// does the auth and the browser never handles the bearer token.
//
// Parsers are Zod-shaped at the call site; this file keeps the fetches.

import {
  CoachNotificationListResponseSchema,
  CoachNotificationPreferencesSchema,
  CoachNotificationUnreadCountResponseSchema,
  CoachPushSubscriptionListResponseSchema,
  type CoachNotificationListResponse,
  type CoachNotificationPreferences,
  type CoachNotificationPreferencesPatch,
  type CoachNotificationUnreadCountResponse,
  type CoachPushSubscriptionListResponse,
} from "@swim-app/shared";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

async function parseOr502<T>(
  response: Response,
  parse: (body: unknown) => { success: boolean; data?: T },
): Promise<ApiResult<T>> {
  if (!response.ok) return { ok: false, status: response.status };
  const body: unknown = await response.json().catch(() => null);
  const parsed = parse(body);
  if (!parsed.success || parsed.data === undefined) {
    return { ok: false, status: 502 };
  }
  return { ok: true, data: parsed.data };
}

export async function fetchPushSubscriptions(): Promise<ApiResult<CoachPushSubscriptionListResponse>> {
  const response = await fetch("/api/coach/push/subscriptions", { cache: "no-store" });
  return parseOr502(response, (body) =>
    CoachPushSubscriptionListResponseSchema.safeParse(body),
  );
}

export async function registerPushSubscription(
  subscription: PushSubscriptionJSON,
): Promise<{ ok: boolean; status: number }> {
  const endpoint = subscription.endpoint ?? "";
  const keys = subscription.keys ?? { p256dh: "", auth: "" };
  const response = await fetch("/api/coach/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, keys }),
  });
  return { ok: response.ok, status: response.status };
}

export async function deletePushSubscription(id: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(`/api/coach/push/subscriptions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return { ok: response.ok, status: response.status };
}

export async function sendTestPush(): Promise<{ ok: boolean; status: number }> {
  const response = await fetch("/api/coach/push/test", { method: "POST" });
  return { ok: response.ok, status: response.status };
}

export async function fetchNotifications(): Promise<ApiResult<CoachNotificationListResponse>> {
  const response = await fetch("/api/coach/notifications", { cache: "no-store" });
  return parseOr502(response, (body) => CoachNotificationListResponseSchema.safeParse(body));
}

export async function fetchUnreadCount(): Promise<ApiResult<CoachNotificationUnreadCountResponse>> {
  const response = await fetch("/api/coach/notifications/unread-count", { cache: "no-store" });
  return parseOr502(response, (body) =>
    CoachNotificationUnreadCountResponseSchema.safeParse(body),
  );
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(
    `/api/coach/notifications/${encodeURIComponent(id)}/read`,
    { method: "POST" },
  );
  return { ok: response.ok, status: response.status };
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean; status: number }> {
  const response = await fetch("/api/coach/notifications/read-all", { method: "POST" });
  return { ok: response.ok, status: response.status };
}

export async function fetchNotificationPreferences(): Promise<ApiResult<CoachNotificationPreferences>> {
  const response = await fetch("/api/coach/notifications/preferences", { cache: "no-store" });
  return parseOr502(response, (body) => CoachNotificationPreferencesSchema.safeParse(body));
}

export async function patchNotificationPreferences(
  patch: CoachNotificationPreferencesPatch,
): Promise<ApiResult<CoachNotificationPreferences>> {
  const response = await fetch("/api/coach/notifications/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return parseOr502(response, (body) => CoachNotificationPreferencesSchema.safeParse(body));
}
