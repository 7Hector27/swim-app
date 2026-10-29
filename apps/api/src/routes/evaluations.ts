import { Router } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  evaluationSessions,
  ratingFaultTags,
  skillCategories,
  skillDependencies,
  skillLevelDescriptors,
  skillRatings,
  skills,
  swimmers,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import { computeSwimmerProgress } from "../lib/progressCalculation";
import { computeScoreHistory } from "../lib/scoreHistory";
import {
  type CreateSessionBody,
  type CreateSessionResponse,
  type VoidRatingBody,
  type DependencyMapQuery,
  type GolfScoreTrend,
  type GolfScoreCategoryTrend,
  type GolfScoreAgeBands,
  type GetSessionResponse,
  type GetSessionRating,
  type PatchSessionBody,
  type PatchSessionResponse,
  CreateSessionBodySchema,
  VoidRatingBodySchema,
  DependencyMapQuerySchema,
  CoachSkillRatingSchema,
  GolfScoreCategorySchema,
  PatchSessionBodySchema,
  findDeepestLowFoundation,
  headPositionOverall,
  latestEffectiveRatings,
  calculateStartGrade,
  weakerSideGrade,
  ageToGroup,
  calculateAge,
  todayLA,
  type RatingRecord,
  type GradeMap,
  type BuiltOnGraph,
  type SortOrderMap,
  type PerStrokeGrades,
  type ChainEntry,
  SCREEN_SKILLS,
  SCREEN_SLUGS,
  SCREEN_NAMES,
  type ScreenSlug,
  displayUnitToMeasurementEnum,
} from "@swim-app/shared";

const RatingIdParamsSchema = z.object({ id: z.string().uuid() });
type RatingIdParams = z.infer<typeof RatingIdParamsSchema>;

const SwimmerIdParamsSchema = z.object({ id: z.string().uuid() });
type SwimmerIdParams = z.infer<typeof SwimmerIdParamsSchema>;

const SwimmerSkillParamsSchema = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid(),
});
type SwimmerSkillParams = z.infer<typeof SwimmerSkillParamsSchema>;

const UNDO_WINDOW_MS = 10 * 60 * 1000;

// Returns the swimmer row only if it is active (not archived).
// Returns null when the swimmer does not exist or is archived.
async function findActiveSwimmer(swimmerId: string) {
  const rows = await db
    .select({ id: swimmers.id, archivedAt: swimmers.archivedAt })
    .from(swimmers)
    .where(and(isActiveSwimmer, eq(swimmers.id, swimmerId)))
    .limit(1);
  return rows[0] ?? null;
}

export const evaluationsRouter = Router();

// ── POST /swimmers/:id/sessions ───────────────────────────────────────────────

