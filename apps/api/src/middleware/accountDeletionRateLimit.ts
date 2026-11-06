// Rate limiter for POST /me/deletion/confirm (ADR 034).
//
// Each parent can attempt the confirm endpoint at most 5 times per hour.
// The confirm handler re-authenticates via supabase.auth.signInWithPassword;
// without a bucket, a malicious actor who stole an access token (but not
// the password) could brute-force the password by replaying confirm. 5/hr
// per user is tight enough to make that infeasible while leaving room for
// a parent who genuinely mistyped their password a handful of times.
//
// Keys on the authenticated profile id, not req.ip — many server actions
// reach the API from a shared egress pool, so IP-based limiting would
// throttle unrelated users together. The middleware mounts after
// requireUser, so req.profile is guaranteed present; if it isn't, skip()
// bypasses the limiter rather than falling back to req.ip.

import rateLimit from "express-rate-limit";
import type { Request } from "express";

function readProfileId(req: Request): string | null {
  const id = req.profile?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export const accountDeletionConfirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many deletion attempts, please wait before trying again" },
  skip: (req: Request) => readProfileId(req) === null,
  keyGenerator: (req: Request) => {
    const id = readProfileId(req);
    if (id === null) {
      throw new Error("accountDeletionConfirmLimiter: keyGenerator reached without profile id");
    }
    return id;
  },
});
