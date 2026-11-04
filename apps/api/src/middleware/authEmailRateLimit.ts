// Per-email rate limiter for unauthenticated routes that send email
// (currently just POST /auth/signup). Keys on body.email (trimmed,
// lowercased) because the only unauth email-sending route is called
// from a Next.js server action (apps/web/src/content/SignupContent/
// actions.ts). All signups therefore reach the API from Vercel's
// shared egress IP pool, so an IP limiter would throttle every signup
// globally.
//
// Enumeration safety: the limiter runs BEFORE any DB lookup, so the
// decision to issue 429 depends only on the counter, never on whether
// the email corresponds to a registered account. An attacker probing
// which emails are registered gets a shape-identical 429 on attempt 6
// regardless of existence. See the test's enumeration-safety case.
//
// Must be mounted AFTER validate({ body }) so req.body.email is parsed
// and shape-checked before the keyGenerator reads it. A request missing
// a valid email never reaches the limiter in production; if one somehow
// does, `skip` bypasses the limiter entirely so the request isn't
// grouped into a shared fallback bucket that could be exhausted to
// amplify or mask traffic.

import rateLimit from "express-rate-limit";
import type { Request } from "express";

// 5 attempts per hour per email. Blocks email-stuffing and probing
// (attacker trying the same email repeatedly) without penalizing a
// real user who mistypes their password a handful of times.
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}

function readEmail(req: Request): string | null {
  const body = req.body as { email?: unknown } | null | undefined;
  return normalizeEmail(body?.email);
}

export const authEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Must match the shape of other 4xx responses so clients render it
  // through the same error path. Message is deliberately generic — does
  // NOT confirm or deny the email exists.
  message: { error: "Too many requests, please try again later" },
  // If there's no usable email (validate() would already have returned
  // 422 for this), skip the limiter entirely. Returning a fallback key
  // instead would funnel every malformed request into one shared bucket
  // — an easy amplification target and a way to mask real per-email
  // counters. Skipping is safe because validate() rejects the request
  // right after this middleware.
  skip: (req: Request) => readEmail(req) === null,
  keyGenerator: (req: Request) => {
    const email = readEmail(req);
    if (email === null) {
      // Unreachable: skip() above returns true in this case. Throw so a
      // bug that bypasses skip() is loud, not silently bucketed.
      throw new Error("authEmailLimiter: keyGenerator reached without email");
    }
    return email;
  },
});
