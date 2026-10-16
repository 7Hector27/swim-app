import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  evaluationDrafts,
  evaluationSessions,
  ratingFaultTags,
  skillRatings,
  skills,
  swimmers,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import {
  type EvaluationDraft,
  type SaveDraftBody,
  EvaluationDraftSchema,
  SaveDraftBodySchema,
  SCREEN_SKILLS,
  type ScreenSlug,
} from "@swim-app/shared";

const SwimmerScreenParamsSchema = z.object({
  id: z.string().uuid(),
  screenSlug: z.string(),
});

const SwimmerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const DraftIdParamsSchema = z.object({
  draftId: z.string().uuid(),
});

async function findActiveSwimmer(swimmerId: string) {
  const rows = await db
    .select({ id: swimmers.id, archivedAt: swimmers.archivedAt })
    .from(swimmers)
    .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
    .limit(1);
  return rows[0] ?? null;
}

function serializeDraft(row: {
  id: string;
  swimmerId: string;
  screenSlug: string;
  sessionDate: string | null;
  context: "drill" | "practice" | "race" | null;
  coachingPriority: string | null;
  breathingPattern: string | null;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}): EvaluationDraft {
  return EvaluationDraftSchema.parse({
    id: row.id,
    swimmerId: row.swimmerId,
    screenSlug: row.screenSlug,
    sessionDate: row.sessionDate,
    context: row.context,
    coachingPriority: row.coachingPriority,
    breathingPattern: row.breathingPattern,
    payload: row.payload ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export const coachDraftsRouter = Router({ mergeParams: true });

// ── PUT /coach/swimmers/:id/drafts/:screenSlug — upsert draft ─────────────────

coachDraftsRouter.put(
  "/:id/drafts/:screenSlug",
  validate({ params: SwimmerScreenParamsSchema, body: SaveDraftBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId, screenSlug } = req.params as { id: string; screenSlug: string };
    const body = req.body as SaveDraftBody;
    const coachId = req.profile.id;

    if (!(screenSlug in SCREEN_SKILLS)) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "screenSlug not valid" }] });
      return;
    }

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const rows = await db
      .insert(evaluationDrafts)
      .values({
        swimmerId,
        coachId,
        screenSlug,
        ...(body.sessionDate !== null && { sessionDate: body.sessionDate }),
        ...(body.context !== null && { context: body.context }),
        ...(body.coachingPriority !== null && { coachingPriority: body.coachingPriority }),
        ...(body.breathingPattern !== null && { breathingPattern: body.breathingPattern }),
        payload: body.payload,
      })
      .onConflictDoUpdate({
        target: [evaluationDrafts.coachId, evaluationDrafts.swimmerId, evaluationDrafts.screenSlug],
        set: {
          sessionDate: body.sessionDate,
          context: body.context,
          coachingPriority: body.coachingPriority,
          breathingPattern: body.breathingPattern,
          payload: body.payload,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: evaluationDrafts.id,
        swimmerId: evaluationDrafts.swimmerId,
        coachId: evaluationDrafts.coachId,
        screenSlug: evaluationDrafts.screenSlug,
        sessionDate: evaluationDrafts.sessionDate,
        context: evaluationDrafts.context,
        coachingPriority: evaluationDrafts.coachingPriority,
        breathingPattern: evaluationDrafts.breathingPattern,
        payload: evaluationDrafts.payload,
        createdAt: evaluationDrafts.createdAt,
        updatedAt: evaluationDrafts.updatedAt,
      });

    const draft = rows[0]!;
    res.status(200).json(serializeDraft(draft));
  }),
);

// ── GET /coach/swimmers/:id/drafts — list drafts for swimmer ──────────────────

coachDraftsRouter.get(
  "/:id/drafts",
  validate({ params: SwimmerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as { id: string };
    const coachId = req.profile.id;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const rows = await db
      .select({
        id: evaluationDrafts.id,
        swimmerId: evaluationDrafts.swimmerId,
        coachId: evaluationDrafts.coachId,
        screenSlug: evaluationDrafts.screenSlug,
        sessionDate: evaluationDrafts.sessionDate,
        context: evaluationDrafts.context,
        coachingPriority: evaluationDrafts.coachingPriority,
        breathingPattern: evaluationDrafts.breathingPattern,
        payload: evaluationDrafts.payload,
        createdAt: evaluationDrafts.createdAt,
        updatedAt: evaluationDrafts.updatedAt,
      })
      .from(evaluationDrafts)
      .where(
        and(
          eq(evaluationDrafts.coachId, coachId),
          eq(evaluationDrafts.swimmerId, swimmerId),
        ),
      )
      .orderBy(desc(evaluationDrafts.updatedAt));

    res.status(200).json({ drafts: rows.map(serializeDraft) });
  }),
);

