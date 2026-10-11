import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import type { IdParams } from "@swim-app/shared";
import { db } from "../db/client";
import { guardians, swimmers, swimmerClubs } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireGuardian } from "../middleware/requireGuardian";
import { validate } from "../middleware/validate";
import { isActiveSwimmer } from "../db/queries";
import {
  IdParamsSchema,
  CreateSwimmerBodySchema,
  UpdateSwimmerBodySchema,
  type CreateSwimmerBody,
  type UpdateSwimmerBody,
  type ParentSwimmer,
} from "@swim-app/shared";

export const swimmersRouter = Router();

function toISO(date: Date): string {
  return date.toISOString();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type SwimmerClubRow = {
  id: string;
  swimmerId: string;
  clubId: string | null;
  otherClubName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapClub(c: SwimmerClubRow): ParentSwimmer["clubs"][number] {
  return {
    id: c.id,
    swimmerId: c.swimmerId,
    clubId: c.clubId,
    otherClubName: c.otherClubName,
    createdAt: toISO(c.createdAt),
    updatedAt: toISO(c.updatedAt),
  };
}

const swimmerColumns = {
  id: swimmers.id,
  firstName: swimmers.firstName,
  lastName: swimmers.lastName,
  birthDate: swimmers.birthDate,
  sex: swimmers.sex,
  isPublic: swimmers.isPublic,
  publicConsentAt: swimmers.publicConsentAt,
  createdAt: swimmers.createdAt,
  updatedAt: swimmers.updatedAt,
} as const;

const swimmerClubColumns = {
  id: swimmerClubs.id,
  swimmerId: swimmerClubs.swimmerId,
  clubId: swimmerClubs.clubId,
  otherClubName: swimmerClubs.otherClubName,
  createdAt: swimmerClubs.createdAt,
  updatedAt: swimmerClubs.updatedAt,
} as const;

async function fetchSwimmerWithClubs(swimmerId: string): Promise<ParentSwimmer | null> {
  const rows = await db
    .select(swimmerColumns)
    .from(swimmers)
    .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
    .limit(1);
  const swimmer = rows[0];
  if (!swimmer) return null;

  const clubRows = await db
    .select(swimmerClubColumns)
    .from(swimmerClubs)
    .where(eq(swimmerClubs.swimmerId, swimmerId));

  return {
    id: swimmer.id,
    firstName: swimmer.firstName,
    lastName: swimmer.lastName,
    birthDate: swimmer.birthDate,
    sex: swimmer.sex,
    isPublic: swimmer.isPublic,
    publicConsentAt: swimmer.publicConsentAt ? toISO(swimmer.publicConsentAt) : null,
    createdAt: toISO(swimmer.createdAt),
    updatedAt: toISO(swimmer.updatedAt),
    clubs: clubRows.map(mapClub),
  };
}

function clubInsertValues(swimmerId: string, clubs: CreateSwimmerBody["clubs"]) {
  return clubs.map((club) => {
    if ("clubId" in club) {
      return { swimmerId, clubId: club.clubId, otherClubName: null as null };
    }
    return { swimmerId, clubId: null as null, otherClubName: club.otherClubName };
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

swimmersRouter.post("/", requireUser, requireParent, validate({ body: CreateSwimmerBodySchema }), async (req, res) => {
  const body = req.body as CreateSwimmerBody;
  const callerId = req.profile.id;

  const swimmer = await db.transaction(async (tx) => {
    const [newSwimmer] = await tx
      .insert(swimmers)
      .values({
        firstName: body.firstName,
        lastName: body.lastName,
        birthDate: body.birthDate,
        sex: body.sex,
        isPublic: body.isPublic,
        ...(body.isPublic && {
          publicConsentAt: new Date(),
          publicConsentBy: callerId,
        }),
      })
      .returning();

    await tx.insert(guardians).values({
      profileId: callerId,
      swimmerId: newSwimmer!.id,
    });

    if (body.clubs.length > 0) {
      await tx.insert(swimmerClubs).values(clubInsertValues(newSwimmer!.id, body.clubs));
    }

    return newSwimmer!;
  });

  const result = await fetchSwimmerWithClubs(swimmer.id);
  if (!result) throw new Error("Swimmer not found after insert");
  res.status(201).json(result);
});

swimmersRouter.get("/me", requireUser, requireParent, validate({}), async (req, res) => {
  const callerId = req.profile.id;

  const guardianRows = await db
    .select({ swimmerId: guardians.swimmerId })
    .from(guardians)
    .where(eq(guardians.profileId, callerId));

  if (guardianRows.length === 0) {
    res.json([]);
    return;
  }

  const swimmerIds = guardianRows.map((row) => row.swimmerId);

  const activeRows = await db
    .select(swimmerColumns)
    .from(swimmers)
    .where(and(isActiveSwimmer, inArray(swimmers.id, swimmerIds)));

  if (activeRows.length === 0) {
    res.json([]);
    return;
  }

  const activeIds = activeRows.map((row) => row.id);
  const clubRows = await db
    .select(swimmerClubColumns)
    .from(swimmerClubs)
    .where(inArray(swimmerClubs.swimmerId, activeIds));

  const clubsBySwimmer = new Map<string, typeof clubRows>();
  for (const club of clubRows) {
    const existing = clubsBySwimmer.get(club.swimmerId) ?? [];
    existing.push(club);
    clubsBySwimmer.set(club.swimmerId, existing);
  }

  const result: ParentSwimmer[] = activeRows.map((swimmer) => ({
    id: swimmer.id,
    firstName: swimmer.firstName,
    lastName: swimmer.lastName,
    birthDate: swimmer.birthDate,
    sex: swimmer.sex,
    isPublic: swimmer.isPublic,
    publicConsentAt: swimmer.publicConsentAt ? toISO(swimmer.publicConsentAt) : null,
    createdAt: toISO(swimmer.createdAt),
    updatedAt: toISO(swimmer.updatedAt),
    clubs: (clubsBySwimmer.get(swimmer.id) ?? []).map(mapClub),
  }));

  res.json(result);
});

// Parent guardians only. Coach access (including setting isPublic to false and
// archiving) comes in a separate coach route in a later PR.

swimmersRouter.get("/:id", requireUser, validate({ params: IdParamsSchema }), requireGuardian, async (req, res) => {
  const { id: swimmerId } = req.params as unknown as IdParams;
  const result = await fetchSwimmerWithClubs(swimmerId);
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

swimmersRouter.patch(
  "/:id",
  requireUser,
  validate({ params: IdParamsSchema, body: UpdateSwimmerBodySchema }),
  requireGuardian,
  async (req, res) => {
    const body = req.body as UpdateSwimmerBody;
    const { id: swimmerId } = req.params as unknown as IdParams;
    const callerId = req.profile.id;

    let notFound = false;

    await db.transaction(async (tx) => {
      const hasSwimmerFields =
        body.firstName !== undefined ||
        body.lastName !== undefined ||
        body.birthDate !== undefined ||
        body.sex !== undefined ||
        body.isPublic !== undefined;

      if (hasSwimmerFields) {
        const currentRows = await tx
          .select({ isPublic: swimmers.isPublic })
          .from(swimmers)
          .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
          .limit(1);
        const current = currentRows[0];
        if (!current) {
          notFound = true;
          return;
        }

        await tx.update(swimmers).set({
          ...(body.firstName !== undefined && { firstName: body.firstName }),
          ...(body.lastName !== undefined && { lastName: body.lastName }),
          ...(body.birthDate !== undefined && { birthDate: body.birthDate }),
          ...(body.sex !== undefined && { sex: body.sex }),
          ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
          ...(body.isPublic === true && !current.isPublic && {
            publicConsentAt: new Date(),
            publicConsentBy: callerId,
          }),
        }).where(eq(swimmers.id, swimmerId));
      }

      if (body.clubs !== undefined) {
        await tx.delete(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId));
        if (body.clubs.length > 0) {
          await tx.insert(swimmerClubs).values(clubInsertValues(swimmerId, body.clubs));
        }
      }
    });

    if (notFound) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const result = await fetchSwimmerWithClubs(swimmerId);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  },
);

swimmersRouter.delete("/:id", requireUser, validate({ params: IdParamsSchema }), requireGuardian, async (req, res) => {
  const { id: swimmerId } = req.params as unknown as IdParams;
  await db
    .update(swimmers)
    .set({ archivedAt: new Date() })
    .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)));
  res.status(204).end();
});