evaluationsRouter.post(
  "/:id/sessions",
  validate({ params: SwimmerIdParamsSchema, body: CreateSessionBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;
    const body = req.body as CreateSessionBody;
    const coachId = req.profile.id;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Validate screenSlug
    const screenSlug = body.screenSlug;
    if (!(screenSlug in SCREEN_SKILLS)) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "screenSlug not valid" }] });
      return;
    }

    if (body.screenSlug === "water-confidence" && body.context === "race") {
      res.status(422).json({
        error: "Validation error",
        issues: [{ message: "Water confidence sessions do not support race context" }],
      });
      return;
    }

    // Breathing pattern required for freestyle and butterfly, must be null otherwise
    if ((body.screenSlug === "freestyle" || body.screenSlug === "butterfly") && body.breathingPattern === null) {
      res.status(422).json({ error: "Validation error", issues: [{ path: ["breathingPattern"], message: "breathingPattern is required for freestyle and butterfly screens" }] });
      return;
    }
    if (body.screenSlug !== "freestyle" && body.screenSlug !== "butterfly" && body.breathingPattern !== null) {
      res.status(422).json({ error: "Validation error", issues: [{ path: ["breathingPattern"], message: "breathingPattern must be null for this screen" }] });
      return;
    }

    const screenSkillSlugs = new Set(SCREEN_SKILLS[body.screenSlug as ScreenSlug] ?? []);

    // Load the full non-archived skill catalog for validation.
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

    // Per-rating cross-field validation
    for (const [index, ratingInput] of body.ratings.entries()) {
      const skill = skillMap.get(ratingInput.skillId);

      if (!skill) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].skillId`], message: "Skill not found or archived" }],
        });
        return;
      }

      // Rollup skills are calculated — they cannot be rated directly
      if (skill.type === "rollup") {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].skillId`], message: "Rollup skills are calculated and cannot be rated directly" }],
        });
        return;
      }

      // golfScoreCategory: required for score-type skills, null for others
      if (skill.type === "score" && ratingInput.golfScoreCategory === null && !ratingInput.noConcept) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].golfScoreCategory`], message: "Golf score category is required for score skills" }],
        });
        return;
      }
      if (skill.type !== "score" && ratingInput.golfScoreCategory !== null) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].golfScoreCategory`], message: "Golf score category only applies to score skills" }],
        });
        return;
      }

      // Skill must be in the screen's skill list (by slug)
      if (!screenSkillSlugs.has(skill.slug)) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].skillId`], message: "Skill does not belong to the session screen" }],
        });
        return;
      }

      // side required when ratedPerSide, must be absent otherwise
      if (skill.ratedPerSide && ratingInput.side === null) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].side`], message: "side is required for this skill" }],
        });
        return;
      }
      if (!skill.ratedPerSide && ratingInput.side !== null) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].side`], message: "side must be absent for this skill" }],
        });
        return;
      }

      // fault tags must be in skill.faultTags
      const allowedFaultTags = skill.faultTags ?? [];
      for (const tag of ratingInput.faultTags) {
        if (!allowedFaultTags.includes(tag)) {
          res.status(422).json({
            error: "Validation error",
            issues: [{ path: [`ratings[${index}].faultTags`], message: `Invalid fault tag: ${tag}` }],
          });
          return;
        }
      }

      // not_legal is only allowed on skills with notLegalAllowed = true
      if (ratingInput.notLegal && !skill.notLegalAllowed) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].notLegal`], message: "Not legal is not allowed for this skill" }],
        });
        return;
      }

      // measurement only allowed on measured skills
      if (
        (ratingInput.measurementValue !== null || ratingInput.measurementUnit !== null) &&
        skill.type !== "measured"
      ) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].measurementValue`], message: "Measurements only allowed on measured skills" }],
        });
        return;
      }

      // measurement unit must match skill.unit when present. `skill.unit` is
      // the catalog's free-text display label (e.g. "cycles/min"); the submitted
      // `measurementUnit` is the DB enum ("stroke_cycles_per_minute"). Map via
      // the shared helper so the comparison is on equal footing.
      if (
        ratingInput.measurementUnit !== null &&
        skill.unit !== null
      ) {
        const expectedEnum = displayUnitToMeasurementEnum(skill.unit);
        if (expectedEnum !== null && ratingInput.measurementUnit !== expectedEnum) {
          res.status(422).json({
            error: "Validation error",
            issues: [{ path: ["ratings", index, "measurementUnit"], message: `Measurement unit must be ${skill.unit}` }],
          });
          return;
        }
      }
    }

    const seenRatingKeys = new Set<string>();
    for (const [index, ratingInput] of body.ratings.entries()) {
      const key = `${ratingInput.skillId}:${ratingInput.side ?? ""}`;
      if (seenRatingKeys.has(key)) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}]`], message: "Duplicate rating for the same skill and side in this session" }],
        });
        return;
      }
      seenRatingKeys.add(key);
    }

    // Normalize an all-whitespace coaching priority to null. The schema's
    // z.string().min(1).nullable() rejects empty strings but accepts whitespace;
    // we treat "no visible characters" as "no priority".
    const normalizedPriority = body.coachingPriority === null
      ? null
      : body.coachingPriority.trim().length === 0
        ? null
        : body.coachingPriority;

    // All validations passed — insert session + ratings in one transaction
    const result = await db.transaction(async (tx) => {
      const sessionRows = await tx
        .insert(evaluationSessions)
        .values({
          swimmerId,
          coachId,
          screenSlug: body.screenSlug,
          ...(body.breathingPattern !== null && { breathingPattern: body.breathingPattern }),
          sessionDate: body.sessionDate,
          context: body.context,
          coachingPriority: normalizedPriority,
        })
        .returning({ id: evaluationSessions.id });

      const session = sessionRows[0]!;

      const ratingIds: string[] = [];
      for (const ratingInput of body.ratings) {
        const ratingRows = await tx
          .insert(skillRatings)
          .values({
            sessionId: session.id,
            swimmerId,
            skillId: ratingInput.skillId,
            coachId,
            grade: ratingInput.grade,
            notLegal: ratingInput.notLegal,
            noConcept: ratingInput.noConcept,
            ...(ratingInput.side !== null && { side: ratingInput.side }),
            ...(ratingInput.capacityValue !== null && { capacityValue: ratingInput.capacityValue }),
            ...(ratingInput.capacityUnit !== null && { capacityUnit: ratingInput.capacityUnit }),
            ...(ratingInput.measurementValue !== null && { measurementValue: ratingInput.measurementValue }),
            ...(ratingInput.measurementUnit !== null && { measurementUnit: ratingInput.measurementUnit }),
            ...(ratingInput.golfScoreCategory !== null && { golfScoreCategory: ratingInput.golfScoreCategory }),
            ...(ratingInput.note !== null && { note: ratingInput.note }),
            ratedAt: new Date(ratingInput.ratedAt),
          })
          .returning({ id: skillRatings.id });

        const rating = ratingRows[0]!;
        ratingIds.push(rating.id);

        if (ratingInput.faultTags.length > 0) {
          await tx.insert(ratingFaultTags).values(
            ratingInput.faultTags.map((tag) => ({
              ratingId: rating.id,
              faultTag: tag,
            })),
          );
        }
      }

      return { session, ratingIds };
    });

    req.log.info({ swimmerId, sessionId: result.session.id, coachId, ratingsCount: body.ratings.length }, "session created");

    const response: CreateSessionResponse = {
      sessionId: result.session.id,
      ratingsCount: body.ratings.length,
      ratingIds: result.ratingIds,
    };
    res.status(201).json(response);
  }),
);

// ── GET /swimmers/:id/skills ──────────────────────────────────────────────────