export const draftsRouter = Router({ mergeParams: true });

// ── GET /coach/drafts/:draftId — get one draft ────────────────────────────────

draftsRouter.get(
  "/:draftId",
  validate({ params: DraftIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { draftId } = req.params as { draftId: string };
    const coachId = req.profile.id;

    const rows = await db
      .select({
        id: evaluationDrafts.id,
        swimmerId: evaluationDrafts.swimmerId,
        coachId: evaluationDrafts.coachId,
        screenSlug: evaluationDrafts.screenSlug,
        sessionDate: evaluationDrafts.sessionDate,
        context: evaluationDrafts.context,
        coachingPriority: evaluationDrafts.coachingPriority,
        breathingPattern: evaluationDrafts.breathingPattern,
        payload: evaluationDrafts.payload,
        createdAt: evaluationDrafts.createdAt,
        updatedAt: evaluationDrafts.updatedAt,
      })
      .from(evaluationDrafts)
      .where(eq(evaluationDrafts.id, draftId))
      .limit(1);

    const row = rows[0] ?? null;
    if (!row || row.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const swimmerForGet = await findActiveSwimmer(row.swimmerId);
    if (!swimmerForGet) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(200).json(serializeDraft(row));
  }),
);

// ── DELETE /coach/drafts/:draftId — delete draft ──────────────────────────────

draftsRouter.delete(
  "/:draftId",
  validate({ params: DraftIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { draftId } = req.params as { draftId: string };
    const coachId = req.profile.id;

    const existing = await db
      .select({ id: evaluationDrafts.id, coachId: evaluationDrafts.coachId })
      .from(evaluationDrafts)
      .where(eq(evaluationDrafts.id, draftId))
      .limit(1);

    const row = existing[0] ?? null;
    if (!row || row.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await db.delete(evaluationDrafts).where(eq(evaluationDrafts.id, draftId));
    res.status(204).end();
  }),
);

// ── POST /coach/drafts/:draftId/finalize — finalize draft into session ────────

draftsRouter.post(
  "/:draftId/finalize",
  validate({ params: DraftIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { draftId } = req.params as { draftId: string };
    const coachId = req.profile.id;

    const draftRows = await db
      .select({
        id: evaluationDrafts.id,
        swimmerId: evaluationDrafts.swimmerId,
        coachId: evaluationDrafts.coachId,
        screenSlug: evaluationDrafts.screenSlug,
        sessionDate: evaluationDrafts.sessionDate,
        context: evaluationDrafts.context,
        coachingPriority: evaluationDrafts.coachingPriority,
        breathingPattern: evaluationDrafts.breathingPattern,
        payload: evaluationDrafts.payload,
      })
      .from(evaluationDrafts)
      .where(eq(evaluationDrafts.id, draftId))
      .limit(1);

    const draft = draftRows[0] ?? null;
    if (!draft || draft.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const swimmer = await findActiveSwimmer(draft.swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Swimmer not found" });
      return;
    }

    const screenSlug = draft.screenSlug;
    if (!(screenSlug in SCREEN_SKILLS)) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "screenSlug not valid" }] });
      return;
    }

    if (!draft.sessionDate) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "sessionDate is required to finalize" }] });
      return;
    }

    if (!draft.context) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "context is required to finalize" }] });
      return;
    }

    if (!draft.coachingPriority || draft.coachingPriority.trim() === "") {
      res.status(422).json({ error: "Validation error", issues: [{ message: "coachingPriority is required to finalize" }] });
      return;
    }

    if ((screenSlug === "freestyle" || screenSlug === "butterfly") && draft.breathingPattern === null) {
      res.status(422).json({ error: "Validation error", issues: [{ path: ["breathingPattern"], message: "breathingPattern is required for freestyle and butterfly screens" }] });
      return;
    }
    if (screenSlug !== "freestyle" && screenSlug !== "butterfly" && draft.breathingPattern !== null) {
      res.status(422).json({ error: "Validation error", issues: [{ path: ["breathingPattern"], message: "breathingPattern must be null for this screen" }] });
      return;
    }

    const screenSkillSlugs = new Set(SCREEN_SKILLS[screenSlug as ScreenSlug] ?? []);

    const allSkillRows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        parentSkillId: skills.parentSkillId,
        type: skills.type,
        unit: skills.unit,
        faultTags: skills.faultTags,
        ratedPerSide: skills.ratedPerSide,
        notLegalAllowed: skills.notLegalAllowed,
        archivedAt: skills.archivedAt,
      })
      .from(skills)
      .where(isNull(skills.archivedAt));

    const skillMap = new Map(allSkillRows.map((skill) => [skill.id, skill]));

    const payload = (draft.payload ?? {}) as Record<string, {
      grade: 1 | 2 | 3 | 4 | 5 | null;
      notLegal: boolean;
      noConcept: boolean;
      side?: "left" | "right" | null;
      faultTags: string[];
      capacityValue: string;
      capacityUnit: "yards" | "reps" | null;
      measurementValue: string;
      measurementUnit: string | null;
      golfScoreCategory: "push_off_in_water" | "deck_dive" | "block_dive" | null;
      note: string;
    }>;

    type RatingEntry = {
      skillId: string;
      grade: number | null;
      notLegal: boolean;
      noConcept: boolean;
      side: "left" | "right" | null;
      faultTags: string[];
      capacityValue: string | null;
      capacityUnit: "yards" | "reps" | null;
      measurementValue: string | null;
      measurementUnit: string | null;
      golfScoreCategory: "push_off_in_water" | "deck_dive" | "block_dive" | null;
      note: string | null;
    };

    const ratingsToInsert: RatingEntry[] = [];
    const issues: Array<{ path?: string[]; message: string }> = [];

    for (const [key, entry] of Object.entries(payload)) {
      if (entry.grade === null && !entry.noConcept) continue;

      const isLeftRight = key.includes(":");
      const skillId = isLeftRight ? key.split(":")[0]! : key;
      const sideFromKey = isLeftRight ? (key.split(":")[1] as "left" | "right") : null;

      const skill = skillMap.get(skillId);
      if (!skill) {
        issues.push({ path: [`payload.${key}.skillId`], message: "Skill not found or archived" });
        continue;
      }

      if (skill.type === "rollup") {
        issues.push({ path: [`payload.${key}.skillId`], message: "Rollup skills are calculated and cannot be rated directly" });
        continue;
      }

      if (skill.type === "score" && entry.golfScoreCategory === null && !entry.noConcept) {
        issues.push({ path: [`payload.${key}.golfScoreCategory`], message: "Golf score category is required for score skills" });
        continue;
      }
      if (skill.type !== "score" && entry.golfScoreCategory !== null) {
        issues.push({ path: [`payload.${key}.golfScoreCategory`], message: "Golf score category only applies to score skills" });
        continue;
      }

      if (!screenSkillSlugs.has(skill.slug)) {
        issues.push({ path: [`payload.${key}.skillId`], message: "Skill does not belong to the session screen" });
        continue;
      }

      if (skill.ratedPerSide && sideFromKey === null) {
        issues.push({ path: [`payload.${key}.side`], message: "side is required for this skill" });
        continue;
      }
      if (!skill.ratedPerSide && sideFromKey !== null) {
        issues.push({ path: [`payload.${key}.side`], message: "side must be absent for this skill" });
        continue;
      }

      const allowedFaultTags = skill.faultTags ?? [];
      for (const tag of entry.faultTags) {
        if (!allowedFaultTags.includes(tag)) {
          issues.push({ path: [`payload.${key}.faultTags`], message: `Invalid fault tag: ${tag}` });
        }
      }

      if (entry.notLegal && !skill.notLegalAllowed) {
        issues.push({ path: [`payload.${key}.notLegal`], message: "Not legal is not allowed for this skill" });
        continue;
      }

      const measurementValue = entry.measurementValue !== "" ? entry.measurementValue : null;
      const measurementUnit = entry.measurementUnit;

      if ((measurementValue !== null || measurementUnit !== null) && skill.type !== "measured") {
        issues.push({ path: [`payload.${key}.measurementValue`], message: "Measurements only allowed on measured skills" });
        continue;
      }

      if (measurementUnit !== null && skill.unit !== null && measurementUnit !== skill.unit) {
        issues.push({ path: [`payload.${key}.measurementUnit`], message: `Measurement unit must be ${skill.unit}` });
        continue;
      }

      ratingsToInsert.push({
        skillId,
        grade: entry.grade,
        notLegal: entry.notLegal,
        noConcept: entry.noConcept,
        side: sideFromKey,
        faultTags: entry.faultTags,
        capacityValue: entry.capacityValue !== "" ? entry.capacityValue : null,
        capacityUnit: entry.capacityUnit,
        measurementValue,
        measurementUnit,
        golfScoreCategory: entry.golfScoreCategory,
        note: entry.note !== "" ? entry.note : null,
      });
    }

    if (issues.length > 0) {
      res.status(422).json({ error: "Validation error", issues });
      return;
    }

    if (ratingsToInsert.length === 0) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "No completed ratings to finalize" }] });
      return;
    }

    const seenRatingKeys = new Set<string>();
    for (const ratingEntry of ratingsToInsert) {
      const key = `${ratingEntry.skillId}:${ratingEntry.side ?? ""}`;
      if (seenRatingKeys.has(key)) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ message: "Duplicate rating for the same skill and side in this session" }],
        });
        return;
      }
      seenRatingKeys.add(key);
    }

    const ratedAt = new Date();

    const result = await db.transaction(async (tx) => {
      const sessionRows = await tx
        .insert(evaluationSessions)
        .values({
          swimmerId: draft.swimmerId,
          coachId,
          screenSlug,
          ...(draft.breathingPattern !== null && { breathingPattern: draft.breathingPattern }),
          sessionDate: draft.sessionDate!,
          context: draft.context!,
          coachingPriority: draft.coachingPriority!,
        })
        .returning({ id: evaluationSessions.id });

      const session = sessionRows[0]!;
      const ratingIds: string[] = [];

      for (const ratingEntry of ratingsToInsert) {
        const ratingRows = await tx
          .insert(skillRatings)
          .values({
            sessionId: session.id,
            swimmerId: draft.swimmerId,
            skillId: ratingEntry.skillId,
            coachId,
            grade: ratingEntry.grade,
            notLegal: ratingEntry.notLegal,
            noConcept: ratingEntry.noConcept,
            ...(ratingEntry.side !== null && { side: ratingEntry.side }),
            ...(ratingEntry.capacityValue !== null && { capacityValue: ratingEntry.capacityValue }),
            ...(ratingEntry.capacityUnit !== null && { capacityUnit: ratingEntry.capacityUnit }),
            ...(ratingEntry.measurementValue !== null && { measurementValue: ratingEntry.measurementValue }),
            ...(ratingEntry.measurementUnit !== null && { measurementUnit: ratingEntry.measurementUnit as "stroke_cycles_per_minute" | "stroke_count" | "seconds" | "feet" }),
            ...(ratingEntry.golfScoreCategory !== null && { golfScoreCategory: ratingEntry.golfScoreCategory }),
            ...(ratingEntry.note !== null && { note: ratingEntry.note }),
            ratedAt,
          })
          .returning({ id: skillRatings.id });

        const rating = ratingRows[0]!;
        ratingIds.push(rating.id);

        if (ratingEntry.faultTags.length > 0) {
          await tx.insert(ratingFaultTags).values(
            ratingEntry.faultTags.map((tag) => ({
              ratingId: rating.id,
              faultTag: tag,
            })),
          );
        }
      }

      await tx.delete(evaluationDrafts).where(eq(evaluationDrafts.id, draftId));

      return { session, ratingIds };
    });

    req.log.info(
      { swimmerId: draft.swimmerId, sessionId: result.session.id, coachId, ratingsCount: ratingsToInsert.length, draftId },
      "draft finalized into session",
    );

    res.status(201).json({
      sessionId: result.session.id,
      ratingsCount: ratingsToInsert.length,
      ratingIds: result.ratingIds,
    });
  }),
);
