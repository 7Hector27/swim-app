import { Router } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { IdParams } from "@swim-app/shared";
import { db } from "../db/client";
import { clubs, householdAuditLog, leagueRegistrations, swimmers, swimmerClubs } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdSwimmer } from "../middleware/requireHouseholdSwimmer";
import { requireHouseholdRole } from "../middleware/requireHouseholdRole";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import {
  IdParamsSchema,
  CreateSwimmerBodySchema,
  UpdateSwimmerBodySchema,
  LeagueRegistrationParamsSchema,
  currentSeasonStartYear,
  todayLA,
  type CreateSwimmerBody,
  type UpdateSwimmerBody,
  type ParentSwimmer,
  type LeagueRegistrationParams,
} from "@swim-app/shared";

export const swimmersRouter = Router();

class UnknownClubError extends Error {
  constructor() {
    super("Unknown club");
    this.name = "UnknownClubError";
  }
}

function toISO(date: Date): string {
  return date.toISOString();
}

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

function currentSeasonFilter() {
  const today = todayLA();
  const clubYear = currentSeasonStartYear("club", today);
  const summerYear = currentSeasonStartYear("summer_league", today);
  return { clubYear, summerYear };
}

function activeRegWhereClause(swimmerId: string) {
  const { clubYear, summerYear } = currentSeasonFilter();
  return and(
    eq(leagueRegistrations.swimmerId, swimmerId),
    isNull(leagueRegistrations.withdrawnAt),
    or(
      and(eq(leagueRegistrations.league, "club"), eq(leagueRegistrations.seasonStartYear, clubYear)),
      and(eq(leagueRegistrations.league, "summer_league"), eq(leagueRegistrations.seasonStartYear, summerYear)),
    ),
  );
}

async function fetchSwimmerWithClubs(swimmerId: string): Promise<ParentSwimmer | null> {
  const rows = await db
    .select(swimmerColumns)
    .from(swimmers)
    .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
    .limit(1);
  const swimmer = rows[0];
  if (!swimmer) return null;

  const [clubRows, regRows] = await Promise.all([
    db.select(swimmerClubColumns).from(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId)),
    db
      .select({ league: leagueRegistrations.league })
      .from(leagueRegistrations)
      .where(activeRegWhereClause(swimmerId)),
  ]);

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
    currentLeagues: regRows.map((row) => row.league),
  };
}

function clubInsertValues(swimmerId: string, clubList: CreateSwimmerBody["clubs"]) {
  return clubList.map((club) => {
    if ("clubId" in club) {
      return { swimmerId, clubId: club.clubId, otherClubName: null as null };
    }
    return { swimmerId, clubId: null as null, otherClubName: club.otherClubName };
  });
}

async function validateClubIds(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  clubList: CreateSwimmerBody["clubs"],
): Promise<void> {
  const clubIdInputs = clubList
    .filter((c): c is { clubId: string } => "clubId" in c)
    .map((c) => c.clubId);
  if (clubIdInputs.length === 0) return;

  const validClubs = await tx
    .select({ id: clubs.id })
    .from(clubs)
    .where(and(inArray(clubs.id, clubIdInputs), eq(clubs.isActive, true)));

  if (validClubs.length !== clubIdInputs.length) {
    throw new UnknownClubError();
  }
}

const ROLE_RANK = { viewer: 0, manager: 1, owner: 2 } as const;

// ── Routes ────────────────────────────────────────────────────────────────────

