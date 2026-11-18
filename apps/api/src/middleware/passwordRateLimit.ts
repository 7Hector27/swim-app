// Rate limiters for the password-change surface.
//
// 1) `forgotPasswordIpLimiter`: per-IP cap on POST /auth/forgot-password.
//    Stacked AFTER authEmailLimiter (which keys on body.email) so the
//    per-email counter still fires when attackers spray many addresses.
//    Set deliberately high because requests reach the API via Vercel's
//    shared egress pool — a tight per-IP cap would throttle unrelated
//    users together. The point is to catch a scripted abuser hitting
//    the endpoint directly from a fixed IP, not to replace the per-email
//    counter.
//
// 2) `changePasswordLimiter`: per-profile cap on POST /auth/change-password.
//    The route verifies the current password via supabase.auth.
//    signInWithPassword; without a bucket a stolen access token could
//    brute-force the password. 5/hour per profile matches the account-
//    deletion confirm limiter.
//
// 3) `notifyPasswordChangedLimiter`: per-profile cap on POST /auth/
//    notify-password-changed. Without a cap, a stolen access token could
//    spam the recipient's inbox with "Your password was changed" alerts.
//    Same 5/hour-per-profile shape as changePasswordLimiter — the
//    legitimate path hits this endpoint exactly once per reset.

import rateLimit from "express-rate-limit";
import type { Request } from "express";

export const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

function readProfileId(req: Request): string | null {
  const id = req.profile?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export const changePasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password-change attempts, please wait before trying again" },
  skip: (req: Request) => readProfileId(req) === null,
  keyGenerator: (req: Request) => {
    const id = readProfileId(req);
    if (id === null) {
      throw new Error("changePasswordLimiter: keyGenerator reached without profile id");
    }
    return id;
  },
});

export const notifyPasswordChangedLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  skip: (req: Request) => readProfileId(req) === null,
  keyGenerator: (req: Request) => {
    const id = readProfileId(req);
    if (id === null) {
      throw new Error("notifyPasswordChangedLimiter: keyGenerator reached without profile id");
    }
    return id;
  },
});
