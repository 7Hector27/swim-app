import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type {
  ChangeRoleBody,
  GenerateInviteResponse,
  HouseholdResponse,
  ListInviteResponse,
  RenameHouseholdBody,
  TransferOwnershipBody,
} from "@swim-app/shared";
import {
  ChangeRoleBodySchema,
  RenameHouseholdBodySchema,
  TransferOwnershipBodySchema,
} from "@swim-app/shared";
import { getEnv } from "../lib/env";
import { db } from "../db/client";
import {
  householdAuditLog,
  householdInvites,
  householdMembers,
  households,
  profiles,
  swimmers,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import { registerHomePoolRoutes } from "./locations";

const ProfileIdParamsSchema = z.object({ profileId: z.string().uuid() });
type ProfileIdParams = z.infer<typeof ProfileIdParamsSchema>;

const InviteIdParamsSchema = z.object({ id: z.string().uuid() });
type InviteIdParams = z.infer<typeof InviteIdParamsSchema>;

function deriveHouseholdName(fullName: string | null): string {
  if (!fullName) return "My Household";
  const parts = fullName.trim().split(/\s+/);
  return `${parts[parts.length - 1] ?? fullName} Family`;
}

export const householdsRouter = Router();

registerHomePoolRoutes(householdsRouter);

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

    const url = `${getEnv().siteUrl}/invite/${raw}`;

    const body: GenerateInviteResponse = {
      id: inserted.id,
      url,
      expiresAt: inserted.expiresAt.toISOString(),
    };
    res.status(201).json(body);
  }),
);

// ── GET /households/mine/invites ──────────────────────────────────────────────
// Returns the current pending invite metadata (no raw token — never stored).

householdsRouter.get(
  "/mine/invites",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({}),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const rows = await db
      .select({ id: householdInvites.id, expiresAt: householdInvites.expiresAt, createdAt: householdInvites.createdAt })
      .from(householdInvites)
      .where(
        and(
          eq(householdInvites.householdId, req.householdId),
          isNull(householdInvites.revokedAt),
          isNull(householdInvites.acceptedAt),
          gt(householdInvites.expiresAt, now),
        ),
      )
      .limit(1);

    const invite = rows[0] ?? null;
    const body: ListInviteResponse = {
      invite: invite
        ? { id: invite.id, expiresAt: invite.expiresAt.toISOString(), createdAt: invite.createdAt.toISOString() }
        : null,
    };
    res.json(body);
  }),
);

// ── DELETE /households/mine/invites/:id ───────────────────────────────────────

householdsRouter.delete(
  "/mine/invites/:id",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({ params: InviteIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as unknown as InviteIdParams;
    const now = new Date();

    let notFound = false;
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(householdInvites)
        .set({ revokedAt: now })
        .where(and(eq(householdInvites.id, id), eq(householdInvites.householdId, req.householdId), isNull(householdInvites.revokedAt)))
        .returning();

      if (!updated[0]) {
        notFound = true;
        return;
      }

      await tx.insert(householdAuditLog).values({
        householdId: req.householdId,
        actorId: req.profile.id,
        action: "invite_revoked",
      });
    });

    if (notFound) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    res.status(204).send();
  }),
);

// ── PATCH /households/mine ────────────────────────────────────────────────────

householdsRouter.patch(
  "/mine",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({ body: RenameHouseholdBodySchema }),
  asyncHandler(async (req, res) => {
    const { name } = req.body as RenameHouseholdBody;

    await db.transaction(async (tx) => {
      await tx.update(households).set({ name }).where(eq(households.id, req.householdId));
      await tx.insert(householdAuditLog).values({
        householdId: req.householdId,
        actorId: req.profile.id,
        action: "household_renamed",
      });
    });

    res.json({ id: req.householdId, name });
  }),
);

// ── PATCH /households/mine/members/:profileId ─────────────────────────────────

householdsRouter.patch(
  "/mine/members/:profileId",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({ params: ProfileIdParamsSchema, body: ChangeRoleBodySchema }),
  asyncHandler(async (req, res) => {
    const { profileId } = req.params as unknown as ProfileIdParams;
    const { role } = req.body as ChangeRoleBody;

    if (profileId === req.profile.id) {
      res.status(403).json({ error: "You cannot change your own role. Transfer ownership first.", code: "self_role_change" });
      return;
    }

    let notFound = false;
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(householdMembers)
        .set({ role })
        .where(and(eq(householdMembers.householdId, req.householdId), eq(householdMembers.profileId, profileId)))
        .returning();

      if (!updated[0]) {
        notFound = true;
        return;
      }

      await tx.insert(householdAuditLog).values({
        householdId: req.householdId,
        actorId: req.profile.id,
        action: "role_changed",
        targetProfileId: profileId,
        newRole: role,
      });
    });

    if (notFound) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    res.json({});
  }),
);

