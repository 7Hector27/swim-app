import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { GenerateInviteResponse, HouseholdResponse } from "@swim-app/shared";
import { db } from "../db/client";
import { householdInvites, householdMembers, households, profiles, swimmers } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
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

// ── POST /households/mine/invites ─────────────────────────────────────────────
// Owner only. Revokes any existing pending invite, then generates a new one.
// Returns the raw token once in the response URL — it is never stored.

householdsRouter.post(
  "/mine/invites",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({}),
  asyncHandler(async (req, res) => {
    const { householdId } = req;
    const now = new Date();

    const raw = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(raw).digest("hex");

    const inserted = await db.transaction(async (tx) => {
      // Revoke any existing pending invite for this household (one-active rule)
      await tx
        .update(householdInvites)
        .set({ revokedAt: now })
        .where(
          and(
            eq(householdInvites.householdId, householdId),
            isNull(householdInvites.revokedAt),
            isNull(householdInvites.acceptedAt),
            gt(householdInvites.expiresAt, now),
          ),
        );

      const rows = await tx
        .insert(householdInvites)
        .values({ householdId, tokenHash, createdBy: req.profile.id })
        .returning();

      return rows[0]!;
    });

    const siteUrl = process.env["SITE_URL"] ?? "http://localhost:3000";
    const url = `${siteUrl}/invite/${raw}`;

    const body: GenerateInviteResponse = {
      id: inserted.id,
      url,
      expiresAt: inserted.expiresAt.toISOString(),
    };
    res.status(201).json(body);
  }),
);
