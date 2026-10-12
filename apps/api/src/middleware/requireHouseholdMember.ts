import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { householdMembers } from "../db/schema";

export const requireHouseholdMember: RequestHandler = async (req, res, next) => {
  const rows = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.profileId, req.profile.id))
    .limit(1);

  const member = rows[0];
  if (!member) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  req.householdId = member.householdId;
  req.householdRole = member.role;
  next();
};