evaluationsRouter.get(
  "/:id/skills",
  validate({ params: SwimmerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Fetch all non-voided ratings for this swimmer alongside their skill slugs
    const ratingRows = await db
      .select({
        slug: skills.slug,
        grade: skillRatings.grade,
        notLegal: skillRatings.notLegal,
        noConcept: skillRatings.noConcept,
        side: skillRatings.side,
        ratedAt: skillRatings.ratedAt,
        voidedAt: skillRatings.voidedAt,
        supersededAt: skillRatings.supersededAt,
        skillId: skillRatings.skillId,
        parentSkillId: skills.parentSkillId,
        skillType: skills.type,
        sortOrder: skills.sortOrder,
        ratedPerSide: skills.ratedPerSide,
      })
      .from(skillRatings)
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .where(eq(skillRatings.swimmerId, swimmerId));

    const ratingRecords: RatingRecord[] = ratingRows.map((row) => ({
      skillSlug: row.slug,
      side: row.side ?? null,
      grade: row.grade as 1 | 2 | 3 | 4 | 5 | null,
      notLegal: row.notLegal,
      noConcept: row.noConcept,
      ratedAt: row.ratedAt.toISOString(),
      voidedAt: row.voidedAt?.toISOString() ?? null,
      supersededAt: row.supersededAt?.toISOString() ?? null,
    }));

    const grades: GradeMap = latestEffectiveRatings(ratingRecords);

    // Collapse compound keys ("slug:left"/"slug:right") to plain slug keys so
    // graph lookups in findDeepestLowFoundation (which uses plain slugs) work
    // correctly. The raw `grades` map is still sent in the response.
    const collapsedGrades: GradeMap = {};
    for (const [key, value] of Object.entries(grades)) {
      if (!key.includes(":")) {
        collapsedGrades[key] = value;
      } else {
        const plainSlug = key.slice(0, key.lastIndexOf(":"));
        if (!(plainSlug in collapsedGrades)) {
          collapsedGrades[plainSlug] = weakerSideGrade(
            grades[`${plainSlug}:left`],
            grades[`${plainSlug}:right`],
          );
        }
      }
    }

    // Build sort order map from skill rows
    const sortOrder: SortOrderMap = {};
    for (const row of ratingRows) {
      sortOrder[row.slug] = row.sortOrder;
    }

    // Fetch all skills with their slugs for start grade and head position computation
    const allSkillRows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        parentSkillId: skills.parentSkillId,
        categoryId: skills.categoryId,
        sortOrder: skills.sortOrder,
      })
      .from(skills)
      .where(isNull(skills.archivedAt));

    // Identify start parent skills (slugs ending with "-start")
    const startParentSlugs = allSkillRows
      .filter((skill) => skill.slug.endsWith("-start"))
      .map((skill) => skill.slug);

    // Build start grades for each start type
    const startGrades: Record<string, ReturnType<typeof calculateStartGrade>> = {};
    for (const startSlug of startParentSlugs) {
      const parentSkill = allSkillRows.find((skill) => skill.slug === startSlug);
      if (!parentSkill) continue;

      const componentSlugs = allSkillRows
        .filter((skill) => skill.parentSkillId === parentSkill.id)
        .map((skill) => skill.slug);

      if (componentSlugs.length === 0) continue;

      startGrades[startSlug] = calculateStartGrade(componentSlugs, ratingRecords);
    }

    // Extract per-stroke head position grades from the collapsed grades map
    const headPositionSlugs = {
      free: "head-position-free",
      back: "head-position-back",
      breast: "head-position-breast",
      fly: "head-position-fly",
    } as const;

    const perStrokeGrades: PerStrokeGrades = {
      ...(collapsedGrades[headPositionSlugs.free] !== undefined && { free: collapsedGrades[headPositionSlugs.free] }),
      ...(collapsedGrades[headPositionSlugs.back] !== undefined && { back: collapsedGrades[headPositionSlugs.back] }),
      ...(collapsedGrades[headPositionSlugs.breast] !== undefined && { breast: collapsedGrades[headPositionSlugs.breast] }),
      ...(collapsedGrades[headPositionSlugs.fly] !== undefined && { fly: collapsedGrades[headPositionSlugs.fly] }),
    };

    const headPositionResult = headPositionOverall(perStrokeGrades);

    // Build BuiltOnGraph: skillSlug -> list of slugs it depends on (builds on)
    const graph: BuiltOnGraph = {};

    const depRowsDetailed = await db
      .select({
        skillId: skillDependencies.skillId,
        dependsOnSkillId: skillDependencies.dependsOnSkillId,
      })
      .from(skillDependencies);

    const skillSlugById = new Map(allSkillRows.map((skill) => [skill.id, skill.slug]));

    for (const dep of depRowsDetailed) {
      const skillSlug = skillSlugById.get(dep.skillId);
      const dependsOnSlug = skillSlugById.get(dep.dependsOnSkillId);
      if (!skillSlug || !dependsOnSlug) continue;
      const existing = graph[skillSlug] ?? [];
      existing.push(dependsOnSlug);
      graph[skillSlug] = existing;
    }

    // Build sort order for all skills
    const fullSortOrder: SortOrderMap = {};
    for (const skill of allSkillRows) {
      fullSortOrder[skill.slug] = skill.sortOrder;
    }

    // Compute coaching priorities using collapsedGrades so sided-skill plain
    // slugs resolve correctly against the dependency graph.
    const coachingPriorities: Array<{ targetSlug: string; chain: ChainEntry[] }> = [];
    for (const slug of Object.keys(collapsedGrades)) {
      const chain = findDeepestLowFoundation(slug, collapsedGrades, graph, fullSortOrder);
      if (chain !== null) {
        coachingPriorities.push({ targetSlug: slug, chain });
      }
    }

    req.log.info({ swimmerId, skillCount: Object.keys(grades).length }, "swimmer skills fetched");

    res.json({
      grades,
      startGrades,
      headPositionOverall: headPositionResult,
      coachingPriorities,
    });
  }),
);

