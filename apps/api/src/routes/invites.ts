import { Router } from "express";
import { createHash } from "crypto";
import { and, count, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { AcceptInviteResponse, InviteStatusResponse } from "@swim-app/shared";
import { db } from "../db/client";
import {
  householdAuditLog,
  householdInvites,
  householdMembers,
  households,
  swimmers,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";

export const invitesRouter = Router();

const TokenParamsSchema = z.object({ token: z.string().min(1) });
type TokenParams = z.infer<typeof TokenParamsSchema>;

class InviteError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── GET /invites/:token ────────────────────────────────────────────────────────

invitesRouter.get(
  "/:token",
  validate({ params: TokenParamsSchema }),
  asyncHandler(async (req, res) => {
    const { token } = req.params as unknown as TokenParams;
    const hash = hashToken(token);

    const rows = await db
      .select({
        acceptedAt: householdInvites.acceptedAt,
        revokedAt: householdInvites.revokedAt,
        expiresAt: householdInvites.expiresAt,
        householdName: households.name,
      })
      .from(householdInvites)
      .innerJoin(households, eq(households.id, householdInvites.householdId))
      .where(eq(householdInvites.tokenHash, hash))
      .limit(1);

    const invite = rows[0];
    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    let status: InviteStatusResponse["status"];
    if (invite.acceptedAt) {
      status = "accepted";
    } else if (invite.revokedAt) {
      status = "revoked";
    } else if (invite.expiresAt < new Date()) {
      status = "expired";
    } else {
      status = "pending";
    }

    const body: InviteStatusResponse = { householdName: invite.householdName, status };
    res.json(body);
  }),
);

// ── POST /invites/:token/accept ────────────────────────────────────────────────

invitesRouter.post(
  "/:token/accept",
  requireUser,
  requireParent,
  validate({ params: TokenParamsSchema }),
  asyncHandler(async (req, res) => {
    const { token } = req.params as unknown as TokenParams;
    const hash = hashToken(token);
    const now = new Date();

    let targetHouseholdId: string | undefined;

    try {
      await db.transaction(async (tx) => {
        // 1. Find the invite
        const inviteRows = await tx
          .select()
          .from(householdInvites)
          .where(eq(householdInvites.tokenHash, hash))
          .limit(1);
        const invite = inviteRows[0];
        if (!invite) throw new InviteError(404, "not_found", "Invite not found");

        // 2. Status checks — give specific messages before the CAS update
        if (invite.acceptedAt) {
          throw new InviteError(409, "already_used", "This invite link has already been used.");
        }
        if (invite.revokedAt) {
          throw new InviteError(409, "revoked", "This invite link has been revoked.");
        }
        if (invite.expiresAt < now) {
          throw new InviteError(409, "expired", "This invite link has expired.");
        }

        // 3. Get caller's current household membership
        const callerMemberRows = await tx
          .select({ householdId: householdMembers.householdId })
          .from(householdMembers)
          .where(eq(householdMembers.profileId, req.profile.id))
          .limit(1);
        const callerHouseholdId = callerMemberRows[0]?.householdId;
        if (!callerHouseholdId) {
          throw new InviteError(409, "no_household", "Your account does not have a household.");
        }

        // 4. Block: already in this household
        if (callerHouseholdId === invite.householdId) {
          throw new InviteError(409, "already_member", "You're already a member of this household.");
        }

        // 5. Block: caller's household has swimmers (archived rows count too)
        const [swimmerRow] = await tx
          .select({ n: count() })
          .from(swimmers)
          .where(eq(swimmers.householdId, callerHouseholdId));
        if ((swimmerRow?.n ?? 0) > 0) {
          throw new InviteError(
            409,
            "has_swimmers",
            "Your household has swimmers in it. You can't join another household while it does.",
          );
        }

        // 6. Block: caller's household has other members
        const [otherMemberRow] = await tx
          .select({ n: count() })
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.householdId, callerHouseholdId),
              ne(householdMembers.profileId, req.profile.id),
            ),
          );
        if ((otherMemberRow?.n ?? 0) > 0) {
          throw new InviteError(
            409,
            "has_members",
            "Your household has other members in it. They must leave (or you must transfer ownership) before you can join another household.",
          );
        }

        // 7. CAS update — atomically claim the invite.  Re-checks the same
        //    conditions so concurrent accepts of the same token give exactly
        //    one success and one 409.
        const accepted = await tx
          .update(householdInvites)
          .set({ acceptedAt: now, acceptedBy: req.profile.id })
          .where(
            and(
              eq(householdInvites.id, invite.id),
              isNull(householdInvites.acceptedAt),
              isNull(householdInvites.revokedAt),
              gt(householdInvites.expiresAt, now),
            ),
          )
          .returning();

        if (!accepted[0]) {
          throw new InviteError(409, "concurrent", "This invite link is no longer valid.");
        }

        // 8. Delete caller's old household.
        //    household_audit_log and household_members both have ON DELETE CASCADE
        //    on household_id, so they are removed automatically.
        //    swimmers.household_id is ON DELETE RESTRICT — confirmed in schema.ts;
        //    the swimmer count check above guarantees zero rows here.
        await tx.delete(households).where(eq(households.id, callerHouseholdId));

        // 9. Add caller as a viewer in the target household
        await tx.insert(householdMembers).values({
          householdId: invite.householdId,
          profileId: req.profile.id,
          role: "viewer",
        });

        // 10. Audit log
        await tx.insert(householdAuditLog).values({
          householdId: invite.householdId,
          actorId: req.profile.id,
          action: "member_added",
          targetProfileId: req.profile.id,
        });

        targetHouseholdId = invite.householdId;
      });
    } catch (err) {
      if (err instanceof InviteError) {
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }

    // targetHouseholdId is set inside the transaction and only reachable here
    // when the transaction committed without throwing.
    if (!targetHouseholdId) throw new Error("targetHouseholdId unset after committed transaction");
    const body: AcceptInviteResponse = { householdId: targetHouseholdId };
    res.json(body);
  }),
);
