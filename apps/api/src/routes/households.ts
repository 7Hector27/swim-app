import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { HouseholdResponse } from "@swim-app/shared";
import { db } from "../db/client";
import { householdMembers, households, profiles, swimmers } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";

export const householdsRouter = Router();

householdsRouter.get(
  "/mine",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const { householdId, householdRole } = req;

    const [householdRows, memberRows, swimmerRows] = await Promise.all([
      db.select({ id: households.id, name: households.name }).from(households).where(eq(households.id, householdId)).limit(1),
      db
        .select({
          profileId: householdMembers.profileId,
          role: householdMembers.role,
          fullName: profiles.fullName,
          joinedAt: householdMembers.joinedAt,
        })
        .from(householdMembers)
        .innerJoin(profiles, eq(profiles.id, householdMembers.profileId))
        .where(eq(householdMembers.householdId, householdId)),
      db
        .select({ id: swimmers.id })
        .from(swimmers)
        .where(and(isActiveSwimmer, eq(swimmers.householdId, householdId))),
    ]);

    const household = householdRows[0];
    if (!household) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const result: HouseholdResponse = {
      id: household.id,
      name: household.name,
      myRole: householdRole,
      members: memberRows.map((row) => ({
        // profileId is personal data — only the owner needs it for member management
        ...(householdRole === "owner" && { profileId: row.profileId }),
        role: row.role,
        fullName: row.fullName,
        joinedAt: row.joinedAt.toISOString(),
      })),
      swimmerIds: swimmerRows.map((row) => row.id),
    };

    res.json(result);
  }),
);