swimmersRouter.post(
  "/",
  requireUser,
  requireParent,
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  validate({ body: CreateSwimmerBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CreateSwimmerBody;
    const callerId = req.profile.id;
    const { householdId, householdRole } = req;

    if (body.isPublic && householdRole !== "owner") {
      res.status(403).json({ error: "Only the household owner can make a swimmer public" });
      return;
    }

    let swimmer: { id: string } | undefined;
    try {
      swimmer = await db.transaction(async (tx) => {
        const [newSwimmer] = await tx
          .insert(swimmers)
          .values({
            firstName: body.firstName,
            lastName: body.lastName,
            birthDate: body.birthDate,
            sex: body.sex,
            isPublic: body.isPublic,
            householdId,
            ...(body.isPublic && {
              publicConsentAt: new Date(),
              publicConsentBy: callerId,
            }),
          })
          .returning();

        await tx.insert(householdAuditLog).values({
          householdId,
          actorId: callerId,
          action: "swimmer_added",
          targetSwimmerId: newSwimmer!.id,
        });

        if (body.clubs.length > 0) {
          await validateClubIds(tx, body.clubs);
          await tx.insert(swimmerClubs).values(clubInsertValues(newSwimmer!.id, body.clubs));
        }

        return newSwimmer!;
      });
    } catch (err) {
      if (err instanceof UnknownClubError) {
        res.status(400).json({ error: "Unknown club" });
        return;
      }
      throw err;
    }

    const result = await fetchSwimmerWithClubs(swimmer.id);
    if (!result) throw new Error("Swimmer not found after insert");
    res.status(201).json(result);
  }),
);

swimmersRouter.get(
  "/me",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const { householdId } = req;

    const activeRows = await db
      .select(swimmerColumns)
      .from(swimmers)
      .where(and(isActiveSwimmer, eq(swimmers.householdId, householdId)));

    if (activeRows.length === 0) {
      res.json([]);
      return;
    }

    const activeIds = activeRows.map((row) => row.id);
    const { clubYear, summerYear } = currentSeasonFilter();

    const [clubRows, regRows] = await Promise.all([
      db.select(swimmerClubColumns).from(swimmerClubs).where(inArray(swimmerClubs.swimmerId, activeIds)),
      db
        .select({ swimmerId: leagueRegistrations.swimmerId, league: leagueRegistrations.league })
        .from(leagueRegistrations)
        .where(
          and(
            inArray(leagueRegistrations.swimmerId, activeIds),
            isNull(leagueRegistrations.withdrawnAt),
            or(
              and(eq(leagueRegistrations.league, "club"), eq(leagueRegistrations.seasonStartYear, clubYear)),
              and(eq(leagueRegistrations.league, "summer_league"), eq(leagueRegistrations.seasonStartYear, summerYear)),
            ),
          ),
        ),
    ]);

    const clubsBySwimmer = new Map<string, typeof clubRows>();
    for (const club of clubRows) {
      const existing = clubsBySwimmer.get(club.swimmerId) ?? [];
      existing.push(club);
      clubsBySwimmer.set(club.swimmerId, existing);
    }

    const leaguesBySwimmer = new Map<string, Array<"club" | "summer_league">>();
    for (const reg of regRows) {
      const existing = leaguesBySwimmer.get(reg.swimmerId) ?? [];
      existing.push(reg.league);
      leaguesBySwimmer.set(reg.swimmerId, existing);
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
      currentLeagues: leaguesBySwimmer.get(swimmer.id) ?? [],
    }));

    res.json(result);
  }),
);

swimmersRouter.get(
  "/:id",
  requireUser,
  requireParent,
  validate({ params: IdParamsSchema }),
  requireHouseholdMember,
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const result = await fetchSwimmerWithClubs(swimmerId);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  }),
);