// ── DELETE /households/mine/members/me ────────────────────────────────────────
// Must be registered before /:profileId so "me" is not captured as a profileId.

householdsRouter.delete(
  "/mine/members/me",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    if (req.householdRole === "owner") {
      res.status(409).json({ error: "Transfer ownership before leaving the household.", code: "must_transfer_first" });
      return;
    }

    const oldHouseholdId = req.householdId;
    const callerId = req.profile.id;

    await db.transaction(async (tx) => {
      const profileRows = await tx
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.id, callerId))
        .limit(1);
      const newName = deriveHouseholdName(profileRows[0]?.fullName ?? null);

      // Delete old membership first — the unique index on profileId allows only
      // one household per person, so the new insert must not happen while the
      // old row still exists.
      await tx
        .delete(householdMembers)
        .where(and(eq(householdMembers.householdId, oldHouseholdId), eq(householdMembers.profileId, callerId)));

      const newHousehold = (await tx.insert(households).values({ name: newName }).returning())[0]!;

      await tx.insert(householdMembers).values({ householdId: newHousehold.id, profileId: callerId, role: "owner" });

      await tx.insert(householdAuditLog).values({
        householdId: oldHouseholdId,
        actorId: callerId,
        action: "member_removed",
        targetProfileId: callerId,
      });

      await tx.insert(householdAuditLog).values({
        householdId: newHousehold.id,
        actorId: callerId,
        action: "household_created",
      });
    });

    res.json({});
  }),
);

// ── DELETE /households/mine/members/:profileId ────────────────────────────────

householdsRouter.delete(
  "/mine/members/:profileId",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({ params: ProfileIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { profileId } = req.params as unknown as ProfileIdParams;

    if (profileId === req.profile.id) {
      res.status(403).json({ error: "Transfer ownership before removing yourself.", code: "self_remove" });
      return;
    }

    // Check membership and fetch profile before opening the transaction.
    const [memberRows, profileRows] = await Promise.all([
      db
        .select({ role: householdMembers.role })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, req.householdId), eq(householdMembers.profileId, profileId)))
        .limit(1),
      db.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, profileId)).limit(1),
    ]);

    if (!memberRows[0]) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const newName = deriveHouseholdName(profileRows[0]?.fullName ?? null);

    await db.transaction(async (tx) => {
      // Delete old membership first — the unique index on profileId allows only
      // one household per person, so the new insert must not happen while the
      // old row still exists.
      await tx
        .delete(householdMembers)
        .where(and(eq(householdMembers.householdId, req.householdId), eq(householdMembers.profileId, profileId)));

      const newHousehold = (await tx.insert(households).values({ name: newName }).returning())[0]!;

      await tx.insert(householdMembers).values({ householdId: newHousehold.id, profileId, role: "owner" });

      await tx.insert(householdAuditLog).values({
        householdId: req.householdId,
        actorId: req.profile.id,
        action: "member_removed",
        targetProfileId: profileId,
      });

      await tx.insert(householdAuditLog).values({
        householdId: newHousehold.id,
        actorId: profileId,
        action: "household_created",
      });
    });

    res.json({});
  }),
);

// ── POST /households/mine/transfer-ownership ──────────────────────────────────

householdsRouter.post(
  "/mine/transfer-ownership",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  validate({ body: TransferOwnershipBodySchema }),
  asyncHandler(async (req, res) => {
    const { newOwnerProfileId } = req.body as TransferOwnershipBody;
    const callerId = req.profile.id;

    if (newOwnerProfileId === callerId) {
      res.status(403).json({ error: "You are already the owner.", code: "self_transfer" });
      return;
    }

    // Verify target membership before opening the transaction.
    const memberRows = await db
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, req.householdId), eq(householdMembers.profileId, newOwnerProfileId)))
      .limit(1);

    if (!memberRows[0]) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    await db.transaction(async (tx) => {
      // Demote current owner first so the unique partial index on role='owner' is not violated.
      await tx
        .update(householdMembers)
        .set({ role: "manager" })
        .where(and(eq(householdMembers.householdId, req.householdId), eq(householdMembers.profileId, callerId)));

      await tx
        .update(householdMembers)
        .set({ role: "owner" })
        .where(and(eq(householdMembers.householdId, req.householdId), eq(householdMembers.profileId, newOwnerProfileId)));

      await tx.insert(householdAuditLog).values([
        {
          householdId: req.householdId,
          actorId: callerId,
          action: "role_changed",
          targetProfileId: callerId,
          newRole: "manager",
        },
        {
          householdId: req.householdId,
          actorId: callerId,
          action: "role_changed",
          targetProfileId: newOwnerProfileId,
          newRole: "owner",
        },
      ]);
    });

    res.json({});
  }),
);