// ── GET /swimmers/:id/skills/:skillId/ratings ─────────────────────────────────

evaluationsRouter.get(
  "/:id/skills/:skillId/ratings",
  validate({ params: SwimmerSkillParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId, skillId } = req.params as unknown as SwimmerSkillParams;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const skillRows = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.id, skillId))
      .limit(1);

    if (!skillRows[0]) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const ratingRows = await db
      .select({
        id: skillRatings.id,
        sessionId: skillRatings.sessionId,
        swimmerId: skillRatings.swimmerId,
        skillId: skillRatings.skillId,
        coachId: skillRatings.coachId,
        grade: skillRatings.grade,
        notLegal: skillRatings.notLegal,
        noConcept: skillRatings.noConcept,
        side: skillRatings.side,
        capacityValue: skillRatings.capacityValue,
        capacityUnit: skillRatings.capacityUnit,
        measurementValue: skillRatings.measurementValue,
        measurementUnit: skillRatings.measurementUnit,
        note: skillRatings.note,
        voidedAt: skillRatings.voidedAt,
        voidReason: skillRatings.voidReason,
        voidBy: skillRatings.voidBy,
        ratedAt: skillRatings.ratedAt,
        createdAt: skillRatings.createdAt,
        updatedAt: skillRatings.updatedAt,
      })
      .from(skillRatings)
      .where(
        and(
          eq(skillRatings.swimmerId, swimmerId),
          eq(skillRatings.skillId, skillId),
        ),
      )
      .orderBy(desc(skillRatings.ratedAt));

    req.log.info({ swimmerId, skillId, count: ratingRows.length }, "skill rating history fetched");

    // coach-only route — switch to ParentSkillRatingSchema before adding any parent access
    res.json(ratingRows.map((row) => CoachSkillRatingSchema.parse({
      ...row,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      ratedAt: row.ratedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })));
  }),
);

// ── GET /swimmers/:id/sessions/dependency-map ─────────────────────────────────

evaluationsRouter.get(
  "/:id/sessions/dependency-map",
  validate({ params: SwimmerIdParamsSchema, query: DependencyMapQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;
    const { screenSlug } = req.query as unknown as DependencyMapQuery;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Fetch all ratings for this swimmer
    const ratingRows = await db
      .select({
        slug: skills.slug,
        grade: skillRatings.grade,
        notLegal: skillRatings.notLegal,
        noConcept: skillRatings.noConcept,
        side: skillRatings.side,
        ratedAt: skillRatings.ratedAt,
        voidedAt: skillRatings.voidedAt,
        supersededAt: skillRatings.supersededAt,
        sortOrder: skills.sortOrder,
      })
      .from(skillRatings)
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .where(eq(skillRatings.swimmerId, swimmerId));

    const ratingRecords: RatingRecord[] = ratingRows.map((row) => ({
      skillSlug: row.slug,
      side: row.side ?? null,
      grade: row.grade as 1 | 2 | 3 | 4 | 5 | null,
      notLegal: row.notLegal,
      noConcept: row.noConcept,
      ratedAt: row.ratedAt.toISOString(),
      voidedAt: row.voidedAt?.toISOString() ?? null,
      supersededAt: row.supersededAt?.toISOString() ?? null,
    }));

    const grades: GradeMap = latestEffectiveRatings(ratingRecords);

    // Restrict to skills whose slug is in the requested screen
    const skillSlugs = SCREEN_SKILLS[screenSlug as ScreenSlug] ?? [];
    const screenSkillSlugs = new Set(skillSlugs);

    // Build full sortOrder and dependency graph
    const allSkillRows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        sortOrder: skills.sortOrder,
      })
      .from(skills)
      .where(isNull(skills.archivedAt));

    const skillSlugById = new Map(allSkillRows.map((skill) => [skill.id, skill.slug]));

    const depRows = await db
      .select({
        skillId: skillDependencies.skillId,
        dependsOnSkillId: skillDependencies.dependsOnSkillId,
      })
      .from(skillDependencies);

    const graph: BuiltOnGraph = {};
    for (const dep of depRows) {
      const skillSlug = skillSlugById.get(dep.skillId);
      const dependsOnSlug = skillSlugById.get(dep.dependsOnSkillId);
      if (!skillSlug || !dependsOnSlug) continue;
      const existing = graph[skillSlug] ?? [];
      existing.push(dependsOnSlug);
      graph[skillSlug] = existing;
    }

    const fullSortOrder: SortOrderMap = {};
    for (const skill of allSkillRows) {
      fullSortOrder[skill.slug] = skill.sortOrder;
    }

    // Find deepest low foundation across screen skills
    let bestChain: ChainEntry[] | null = null;
    let bestDepth = -1;

    for (const slug of screenSkillSlugs) {
      if (!(slug in grades)) continue;
      const chain = findDeepestLowFoundation(slug, grades, graph, fullSortOrder);
      if (chain !== null && chain.length > bestDepth) {
        bestDepth = chain.length;
        bestChain = chain;
      }
    }

    req.log.info({ swimmerId, screenSlug }, "dependency map suggestion computed");

    res.json({ suggestion: bestChain });
  }),
);

// ── GET /swimmers/:id/progress ────────────────────────────────────────────────

