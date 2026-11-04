// Rate limiter for parent booking submits. Keys on the authenticated
// profile id, not req.ip — many booking requests reach the API from
// Vercel server actions whose egress IP is a shared pool. An IP limit
// would throttle every parent at once.
//
// 60 submits per hour per user is ~1/minute sustained, which exceeds
// any realistic human workflow but blocks a scripted attacker
// submitting as the same user. Behind requireUser + requireParent, so
// req.profile.id is guaranteed present by the time the limiter runs.

import rateLimit from "express-rate-limit";
import type { Request } from "express";

export const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Standard { error } shape so clients can reuse the same error-body
  // handling they use for 4xx/5xx responses from other routes.
  message: { error: "Too many booking requests, please try again later" },
  keyGenerator: (req: Request) => {
    // requireUser + requireParent + requireHouseholdRole run before this
    // limiter is mounted on the POST routes, so req.profile is always
    // set. Fall back to req.ip only to keep the limiter from crashing
    // in a test harness that omits the middleware chain — the fallback
    // path would never be reached in production.
    return req.profile?.id ?? req.ip ?? "unknown";
  },
});
