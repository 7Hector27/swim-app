import { Router } from "express";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  evaluationSessions,
  householdAuditLog,
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
  type GetEvaluationsItem,
  type GetEvaluationsResponse,
  type GetEvaluationsQuery,
  CreateSessionBodySchema,
  VoidRatingBodySchema,
  DependencyMapQuerySchema,
  CoachSkillRatingSchema,
  GolfScoreCategorySchema,
  PatchSessionBodySchema,
  GetEvaluationsQuerySchema,
  ScoreHistoryResponseSchema,
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
  validateRatingAgainstSkill,
  type RatingSkillDef,
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

    // Per-rating cross-field validation. The seven cross-field rules that
    // the PATCH flow also runs are factored into validateRatingAgainstSkill
    // in packages/shared so both routes reject the same inputs by
    // construction. The create-only checks (skill lookup, screen-skill
    // membership) stay here because they depend on request-local state the
    // shared validator doesn't see.
    for (const [index, ratingInput] of body.ratings.entries()) {
      const skill = skillMap.get(ratingInput.skillId);

      if (!skill) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].skillId`], message: "Skill not found or archived" }],
        });
        return;
      }

      const skillDef: RatingSkillDef = {
        type: skill.type,
        ratedPerSide: skill.ratedPerSide,
        notLegalAllowed: skill.notLegalAllowed,
        unit: skill.unit,
        allowedFaultTags: skill.faultTags ?? [],
      };
      const issue = validateRatingAgainstSkill(skillDef, ratingInput, "skillId");
      if (issue) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: ["ratings", index, issue.field], message: issue.message }],
        });
        return;
      }

      // Create-only: skill must be in the screen's skill list (by slug).
      if (!screenSkillSlugs.has(skill.slug)) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].skillId`], message: "Skill does not belong to the session screen" }],
        });
        return;
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

    const raw = await computeScoreHistory(swimmerId, { includeFaultTrends: true });
    // Parse the computation output through the shared schema before emitting
    // so the server contract is enforced symmetrically with the parent route
    // (which uses ParentScoreHistoryResponseSchema). A field drift between
    // the lib and the schema trips here instead of reaching the client.
    const body = ScoreHistoryResponseSchema.parse(raw);
    req.log.info({ swimmerId, pointCount: body.points.length }, "swimmer score history fetched");
    res.json(body);
  }),
);

// ── GET /swimmers/:id/evaluations ─────────────────────────────────────────────
// Paginated list of a swimmer's past evaluations, newest first. Powers the
// Evaluations section on /coach/swimmers/[id] and the full-list page at
// /coach/swimmers/[id]/evaluations. ADR 032.

const EVALUATIONS_CURSOR_SEP = ":::";

function encodeEvaluationsCursor(sessionDate: string, sessionId: string): string {
  return Buffer.from(`${sessionDate}${EVALUATIONS_CURSOR_SEP}${sessionId}`, "utf8").toString("base64url");
}

function decodeEvaluationsCursor(cursor: string): { sessionDate: string; sessionId: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = decoded.indexOf(EVALUATIONS_CURSOR_SEP);
    if (sep < 0) return null;
    const sessionDate = decoded.slice(0, sep);
    const sessionId = decoded.slice(sep + EVALUATIONS_CURSOR_SEP.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null;
    if (!/^[0-9a-fA-F-]{36}$/.test(sessionId)) return null;
    return { sessionDate, sessionId };
  } catch {
    return null;
  }
}