evaluationsRouter.get(
  "/:id/progress",
  validate({ params: SwimmerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const result = await computeSwimmerProgress(swimmerId);
    req.log.info({ swimmerId, skillCount: result.skills.length }, "swimmer progress fetched");
    res.json(result);
  }),
);

// ── GET /swimmers/:id/score-history ───────────────────────────────────────────

evaluationsRouter.get(
  "/:id/score-history",
  validate({ params: SwimmerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const result = await computeScoreHistory(swimmerId);
    req.log.info({ swimmerId, pointCount: result.points.length }, "swimmer score history fetched");
    res.json(result);
  }),
);

// ── GET /swimmers/:id/golf-score-trends ───────────────────────────────────────

function computePercentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (index - lower) * (sorted[upper]! - sorted[lower]!);
}

evaluationsRouter.get(
  "/:id/golf-score-trends",
  validate({ params: SwimmerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const ratingRows = await db
      .select({
        grade: skillRatings.grade,
        measurementValue: skillRatings.measurementValue,
        golfScoreCategory: skillRatings.golfScoreCategory,
        ratedAt: skillRatings.ratedAt,
        sessionDate: evaluationSessions.sessionDate,
        skillId: skills.id,
        slug: skills.slug,
        name: skills.name,
      })
      .from(skillRatings)
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .innerJoin(evaluationSessions, eq(evaluationSessions.id, skillRatings.sessionId))
      .where(
        and(
          eq(skillRatings.swimmerId, swimmerId),
          isNull(skillRatings.voidedAt),
          isNull(skillRatings.supersededAt),
          eq(skills.type, "score"),
          isNotNull(skillRatings.golfScoreCategory),
        ),
      )
      .orderBy(asc(skillRatings.ratedAt));

    const swimmerRows = await db
      .select({ birthDate: swimmers.birthDate })
      .from(swimmers)
      .where(eq(swimmers.id, swimmerId))
      .limit(1);

    const birthDate = swimmerRows[0]?.birthDate ?? null;
    const ageGroup = birthDate !== null ? ageToGroup(calculateAge(birthDate, todayLA())) : null;

    type SkillKey = string;
    type CategoryKey = string;

    const skillMap = new Map<SkillKey, { slug: string; name: string; categories: Map<CategoryKey, Array<typeof ratingRows[number]>> }>();

    for (const row of ratingRows) {
      const category = row.golfScoreCategory;
      if (category === null) continue;

      let skillEntry = skillMap.get(row.skillId);
      if (!skillEntry) {
        skillEntry = { slug: row.slug, name: row.name, categories: new Map() };
        skillMap.set(row.skillId, skillEntry);
      }

      let categoryPoints = skillEntry.categories.get(category);
      if (!categoryPoints) {
        categoryPoints = [];
        skillEntry.categories.set(category, categoryPoints);
      }

      categoryPoints.push(row);
    }

    const trends: GolfScoreTrend[] = [];

    // Fetch cohort swimmer IDs once, before any skill/category loops, to avoid N+1 queries.
    let cohortIds: string[] = [];
    if (ageGroup !== null) {
      const cohortSwimmerRows = await db
        .select({ id: swimmers.id, birthDate: swimmers.birthDate })
        .from(swimmers)
        .where(isActiveSwimmer);

      const today = todayLA();
      cohortIds = cohortSwimmerRows
        .filter((cohortSwimmer) => {
          if (cohortSwimmer.id === swimmerId) return false;
          const swimmerAgeGroup = ageToGroup(calculateAge(cohortSwimmer.birthDate, today));
          return swimmerAgeGroup === ageGroup;
        })
        .map((cohortSwimmer) => cohortSwimmer.id);
    }

    for (const [, skillEntry] of skillMap) {
      const byCategory: GolfScoreCategoryTrend[] = [];

      for (const [category, points] of skillEntry.categories) {
        const parsedCategory = GolfScoreCategorySchema.safeParse(category);
        if (!parsedCategory.success) continue;

        let ageBands: GolfScoreAgeBands | null = null;

        if (ageGroup !== null) {

          if (cohortIds.length > 0) {
            const cohortRows = await db
              .select({
                swimmerId: skillRatings.swimmerId,
                measurementValue: skillRatings.measurementValue,
                ratedAt: skillRatings.ratedAt,
              })
              .from(skillRatings)
              .innerJoin(skills, eq(skills.id, skillRatings.skillId))
              .where(
                and(
                  eq(skills.slug, skillEntry.slug),
                  eq(skillRatings.golfScoreCategory, category),
                  isNull(skillRatings.voidedAt),
                  isNull(skillRatings.supersededAt),
                  isNotNull(skillRatings.measurementValue),
                  inArray(skillRatings.swimmerId, cohortIds),
                  eq(skills.type, "score"),
                ),
              )
              .orderBy(skillRatings.swimmerId, desc(skillRatings.ratedAt));

            const seenSwimmerIds = new Set<string>();
            const latestValues: number[] = [];
            for (const cohortRow of cohortRows) {
              if (seenSwimmerIds.has(cohortRow.swimmerId)) continue;
              seenSwimmerIds.add(cohortRow.swimmerId);
              const value = parseFloat(cohortRow.measurementValue ?? "");
              if (!isNaN(value)) latestValues.push(value);
            }

            latestValues.sort((first, second) => first - second);

            if (latestValues.length >= 10) {
              ageBands = {
                bandCount: latestValues.length,
                p25: computePercentile(latestValues, 25),
                p50: computePercentile(latestValues, 50),
                p75: computePercentile(latestValues, 75),
              };
            }
          }
        }

        byCategory.push({
          category: parsedCategory.data,
          points: points.map((point) => ({
            ratedAt: point.ratedAt.toISOString(),
            sessionDate: point.sessionDate,
            grade: point.grade,
            measurementValue: point.measurementValue ?? null,
          })),
          ageBands,
        });
      }

      if (byCategory.length > 0) {
        trends.push({
          skillSlug: skillEntry.slug,
          skillName: skillEntry.name,
          byCategory,
        });
      }
    }

    req.log.info({ swimmerId, trendCount: trends.length }, "golf score trends fetched");
    res.json({ trends });
  }),
);

