import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { supabase } from "../lib/supabase";
import { db } from "../db/client";
import { profiles } from "../db/schema";

export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  // getUser verifies the token against Supabase's auth server on every request,
  // so revoked sessions and banned users are rejected immediately rather than
  // being allowed until the JWT's exp claim expires.
  let getResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    getResult = await supabase.auth.getUser(token);
  } catch {
    res.status(503).json({ error: "Auth service unavailable" });
    return;
  }
  const { data, error } = getResult;
  if (error || !data.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sub = data.user.id;
  const email = data.user.email;
  if (!email) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rows = await db.select().from(profiles).where(eq(profiles.id, sub));
  const profile = rows[0];

  if (!profile) {
    req.log.warn({ userId: sub, reason: "no_profile" }, "access denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (profile.disabledAt) {
    // ADR 034: a disabled profile is a deleted account. The Supabase Auth
    // user is hard-deleted in a post-commit task that can retry on transient
    // failure, so a stale (still-cryptographically-valid) access token can
    // reach us during that window. 401 is the right code — the identity no
    // longer exists — and clients that distinguish 401 vs 403 will clear
    // their session and redirect to signup.
    req.log.warn({ userId: profile.id, reason: "disabled" }, "access denied");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!profile.ageAttestedAt) {
    req.log.warn({ userId: profile.id, reason: "age_not_attested" }, "access denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.profile = profile;
  req.userEmail = email;
  next();
}
