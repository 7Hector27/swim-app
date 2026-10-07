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
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sub = data.claims.sub;
  if (!sub) {
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
    req.log.warn({ userId: profile.id, reason: "disabled" }, "access denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!profile.ageAttestedAt) {
    req.log.warn({ userId: profile.id, reason: "age_not_attested" }, "access denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.profile = profile;
  next();
}