// ── DELETE /sessions/:id ──────────────────────────────────────────────────────

export const sessionsRouter = Router();

const SessionIdParamsSchema = z.object({ id: z.string().uuid() });
type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;

sessionsRouter.delete(
  "/:id",
  validate({ params: SessionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: sessionId } = req.params as unknown as SessionIdParams;
    const coachId = req.profile.id;

    const sessionRows = await db
      .select({
        id: evaluationSessions.id,
        coachId: evaluationSessions.coachId,
        createdAt: evaluationSessions.createdAt,
      })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];
    if (!session || session.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const ageMs = Date.now() - session.createdAt.getTime();
    if (ageMs > UNDO_WINDOW_MS) {
      res.status(409).json({ error: "Undo window has passed." });
      return;
    }

    await db.transaction(async (tx) => {
      // fault tags cascade-delete when ratings are deleted
      await tx.delete(skillRatings).where(eq(skillRatings.sessionId, sessionId));
      await tx.delete(evaluationSessions).where(eq(evaluationSessions.id, sessionId));
    });

    req.log.info({ sessionId, coachId }, "session deleted");
    res.status(204).end();
  }),
);

// ── GET /sessions/:id ─────────────────────────────────────────────────────────
// Returns the current effective state of one session owned by the caller.
// Non-voided, non-superseded ratings only. Used to pre-fill the Evaluate
// page when the coach opens an edit from the swimmer page or progress page.
// ADR 032.

sessionsRouter.get(
  "/:id",
  validate({ params: SessionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: sessionId } = req.params as unknown as SessionIdParams;
    const coachId = req.profile.id;

    const sessionRows = await db
      .select({
        id: evaluationSessions.id,
        swimmerId: evaluationSessions.swimmerId,
        coachId: evaluationSessions.coachId,
        categoryId: evaluationSessions.categoryId,
        screenSlug: evaluationSessions.screenSlug,
        sessionDate: evaluationSessions.sessionDate,
        context: evaluationSessions.context,
        coachingPriority: evaluationSessions.coachingPriority,
        breathingPattern: evaluationSessions.breathingPattern,
        editedAt: evaluationSessions.editedAt,
      })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];
    if (!session || session.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Current effective ratings = non-voided + non-superseded. Each row also
    // carries its own id and whichever `supersedes_rating_id` it holds (null
    // for an original, set for a correction leaf). rootRatingId is the chain
    // root — equal to id when the rating has never been corrected.
    const ratingRows = await db
      .select({
        id: skillRatings.id,
        supersedesRatingId: skillRatings.supersedesRatingId,
        skillId: skillRatings.skillId,
        slug: skills.slug,
        grade: skillRatings.grade,
        notLegal: skillRatings.notLegal,
        noConcept: skillRatings.noConcept,
        side: skillRatings.side,
        capacityValue: skillRatings.capacityValue,
        capacityUnit: skillRatings.capacityUnit,
        measurementValue: skillRatings.measurementValue,
        measurementUnit: skillRatings.measurementUnit,
        golfScoreCategory: skillRatings.golfScoreCategory,
        note: skillRatings.note,
        ratedAt: skillRatings.ratedAt,
      })
      .from(skillRatings)
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .where(
        and(
          eq(skillRatings.sessionId, sessionId),
          isNull(skillRatings.voidedAt),
          isNull(skillRatings.supersededAt),
        ),
      );

    // Walk back through `supersedes_rating_id` to find each rating's root.
    // Chains are typically length 1 or 2 so a bounded-depth loop is fine.
    const ratingIds = ratingRows.map((row) => row.id);
    const rootByLeafId = new Map<string, string>();
    for (const row of ratingRows) {
      rootByLeafId.set(row.id, row.id);
    }
    const toResolve = ratingRows.filter((row) => row.supersedesRatingId !== null);
    for (const leaf of toResolve) {
      let cursor: string | null = leaf.supersedesRatingId;
      let safety = 0;
      while (cursor !== null && safety++ < 100) {
        const predecessorRows = await db
          .select({ id: skillRatings.id, supersedesRatingId: skillRatings.supersedesRatingId })
          .from(skillRatings)
          .where(eq(skillRatings.id, cursor))
          .limit(1);
        const predecessor = predecessorRows[0];
        if (!predecessor) break;
        if (predecessor.supersedesRatingId === null) {
          rootByLeafId.set(leaf.id, predecessor.id);
          break;
        }
        cursor = predecessor.supersedesRatingId;
      }
    }

    // Fetch fault tags for the live rating ids.
    const tagRows = ratingIds.length > 0
      ? await db
          .select({ ratingId: ratingFaultTags.ratingId, faultTag: ratingFaultTags.faultTag })
          .from(ratingFaultTags)
          .where(inArray(ratingFaultTags.ratingId, ratingIds))
      : [];
    const tagsByRatingId = new Map<string, string[]>();
    for (const tag of tagRows) {
      const existing = tagsByRatingId.get(tag.ratingId) ?? [];
      existing.push(tag.faultTag);
      tagsByRatingId.set(tag.ratingId, existing);
    }

    const ratings: GetSessionRating[] = ratingRows.map((row) => ({
      ratingId: row.id,
      rootRatingId: rootByLeafId.get(row.id) ?? row.id,
      skillId: row.skillId,
      slug: row.slug,
      grade: row.grade as 1 | 2 | 3 | 4 | 5 | null,
      notLegal: row.notLegal,
      noConcept: row.noConcept,
      side: row.side,
      capacityValue: row.capacityValue,
      capacityUnit: row.capacityUnit,
      measurementValue: row.measurementValue,
      measurementUnit: row.measurementUnit,
      golfScoreCategory: row.golfScoreCategory as GetSessionRating["golfScoreCategory"],
      note: row.note,
      faultTags: tagsByRatingId.get(row.id) ?? [],
      ratedAt: row.ratedAt.toISOString(),
      edited: row.supersedesRatingId !== null,
    }));

    const response: GetSessionResponse = {
      sessionId: session.id,
      screenSlug: session.screenSlug,
      swimmerId: session.swimmerId,
      categoryId: session.categoryId,
      sessionDate: session.sessionDate,
      context: session.context,
      coachingPriority: session.coachingPriority,
      breathingPattern: session.breathingPattern as GetSessionResponse["breathingPattern"],
      edited: session.editedAt !== null,
      editedAt: session.editedAt?.toISOString() ?? null,
      ratings,
    };

    res.json(response);
  }),
);

