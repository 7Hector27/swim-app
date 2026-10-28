// Thin wrapper around the `web-push` library. Isolated here so the sender
// can mock the transport at the module boundary without pulling in a Web
// Push dependency during unit tests. The only non-trivial logic is the
// classification of errors: 404/410 → deactivate the subscription;
// anything else → fail the send with backoff and keep the subscription
// active. See ADR 031.

import webpush, { type PushSubscription as WebPushSubscription, type RequestOptions } from "web-push";

import { getEnv } from "../../lib/env";

export type PushResultOutcome =
  | "ok"
  // 404/410 — subscription gone. The sender flips `is_active = false`
  // with `removed_reason = 'gone'`.
  | "gone"
  // Everything else: VAPID / signature errors, 400, 403, 413, 429, 5xx,
  // network errors. The sender records the failure on the subscription row
  // but does NOT deactivate it, and the alert row goes to 'failed' with
  // backoff. Decision in ADR 031 revision 5.
  | "fail";

export interface PushAttemptResult {
  outcome: PushResultOutcome;
  statusCode: number | null;
  // Short, log-safe string describing the error. Never contains endpoint
  // URLs or payload content.
  shortError: string | null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushBody {
  title: string;
  body: string;
  tag: string;
  click_url: string;
  urgency: "standard" | "urgent";
}

export interface PushTransport {
  send(
    subscription: PushSubscriptionInput,
    body: PushBody,
  ): Promise<PushAttemptResult>;
}

let cachedConfigured = false;

function ensureConfigured(): boolean {
  if (cachedConfigured) return true;
  const vapid = getEnv().vapid;
  if (!vapid) return false;
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  cachedConfigured = true;
  return true;
}

export function __resetPushTransportForTests(): void {
  cachedConfigured = false;
}

export function createPushTransport(): PushTransport | null {
  if (!ensureConfigured()) return null;
  return {
    async send(subscription, pushBody) {
      const payload = JSON.stringify(pushBody);
      const sub: WebPushSubscription = {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      };
      const options: RequestOptions = {
        TTL: pushBody.urgency === "urgent" ? 60 : 86400,
        urgency: pushBody.urgency === "urgent" ? "high" : "normal",
        topic: pushBody.tag,
      };
      try {
        await webpush.sendNotification(sub, payload, options);
        return { outcome: "ok", statusCode: 201, shortError: null };
      } catch (err) {
        return classifyError(err);
      }
    },
  };
}

function classifyError(err: unknown): PushAttemptResult {
  // web-push throws WebPushError with .statusCode on push-service responses.
  const statusCode = extractStatusCode(err);
  if (statusCode === 404 || statusCode === 410) {
    return {
      outcome: "gone",
      statusCode,
      shortError: `gone:${statusCode}`,
    };
  }
  const kind = statusCode ? `http_${statusCode}` : classifyNonHttp(err);
  return {
    outcome: "fail",
    statusCode,
    shortError: kind,
  };
}

function extractStatusCode(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const maybe = err as { statusCode?: unknown };
  if (typeof maybe.statusCode === "number") return maybe.statusCode;
  return null;
}

function classifyNonHttp(err: unknown): string {
  if (!err || typeof err !== "object") return "unknown";
  const maybeName = (err as { name?: unknown }).name;
  if (typeof maybeName === "string" && maybeName.length > 0) {
    return maybeName.slice(0, 60);
  }
  return "unknown";
}