evaluationsRouter.get(
  "/:id/evaluations",
  validate({ params: SwimmerIdParamsSchema, query: GetEvaluationsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;
    const query = req.query as unknown as GetEvaluationsQuery;

    const swimmer = await findActiveSwimmer(swimmerId);
    if (!swimmer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const cursor = query.cursor ? decodeEvaluationsCursor(query.cursor) : null;
    const limit = query.limit;

    // Fetch one more than the limit so we can tell whether there's a next
    // page without a second COUNT query. Pagination is keyed on
    // (sessionDate DESC, sessionId DESC) so same-date corrections tie-break.
    const sessionRows = await db
      .select({
        id: evaluationSessions.id,
        screenSlug: evaluationSessions.screenSlug,
        sessionDate: evaluationSessions.sessionDate,
        context: evaluationSessions.context,
        coachingPriority: evaluationSessions.coachingPriority,
        editedAt: evaluationSessions.editedAt,
        createdAt: evaluationSessions.createdAt,
      })
      .from(evaluationSessions)
      .where(
        cursor
          ? and(
              eq(evaluationSessions.swimmerId, swimmerId),
              sql`(${evaluationSessions.sessionDate}, ${evaluationSessions.id}) < (${cursor.sessionDate}::date, ${cursor.sessionId}::uuid)`,
            )
          : eq(evaluationSessions.swimmerId, swimmerId),
      )
      .orderBy(desc(evaluationSessions.sessionDate), desc(evaluationSessions.id))
      .limit(limit + 1);

    const hasMore = sessionRows.length > limit;
    const pageRows = hasMore ? sessionRows.slice(0, limit) : sessionRows;

    // Rating counts per session (non-voided, non-superseded) in one grouped
    // query. Zero-count sessions still appear in the list — they can exist
    // if every rating was voided, and the coach can decide whether to delete
    // or re-rate.
    const countRows = pageRows.length > 0
      ? await db
          .select({
            sessionId: skillRatings.sessionId,
            count: sql<number>`count(*)::int`.as("count"),
          })
          .from(skillRatings)
          .where(
            and(
              inArray(skillRatings.sessionId, pageRows.map((row) => row.id)),
              isNull(skillRatings.voidedAt),
              isNull(skillRatings.supersededAt),
            ),
          )
          .groupBy(skillRatings.sessionId)
      : [];
    const countBySessionId = new Map(countRows.map((row) => [row.sessionId, row.count]));

    const evaluations: GetEvaluationsItem[] = pageRows.map((row) => ({
      sessionId: row.id,
      screenSlug: row.screenSlug,
      screenName: SCREEN_NAMES[row.screenSlug] ?? row.screenSlug,
      sessionDate: row.sessionDate,
      context: row.context,
      coachingPriority: row.coachingPriority,
      ratingCount: countBySessionId.get(row.id) ?? 0,
      edited: row.editedAt !== null,
      editedAt: row.editedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? encodeEvaluationsCursor(lastRow.sessionDate, lastRow.id) : null;

    const response: GetEvaluationsResponse = { evaluations, nextCursor };
    req.log.info({ swimmerId, count: evaluations.length, hasMore }, "swimmer evaluations list fetched");
    res.json(response);
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
        sessionId: skillRatings.sessionId,
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
            sessionId: point.sessionId,
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

    // Once a session has corrections, the hard-delete path would wipe the
    // audit chain and leave orphan references via supersedes_rating_id FKs.
    // Reject with 409 so the coach uses void-and-re-rate instead. ADR 032.
    const correctionProbe = await db
      .select({ id: skillRatings.id })
      .from(skillRatings)
      .where(
        and(
          eq(skillRatings.sessionId, sessionId),
          sql`(${skillRatings.supersededAt} IS NOT NULL OR ${skillRatings.supersedesRatingId} IS NOT NULL)`,
        ),
      )
      .limit(1);
    if (correctionProbe[0]) {
      res.status(409).json({ error: "Session has corrections; delete is not allowed." });
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

    // Resolve each live rating to its chain root by walking back through
    // `supersedes_rating_id`. Chains are typically length 1 or 2; the loop
    // issues one batched `inArray` query per depth level rather than one
    // query per hop per rating, so the whole walk is 1-2 queries regardless
    // of how many ratings were corrected. The 100-iteration cap is a
    // defence-in-depth against a malformed chain cycle.
    const ratingIds = ratingRows.map((row) => row.id);
    const rootByLeafId = new Map<string, string>();
    for (const row of ratingRows) {
      rootByLeafId.set(row.id, row.id);
    }
    // Pending[leafId] = the predecessor id we still need to walk from.
    const pending = new Map<string, string>();
    for (const row of ratingRows) {
      if (row.supersedesRatingId !== null) {
        pending.set(row.id, row.supersedesRatingId);
      }
    }
    let safety = 0;
    while (pending.size > 0 && safety++ < 100) {
      const cursorIds = Array.from(new Set(pending.values()));
      const predecessorRows = await db
        .select({ id: skillRatings.id, supersedesRatingId: skillRatings.supersedesRatingId })
        .from(skillRatings)
        .where(inArray(skillRatings.id, cursorIds));
      const predecessorById = new Map<string, string | null>();
      for (const row of predecessorRows) {
        predecessorById.set(row.id, row.supersedesRatingId);
      }
      for (const [leafId, cursor] of pending) {
        if (!predecessorById.has(cursor)) {
          // Predecessor missing (shouldn't happen given the FK, but keep the
          // leaf as its own root rather than erroring the whole response).
          pending.delete(leafId);
          continue;
        }
        const next = predecessorById.get(cursor) ?? null;
        if (next === null) {
          rootByLeafId.set(leafId, cursor);
          pending.delete(leafId);
        } else {
          pending.set(leafId, next);
        }
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

// ── PATCH /sessions/:id ───────────────────────────────────────────────────────
// Edits a past evaluation (ADR 032). Session metadata changes happen in place
// as a single UPDATE; rating changes write new rows that supersede their
// predecessors. One audit log row records the per-field previous and new
// values for session metadata plus the ids of corrected ratings. Everything
// is inside one db.transaction() per CLAUDE.md's audit-log rule.

type SessionMetadataFieldDiff = {
  field: "sessionDate" | "context" | "coachingPriority" | "breathingPattern";
  previous: string | null;
  new: string | null;
};

type RatingFieldKey =
  | "grade"
  | "notLegal"
  | "noConcept"
  | "side"
  | "capacityValue"
  | "capacityUnit"
  | "measurementValue"
  | "measurementUnit"
  | "golfScoreCategory"
  | "note"
  | "faultTags";

function arraysEqualUnordered(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  for (let index = 0; index < sortedLeft.length; index++) {
    if (sortedLeft[index] !== sortedRight[index]) return false;
  }
  return true;
}

sessionsRouter.patch(
  "/:id",
  validate({ params: SessionIdParamsSchema, body: PatchSessionBodySchema }),
  asyncHandler(async (req, res) => {
    const { id: sessionId } = req.params as unknown as SessionIdParams;
    const body = req.body as PatchSessionBody;
    const coachId = req.profile.id;

    // Load the session row. Verify owner.
    const sessionRows = await db
      .select({
        id: evaluationSessions.id,
        swimmerId: evaluationSessions.swimmerId,
        coachId: evaluationSessions.coachId,
        screenSlug: evaluationSessions.screenSlug,
        sessionDate: evaluationSessions.sessionDate,
        context: evaluationSessions.context,
        coachingPriority: evaluationSessions.coachingPriority,
        breathingPattern: evaluationSessions.breathingPattern,
        editedAt: evaluationSessions.editedAt,
        householdId: swimmers.householdId,
      })
      .from(evaluationSessions)
      .innerJoin(swimmers, eq(swimmers.id, evaluationSessions.swimmerId))
      .where(eq(evaluationSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];
    if (!session || session.coachId !== coachId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Load every live rating in this session plus its skill shape, keyed by
    // id so the diff step is a direct lookup.
    const liveRatingRows = await db
      .select({
        id: skillRatings.id,
        skillId: skillRatings.skillId,
        slug: skills.slug,
        type: skills.type,
        unit: skills.unit,
        ratedPerSide: skills.ratedPerSide,
        notLegalAllowed: skills.notLegalAllowed,
        allowedFaultTags: skills.faultTags,
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
        voidedAt: skillRatings.voidedAt,
        supersededAt: skillRatings.supersededAt,
        ratedAt: skillRatings.ratedAt,
      })
      .from(skillRatings)
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .where(eq(skillRatings.sessionId, sessionId));

    const liveById = new Map(liveRatingRows.map((row) => [row.id, row]));

    const tagRows = liveRatingRows.length > 0
      ? await db
          .select({ ratingId: ratingFaultTags.ratingId, faultTag: ratingFaultTags.faultTag })
          .from(ratingFaultTags)
          .where(inArray(ratingFaultTags.ratingId, liveRatingRows.map((row) => row.id)))
      : [];
    const tagsByRatingId = new Map<string, string[]>();
    for (const tag of tagRows) {
      const existing = tagsByRatingId.get(tag.ratingId) ?? [];
      existing.push(tag.faultTag);
      tagsByRatingId.set(tag.ratingId, existing);
    }

    // Walk the body: resolve each submitted ratingId, bail on 404 / 409.
    type RatingDiff = {
      live: typeof liveRatingRows[number];
      body: typeof body.ratings[number];
      changedFields: RatingFieldKey[];
    };
    const ratingDiffs: RatingDiff[] = [];

    for (const [index, ratingBody] of body.ratings.entries()) {
      const live = liveById.get(ratingBody.ratingId);
      if (!live) {
        // Rating doesn't belong to this session — treat as not found. Covers
        // both "ratingId forged" and "voided between GET and PATCH" (voided
        // rows are read here but we 404 against the body's 'live effective
        // rating' assumption below).
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (live.voidedAt !== null) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (live.supersededAt !== null) {
        res.status(409).json({
          error: "Stale rating; refetch and resubmit",
          ratingId: ratingBody.ratingId,
        });
        return;
      }

      // Per-rating validation — shared with the create flow via
      // validateRatingAgainstSkill. The predicate set and error messages
      // match the CREATE route by construction.
      const skillDef: RatingSkillDef = {
        type: live.type,
        ratedPerSide: live.ratedPerSide,
        notLegalAllowed: live.notLegalAllowed,
        unit: live.unit,
        allowedFaultTags: live.allowedFaultTags ?? [],
      };
      const issue = validateRatingAgainstSkill(skillDef, ratingBody, "ratingId");
      if (issue) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: ["ratings", index, issue.field], message: issue.message }],
        });
        return;
      }

      // Diff per field. `faultTags` compares as an unordered multiset.
      const changedFields: RatingFieldKey[] = [];
      if ((live.grade ?? null) !== ratingBody.grade) changedFields.push("grade");
      if (live.notLegal !== ratingBody.notLegal) changedFields.push("notLegal");
      if (live.noConcept !== ratingBody.noConcept) changedFields.push("noConcept");
      if ((live.side ?? null) !== ratingBody.side) changedFields.push("side");
      if ((live.capacityValue ?? null) !== ratingBody.capacityValue) changedFields.push("capacityValue");
      if ((live.capacityUnit ?? null) !== ratingBody.capacityUnit) changedFields.push("capacityUnit");
      if ((live.measurementValue ?? null) !== ratingBody.measurementValue) changedFields.push("measurementValue");
      if ((live.measurementUnit ?? null) !== ratingBody.measurementUnit) changedFields.push("measurementUnit");
      if ((live.golfScoreCategory ?? null) !== ratingBody.golfScoreCategory) changedFields.push("golfScoreCategory");
      if ((live.note ?? null) !== ratingBody.note) changedFields.push("note");
      if (!arraysEqualUnordered(tagsByRatingId.get(live.id) ?? [], ratingBody.faultTags)) {
        changedFields.push("faultTags");
      }

      if (changedFields.length > 0) {
        ratingDiffs.push({ live, body: ratingBody, changedFields });
      }
    }

    // Normalize empty / whitespace-only coaching priority to null (same rule
    // as the create flow).
    const normalizedPriority = body.coachingPriority === null
      ? null
      : body.coachingPriority.trim().length === 0
        ? null
        : body.coachingPriority;

    // Session metadata diff.
    const sessionFieldsChanged: SessionMetadataFieldDiff[] = [];
    if (session.sessionDate !== body.sessionDate) {
      sessionFieldsChanged.push({ field: "sessionDate", previous: session.sessionDate, new: body.sessionDate });
    }
    if (session.context !== body.context) {
      sessionFieldsChanged.push({ field: "context", previous: session.context, new: body.context });
    }
    if ((session.coachingPriority ?? null) !== (normalizedPriority ?? null)) {
      sessionFieldsChanged.push({
        field: "coachingPriority",
        previous: session.coachingPriority ?? null,
        new: normalizedPriority ?? null,
      });
    }
    if ((session.breathingPattern ?? null) !== (body.breathingPattern ?? null)) {
      sessionFieldsChanged.push({
        field: "breathingPattern",
        previous: session.breathingPattern ?? null,
        new: body.breathingPattern ?? null,
      });
    }

    // Session-level invariants retained from the create flow. The same checks
    // that reject a create apply to an edit.
    if (body.sessionDate !== session.sessionDate || body.context !== session.context) {
      // Water confidence / race was a create-time rule; preserve it on edit.
      if (session.screenSlug === "water-confidence" && body.context === "race") {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: ["context"], message: "Water confidence sessions do not support race context" }],
        });
        return;
      }
    }
    if (session.screenSlug === "freestyle" || session.screenSlug === "butterfly") {
      if (body.breathingPattern === null) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: ["breathingPattern"], message: "breathingPattern is required for freestyle and butterfly screens" }],
        });
        return;
      }
    } else if (body.breathingPattern !== null) {
      res.status(422).json({
        error: "Validation error",
        issues: [{ path: ["breathingPattern"], message: "breathingPattern must be null for this screen" }],
      });
      return;
    }

    // No-op PATCH: write nothing, no audit row, 200 { writeCount: 0 }.
    if (ratingDiffs.length === 0 && sessionFieldsChanged.length === 0) {
      const response: PatchSessionResponse = { sessionId, writeCount: 0 };
      res.status(200).json(response);
      return;
    }

    const result = await db.transaction(async (tx) => {
      let writeCount = 0;

      if (sessionFieldsChanged.length > 0) {
        await tx
          .update(evaluationSessions)
          .set({
            sessionDate: body.sessionDate,
            context: body.context,
            coachingPriority: normalizedPriority,
            breathingPattern: body.breathingPattern,
            editedAt: new Date(),
          })
          .where(eq(evaluationSessions.id, sessionId));
        writeCount += 1;
      }

      const ratingsChangedPayload: Array<{
        ratingId: string;
        newRatingId: string;
        fieldsChanged: RatingFieldKey[];
      }> = [];

      for (const diff of ratingDiffs) {
        const insertRows = await tx
          .insert(skillRatings)
          .values({
            sessionId,
            swimmerId: session.swimmerId,
            skillId: diff.live.skillId,
            coachId,
            grade: diff.body.grade,
            notLegal: diff.body.notLegal,
            noConcept: diff.body.noConcept,
            side: diff.body.side,
            capacityValue: diff.body.capacityValue,
            capacityUnit: diff.body.capacityUnit,
            measurementValue: diff.body.measurementValue,
            measurementUnit: diff.body.measurementUnit,
            golfScoreCategory: diff.body.golfScoreCategory,
            note: diff.body.note,
            // Observation time is preserved (ADR 032).
            ratedAt: diff.live.ratedAt,
            supersedesRatingId: diff.live.id,
          })
          .returning({ id: skillRatings.id });
        const newRatingId = insertRows[0]!.id;

        // Full new fault-tag list on the correction row. The old rating's
        // tags stay in place because the old row stays in the table.
        if (diff.body.faultTags.length > 0) {
          await tx.insert(ratingFaultTags).values(
            diff.body.faultTags.map((tag) => ({ ratingId: newRatingId, faultTag: tag })),
          );
        }

        await tx
          .update(skillRatings)
          .set({
            supersededAt: new Date(),
            supersededBy: coachId,
            supersededByRatingId: newRatingId,
          })
          .where(eq(skillRatings.id, diff.live.id));

        writeCount += 1;
        ratingsChangedPayload.push({
          ratingId: diff.live.id,
          newRatingId,
          fieldsChanged: diff.changedFields,
        });
      }

      // If only ratings changed, also bump the session's edited_at so the
      // "Edited" badge reflects any correction.
      if (sessionFieldsChanged.length === 0 && ratingDiffs.length > 0) {
        await tx
          .update(evaluationSessions)
          .set({ editedAt: new Date() })
          .where(eq(evaluationSessions.id, sessionId));
      }

      // One audit row per PATCH, inside the same transaction.
      await tx.insert(householdAuditLog).values({
        householdId: session.householdId,
        actorId: coachId,
        action: "evaluation_edited",
        targetSwimmerId: session.swimmerId,
        payload: {
          sessionId,
          sessionFieldsChanged,
          ratingsChanged: ratingsChangedPayload,
        },
      });

      return { writeCount };
    });

    req.log.info(
      { sessionId, coachId, writeCount: result.writeCount, ratingDiffs: ratingDiffs.length, sessionDiffs: sessionFieldsChanged.length },
      "session edited",
    );
    const response: PatchSessionResponse = { sessionId, writeCount: result.writeCount };
    res.status(200).json(response);
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