// ── GET /categories ──────────────────────────────────────────────────────────

export const coachCategoriesRouter = Router();

coachCategoriesRouter.get(
  "/categories",
  validate({}),
  asyncHandler(async (req, res) => {
    const categoryRows = await db
      .select({
        id: skillCategories.id,
        slug: skillCategories.slug,
        name: skillCategories.name,
        sortOrder: skillCategories.sortOrder,
      })
      .from(skillCategories)
      .orderBy(skillCategories.sortOrder);

    const skillRows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        name: skills.name,
        type: skills.type,
        unit: skills.unit,
        stroke: skills.stroke,
        ratedPerSide: skills.ratedPerSide,
        notLegalAllowed: skills.notLegalAllowed,
        parentSkillId: skills.parentSkillId,
        sortOrder: skills.sortOrder,
        faultTags: skills.faultTags,
        categoryId: skills.categoryId,
      })
      .from(skills)
      .where(isNull(skills.archivedAt))
      .orderBy(skills.sortOrder);

    const skillIds = skillRows.map((skill) => skill.id);

    const descriptorRows = skillIds.length > 0
      ? await db
          .select({
            skillId: skillLevelDescriptors.skillId,
            level: skillLevelDescriptors.level,
            text: skillLevelDescriptors.text,
          })
          .from(skillLevelDescriptors)
          .where(inArray(skillLevelDescriptors.skillId, skillIds))
          .orderBy(asc(skillLevelDescriptors.level))
      : [];

    const descriptorsBySkill = new Map<string, Array<{ level: number; text: string }>>();
    for (const descriptor of descriptorRows) {
      const list = descriptorsBySkill.get(descriptor.skillId) ?? [];
      list.push({ level: descriptor.level, text: descriptor.text });
      descriptorsBySkill.set(descriptor.skillId, list);
    }

    const skillsByCategory = new Map<string, typeof skillRows>();
    for (const skill of skillRows) {
      const list = skillsByCategory.get(skill.categoryId) ?? [];
      list.push(skill);
      skillsByCategory.set(skill.categoryId, list);
    }

    const result = categoryRows.map((cat) => ({
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      sortOrder: cat.sortOrder,
      skills: (skillsByCategory.get(cat.id) ?? []).map((skill) => ({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        type: skill.type,
        unit: skill.unit ?? null,
        stroke: skill.stroke ?? null,
        ratedPerSide: skill.ratedPerSide,
        notLegalAllowed: skill.notLegalAllowed,
        parentSkillId: skill.parentSkillId ?? null,
        sortOrder: skill.sortOrder,
        faultTags: skill.faultTags ?? [],
        descriptors: descriptorsBySkill.get(skill.id) ?? [],
      })),
    }));

    req.log.info({ count: categoryRows.length }, "skill categories fetched");
    res.json(result);
  }),
);

// ── GET /screens ─────────────────────────────────────────────────────────────

export const coachScreensRouter = Router();

