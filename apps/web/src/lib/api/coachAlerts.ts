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
  CoachPushTestResponseSchema,
  type CoachNotificationListResponse,
  type CoachNotificationPreferences,
  type CoachNotificationPreferencesPatch,
  type CoachNotificationUnreadCountResponse,
  type CoachPushSubscriptionListResponse,
  type CoachPushTestResponse,
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

export type SendTestPushResult =
  | { ok: true; data: CoachPushTestResponse }
  // Status may be 0 when the proxy fetch fails before a response is formed
  // (dev-only misconfig). The reason string is always safe to render.
  | { ok: false; status: number; reason: string };

export async function sendTestPush(): Promise<SendTestPushResult> {
  let response: Response;
  try {
    response = await fetch("/api/coach/push/test", { method: "POST" });
  } catch {
    return { ok: false, status: 0, reason: "Could not reach the server." };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason =
      body !== null && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Could not send a test notification.";
    return { ok: false, status: response.status, reason };
  }
  const parsed = CoachPushTestResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, status: 502, reason: "The server returned an unexpected response." };
  }
  return { ok: true, data: parsed.data };
}

export interface FetchNotificationsOptions {
  order?: "unread_first" | "chronological";
  offset?: number;
  limit?: number;
}

export async function fetchNotifications(
  options: FetchNotificationsOptions = {},
): Promise<ApiResult<CoachNotificationListResponse>> {
  const params = new URLSearchParams();
  if (options.order) params.set("order", options.order);
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString();
  const response = await fetch(
    `/api/coach/notifications${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
  return parseOr502(response, (body) => CoachNotificationListResponseSchema.safeParse(body));
}

export async function fetchUnreadCount(): Promise<ApiResult<CoachNotificationUnreadCountResponse>> {
  const response = await fetch("/api/coach/notifications/unread-count", { cache: "no-store" });
  return parseOr502(response, (body) =>
    CoachNotificationUnreadCountResponseSchema.safeParse(body),
  );
}

// Browser-level event dispatched after a mark-read mutation so any
// listener on the current page (in practice the bell) refreshes its
// badge immediately instead of waiting for the next 60-second poll.
// Fires on both success and failure; listeners re-query the server and
// let that reconcile.
export const COACH_NOTIFICATIONS_CHANGED_EVENT = "coach-notifications:changed";

function notifyNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COACH_NOTIFICATIONS_CHANGED_EVENT));
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(
    `/api/coach/notifications/${encodeURIComponent(id)}/read`,
    { method: "POST" },
  );
  notifyNotificationsChanged();
  return { ok: response.ok, status: response.status };
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean; status: number }> {
  const response = await fetch("/api/coach/notifications/read-all", { method: "POST" });
  notifyNotificationsChanged();
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
