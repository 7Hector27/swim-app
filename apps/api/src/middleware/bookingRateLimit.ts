// Rate limiters for the parent booking surface. Both key on the
// authenticated profile id, not req.ip — many booking requests reach
// the API from Vercel server actions whose egress IP is a shared pool.
// An IP limit would throttle every parent at once.
//
// Two separate buckets so preview noise can't exhaust the submit budget:
//
// - bookingLimiter (submit): POST /lessons, POST /lessons/batch. 60/hr
//   per user is ~1/minute sustained — exceeds any realistic human
//   workflow, blocks a scripted attacker submitting as the same user.
//
// - previewLimiter: POST /lessons/batch/preview. The booking calendar
//   fires preview on every batch-input change behind a 350 ms debounce
//   (BookCalendarContent.tsx:555), so a parent composing a weekly batch
//   easily racks up dozens of calls. A single 60/hr bucket would block
//   them from submitting. 600/hr = 10/minute sustained; still catches
//   abusive compute loops (the slot engine runs per call) while leaving
//   ample room for interactive editing.
//
// Both are mounted after requireUser + requireParent + requireHouseholdRole,
// so req.profile is guaranteed present when the keyGenerator runs.

import rateLimit from "express-rate-limit";
import type { Request } from "express";

function profileIdKey(req: Request): string {
  // The require* middleware guarantees req.profile; req.ip is a test-
  // harness-only fallback, never reached in production.
  return req.profile?.id ?? req.ip ?? "unknown";
}

export const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Standard { error } shape so clients can reuse the same error-body
  // handling they use for 4xx/5xx responses from other routes.
  message: { error: "Too many booking requests, please try again later" },
  keyGenerator: profileIdKey,
});

export const previewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many availability checks, please try again later" },
  keyGenerator: profileIdKey,
});