coachScreensRouter.get(
  "/screens",
  validate({}),
  asyncHandler(async (req, res) => {
    const skillRows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        name: skills.name,
        type: skills.type,
        unit: skills.unit,
        stroke: skills.stroke,
        ratedPerSide: skills.ratedPerSide,
        notLegalAllowed: skills.notLegalAllowed,
        parentSkillId: skills.parentSkillId,
        sortOrder: skills.sortOrder,
        faultTags: skills.faultTags,
        categoryId: skills.categoryId,
      })
      .from(skills)
      .where(isNull(skills.archivedAt))
      .orderBy(skills.sortOrder);

    const skillIds = skillRows.map((skill) => skill.id);

    const descriptorRows = skillIds.length > 0
      ? await db
          .select({
            skillId: skillLevelDescriptors.skillId,
            level: skillLevelDescriptors.level,
            text: skillLevelDescriptors.text,
          })
          .from(skillLevelDescriptors)
          .where(inArray(skillLevelDescriptors.skillId, skillIds))
          .orderBy(asc(skillLevelDescriptors.level))
      : [];

    const descriptorsBySkill = new Map<string, Array<{ level: number; text: string }>>();
    for (const descriptor of descriptorRows) {
      const list = descriptorsBySkill.get(descriptor.skillId) ?? [];
      list.push({ level: descriptor.level, text: descriptor.text });
      descriptorsBySkill.set(descriptor.skillId, list);
    }

    // Index skills by slug for fast lookup
    const skillBySlug = new Map(skillRows.map((skill) => [skill.slug, skill]));

    const result = SCREEN_SLUGS.map((screenSlug) => {
      const slugList = SCREEN_SKILLS[screenSlug] ?? [];
      const screenSkills = slugList
        .map((slug) => skillBySlug.get(slug))
        .filter((skill): skill is NonNullable<typeof skill> => skill !== undefined)
        .map((skill) => ({
          id: skill.id,
          slug: skill.slug,
          name: skill.name,
          type: skill.type,
          unit: skill.unit ?? null,
          stroke: skill.stroke ?? null,
          ratedPerSide: skill.ratedPerSide,
          notLegalAllowed: skill.notLegalAllowed,
          parentSkillId: skill.parentSkillId ?? null,
          sortOrder: skill.sortOrder,
          faultTags: skill.faultTags ?? [],
          descriptors: descriptorsBySkill.get(skill.id) ?? [],
        }));

      return {
        screenSlug,
        name: SCREEN_NAMES[screenSlug] ?? screenSlug,
        skills: screenSkills,
      };
    });

    req.log.info({ count: result.length }, "screens fetched");
    res.json(result);
  }),
);

// ── DELETE /ratings/:id ───────────────────────────────────────────────────────
// Registered separately in app.ts under /ratings

export const ratingsRouter = Router();

ratingsRouter.delete(
  "/:id",
  validate({ params: RatingIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: ratingId } = req.params as unknown as RatingIdParams;
    const coachId = req.profile.id;

    const ratingRows = await db
      .select({
        id: skillRatings.id,
        coachId: skillRatings.coachId,
        voidedAt: skillRatings.voidedAt,
        createdAt: skillRatings.createdAt,
      })
      .from(skillRatings)
      .where(eq(skillRatings.id, ratingId))
      .limit(1);

    const rating = ratingRows[0];

    // Return 404 when not found or not owned by this coach (no leaking)
    if (!rating || rating.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (rating.voidedAt !== null) {
      res.status(409).json({ error: "Cannot undo a voided rating." });
      return;
    }

    const ageMs = Date.now() - rating.createdAt.getTime();
    if (ageMs > UNDO_WINDOW_MS) {
      res.status(409).json({ error: "Undo window has passed. Use void to remove this rating." });
      return;
    }

    await db.delete(skillRatings).where(eq(skillRatings.id, ratingId));

    req.log.info({ ratingId, coachId }, "rating deleted");

    res.status(204).end();
  }),
);

// ── PATCH /ratings/:id/void ───────────────────────────────────────────────────

ratingsRouter.patch(
  "/:id/void",
  validate({ params: RatingIdParamsSchema, body: VoidRatingBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: ratingId } = req.params as unknown as RatingIdParams;
    const body = req.body as VoidRatingBody;
    const coachId = req.profile.id;

    const ratingRows = await db
      .select({
        id: skillRatings.id,
        coachId: skillRatings.coachId,
        voidedAt: skillRatings.voidedAt,
      })
      .from(skillRatings)
      .where(eq(skillRatings.id, ratingId))
      .limit(1);

    const rating = ratingRows[0];

    // Return 404 when not found or not owned by this coach (no leaking)
    if (!rating || rating.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (rating.voidedAt !== null) {
      res.status(409).json({ error: "Rating is already voided." });
      return;
    }

    const now = new Date();

    const updatedRows = await db
      .update(skillRatings)
      .set({
        voidedAt: now,
        voidReason: body.reason,
        voidBy: coachId,
      })
      .where(eq(skillRatings.id, ratingId))
      .returning({
        id: skillRatings.id,
        sessionId: skillRatings.sessionId,
        swimmerId: skillRatings.swimmerId,
        skillId: skillRatings.skillId,
        coachId: skillRatings.coachId,
        grade: skillRatings.grade,
        notLegal: skillRatings.notLegal,
        noConcept: skillRatings.noConcept,
        side: skillRatings.side,
        capacityValue: skillRatings.capacityValue,
        capacityUnit: skillRatings.capacityUnit,
        measurementValue: skillRatings.measurementValue,
        measurementUnit: skillRatings.measurementUnit,
        note: skillRatings.note,
        voidedAt: skillRatings.voidedAt,
        voidReason: skillRatings.voidReason,
        voidBy: skillRatings.voidBy,
        ratedAt: skillRatings.ratedAt,
        createdAt: skillRatings.createdAt,
        updatedAt: skillRatings.updatedAt,
      });

    const updated = updatedRows[0]!;

    req.log.info({ ratingId, coachId }, "rating voided");

    // coach-only route — switch to ParentSkillRatingSchema before adding any parent access
    res.json(CoachSkillRatingSchema.parse({
      ...updated,
      voidedAt: updated.voidedAt?.toISOString() ?? null,
      ratedAt: updated.ratedAt.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }));
  }),
);
