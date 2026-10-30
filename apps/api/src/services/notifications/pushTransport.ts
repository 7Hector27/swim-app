// Thin wrapper around the `web-push` library. Isolated here so the sender
// can mock the transport at the module boundary without pulling in a Web
// Push dependency during unit tests. The only non-trivial logic is the
// classification of errors: 404/410 → deactivate the subscription;
// anything else → fail the send with backoff and keep the subscription
// active. See ADR 031.

import { createHash } from "node:crypto";

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
  // Full structured detail for logging. Redacted of URLs and long base64url
  // tokens so it is safe to drop into req.log without further scrubbing.
  // Null on success.
  logDetail: PushErrorLogDetail | null;
}

export interface PushErrorLogDetail {
  errorName: string | null;
  errorMessage: string | null;
  // Node network / fs error code (ENETUNREACH, ETIMEDOUT, ENOTFOUND, …).
  errorCode: string | null;
  statusCode: number | null;
  // web-push's WebPushError includes the response body from the push
  // service — e.g. "Unauthorized Registration" or a JSON error blob.
  // Capped and redacted.
  bodyPreview: string | null;
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
  // Optional push-service Topic header. web-push validates this against
  // `/^[A-Za-z0-9_-]+$/` and rejects anything over 32 chars, so callers
  // must pass a sanitized value (see tagToTopic). Omit to skip the header
  // entirely — safe for one-off sends like the test notification where
  // push-service dedup is not wanted.
  topic?: string;
}

// Build a web-push-safe Topic from a payload tag. The payload tag can
// contain colons and arbitrary length (e.g. "lesson:<uuid>",
// "daily-summary:2026-10-30"); the Topic header cannot. Hash + base64url
// gives a deterministic 32-char token that stays inside the allowed
// alphabet, so the same tag always resolves to the same topic (push-service
// dedup still works) without ever triggering web-push's character check.
export function tagToTopic(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32);
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

// Called from the API boot sequence (index.ts) so a malformed VAPID
// subject, key, or public/private mismatch stops the server with a
// readable error instead of surfacing per-request as an opaque "Error"
// at send time. No-op in local without VAPID env — matches the sender's
// no-op behavior and keeps `pnpm dev` working with a bare .env.
export class VapidStartupError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "VapidStartupError";
    this.cause = cause;
  }
}

export function validateVapidAtStartup(): void {
  const vapid = getEnv().vapid;
  if (!vapid) return;
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    cachedConfigured = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new VapidStartupError(
      `VAPID configuration is invalid: web-push rejected the subject or keys at startup — ${message}`,
      err,
    );
  }
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
        ...(pushBody.topic !== undefined && { topic: pushBody.topic }),
      };
      try {
        await webpush.sendNotification(sub, payload, options);
        return { outcome: "ok", statusCode: 201, shortError: null, logDetail: null };
      } catch (err) {
        return classifyError(err);
      }
    },
  };
}

function classifyError(err: unknown): PushAttemptResult {
  const detail = extractLogDetail(err);
  const statusCode = detail.statusCode;
  if (statusCode === 404 || statusCode === 410) {
    return {
      outcome: "gone",
      statusCode,
      shortError: `gone:${statusCode}`,
      logDetail: detail,
    };
  }
  const kind = statusCode ? `http_${statusCode}` : classifyNonHttp(err, detail);
  return {
    outcome: "fail",
    statusCode,
    shortError: kind,
    logDetail: detail,
  };
}

function extractLogDetail(err: unknown): PushErrorLogDetail {
  if (!err || typeof err !== "object") {
    return {
      errorName: typeof err === "string" ? "string" : null,
      errorMessage: typeof err === "string" ? redactSecrets(err).slice(0, 500) : null,
      errorCode: null,
      statusCode: null,
      bodyPreview: null,
    };
  }
  const obj = err as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.slice(0, 100) : null;
  const rawMessage = typeof obj.message === "string" ? obj.message : null;
  const message = rawMessage ? redactSecrets(rawMessage).slice(0, 500) : null;
  const code = typeof obj.code === "string" ? obj.code.slice(0, 60) : null;
  const statusCode = typeof obj.statusCode === "number" ? obj.statusCode : null;
  // WebPushError.body is a string. Guard the shape anyway.
  const rawBody = obj.body;
  const bodyPreview =
    typeof rawBody === "string" && rawBody.length > 0
      ? redactSecrets(rawBody).slice(0, 500)
      : null;
  return { errorName: name, errorMessage: message, errorCode: code, statusCode, bodyPreview };
}

// Prefer Node's `.code` for network errors (ENETUNREACH, ETIMEDOUT, …) so
// operators can tell "push service unreachable" from "crypto rejected the
// VAPID signature." Fall back to the error name for everything else.
function classifyNonHttp(err: unknown, detail: PushErrorLogDetail): string {
  if (detail.errorCode) return `net:${detail.errorCode}`;
  if (detail.errorName && detail.errorName.length > 0) return detail.errorName;
  if (!err || typeof err !== "object") return "unknown";
  return "unknown";
}

// Scrub values that could identify a subscription or expose a key:
// 1. Any http(s) URL — push endpoint URLs embed per-subscription tokens.
// 2. Long base64url runs — p256dh/auth and VAPID keys look like this.
function redactSecrets(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
}