swimmersRouter.patch(
  "/:id",
  requireUser,
  requireParent,
  validate({ params: IdParamsSchema, body: UpdateSwimmerBodySchema }),
  requireHouseholdMember,
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const body = req.body as UpdateSwimmerBody;
    const { id: swimmerId } = req.params as unknown as IdParams;
    const callerId = req.profile.id;
    const { householdRole } = req;

    if (body.isPublic === true) {
      if (householdRole !== "owner") {
        res.status(403).json({ error: "Only the household owner can make a swimmer public" });
        return;
      }
    } else {
      const hasSwimmerFieldChange =
        body.firstName !== undefined ||
        body.lastName !== undefined ||
        body.birthDate !== undefined ||
        body.sex !== undefined ||
        body.clubs !== undefined;
      if (hasSwimmerFieldChange && ROLE_RANK[householdRole] < ROLE_RANK.manager) {
        res.status(403).json({ error: "Insufficient household role" });
        return;
      }
    }

    const hasSwimmerFields =
      body.firstName !== undefined ||
      body.lastName !== undefined ||
      body.birthDate !== undefined ||
      body.sex !== undefined ||
      body.isPublic !== undefined;

    let notFound = false;

    try {
      await db.transaction(async (tx) => {
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

        if (hasSwimmerFields) {
          await tx
            .update(swimmers)
            .set({
              ...(body.firstName !== undefined && { firstName: body.firstName }),
              ...(body.lastName !== undefined && { lastName: body.lastName }),
              ...(body.birthDate !== undefined && { birthDate: body.birthDate }),
              ...(body.sex !== undefined && { sex: body.sex }),
              ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
              ...(body.isPublic === true && !current.isPublic && {
                publicConsentAt: new Date(),
                publicConsentBy: callerId,
              }),
            })
            .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)));
        }

        if (body.clubs !== undefined) {
          if (body.clubs.length > 0) {
            await validateClubIds(tx, body.clubs);
          }
          await tx.delete(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId));
          if (body.clubs.length > 0) {
            await tx.insert(swimmerClubs).values(clubInsertValues(swimmerId, body.clubs));
          }
        }
      });
    } catch (err) {
      if (err instanceof UnknownClubError) {
        res.status(400).json({ error: "Unknown club" });
        return;
      }
      throw err;
    }

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
  }),
);

swimmersRouter.delete(
  "/:id",
  requireUser,
  requireParent,
  validate({ params: IdParamsSchema }),
  requireHouseholdMember,
  requireHouseholdRole("owner"),
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    await db
      .update(swimmers)
      .set({ archivedAt: new Date() })
      .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)));
    res.status(204).end();
  }),
);

// ── League registration routes ────────────────────────────────────────────────

swimmersRouter.put(
  "/:id/registrations/:league",
  requireUser,
  requireParent,
  validate({ params: LeagueRegistrationParamsSchema }),
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId, league } = req.params as unknown as LeagueRegistrationParams;
    const today = todayLA();
    const seasonStartYear = currentSeasonStartYear(league, today);

    const existing = await db
      .select({ id: leagueRegistrations.id, withdrawnAt: leagueRegistrations.withdrawnAt })
      .from(leagueRegistrations)
      .where(
        and(
          eq(leagueRegistrations.swimmerId, swimmerId),
          eq(leagueRegistrations.league, league),
          eq(leagueRegistrations.seasonStartYear, seasonStartYear),
        ),
      )
      .limit(1);

    if (existing[0]) {
      if (existing[0].withdrawnAt !== null) {
        await db
          .update(leagueRegistrations)
          .set({ withdrawnAt: null })
          .where(eq(leagueRegistrations.id, existing[0].id));
      }
      // Already active — idempotent no-op
    } else {
      await db.insert(leagueRegistrations).values({
        swimmerId,
        league,
        seasonStartYear,
        registeredOn: today,
      });
    }

    res.status(200).end();
  }),
);

swimmersRouter.delete(
  "/:id/registrations/:league",
  requireUser,
  requireParent,
  validate({ params: LeagueRegistrationParamsSchema }),
  requireHouseholdMember,
  requireHouseholdRole("manager"),
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId, league } = req.params as unknown as LeagueRegistrationParams;
    const today = todayLA();
    const seasonStartYear = currentSeasonStartYear(league, today);

    const existing = await db
      .select({ id: leagueRegistrations.id })
      .from(leagueRegistrations)
      .where(
        and(
          eq(leagueRegistrations.swimmerId, swimmerId),
          eq(leagueRegistrations.league, league),
          eq(leagueRegistrations.seasonStartYear, seasonStartYear),
          isNull(leagueRegistrations.withdrawnAt),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      res.status(404).json({ error: "Not registered" });
      return;
    }

    await db
      .update(leagueRegistrations)
      .set({ withdrawnAt: new Date() })
      .where(eq(leagueRegistrations.id, existing[0].id));

    res.status(204).end();
  }),
);
