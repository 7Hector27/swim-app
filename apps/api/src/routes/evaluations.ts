import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  evaluationSessions,
  ratingFaultTags,
  skillCategories,
  skillDependencies,
  skillRatings,
  skills,
  swimmers,
} from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { isActiveSwimmer } from "../db/queries";
import {
  type CreateSessionBody,
  type CreateSessionResponse,
  type VoidRatingBody,
  type DependencyMapQuery,
  CreateSessionBodySchema,
  VoidRatingBodySchema,
  DependencyMapQuerySchema,
  CoachSkillRatingSchema,
  findDeepestLowFoundation,
  headPositionOverall,
  latestEffectiveRatings,
  calculateStartGrade,
  weakerSideGrade,
  type RatingRecord,
  type GradeMap,
  type BuiltOnGraph,
  type SortOrderMap,
  type PerStrokeGrades,
  type ChainEntry,
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
  requireUser,
  requireCoach,
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

    // Verify category exists
    const categoryRows = await db
      .select({ id: skillCategories.id })
      .from(skillCategories)
      .where(eq(skillCategories.id, body.categoryId))
      .limit(1);
    if (!categoryRows[0]) {
      res.status(422).json({ error: "Validation error", issues: [{ message: "categoryId not found" }] });
      return;
    }

    // Load the full non-archived skill catalog for validation.
    const allSkillRows = await db
      .select({
        id: skills.id,
        slug: skills.slug,
        categoryId: skills.categoryId,
        parentSkillId: skills.parentSkillId,
        type: skills.type,
        unit: skills.unit,
        faultTags: skills.faultTags,
        ratedPerSide: skills.ratedPerSide,
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

      // Skill must belong to the session category directly, or via parent_skill_id
      const categoryMatch =
        skill.categoryId === body.categoryId ||
        (skill.parentSkillId !== null &&
          (skillMap.get(skill.parentSkillId)?.categoryId === body.categoryId));

      if (!categoryMatch) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].skillId`], message: "Skill does not belong to the session category" }],
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

      // measurement unit must match skill.unit when present
      if (
        ratingInput.measurementUnit !== null &&
        skill.unit !== null &&
        ratingInput.measurementUnit !== skill.unit
      ) {
        res.status(422).json({
          error: "Validation error",
          issues: [{ path: [`ratings[${index}].measurementUnit`], message: `Measurement unit must be ${skill.unit}` }],
        });
        return;
      }
    }

    // All validations passed — insert session + ratings in one transaction
    const result = await db.transaction(async (tx) => {
      const sessionRows = await tx
        .insert(evaluationSessions)
        .values({
          swimmerId,
          coachId,
          categoryId: body.categoryId,
          sessionDate: body.sessionDate,
          context: body.context,
          coachingPriority: body.coachingPriority,
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
  requireUser,
  requireCoach,
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
  requireUser,
  requireCoach,
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
  requireUser,
  requireCoach,
  validate({ params: SwimmerIdParamsSchema, query: DependencyMapQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as SwimmerIdParams;
    const { categoryId } = req.query as unknown as DependencyMapQuery;

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
        skillCategoryId: skills.categoryId,
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
    }));

    const grades: GradeMap = latestEffectiveRatings(ratingRecords);

    // Restrict to skills in the requested category
    const categorySkillSlugs = new Set(
      ratingRows
        .filter((row) => row.skillCategoryId === categoryId)
        .map((row) => row.slug),
    );

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

    // Find deepest low foundation across category skills
    let bestChain: ChainEntry[] | null = null;
    let bestDepth = -1;

    for (const slug of categorySkillSlugs) {
      if (!(slug in grades)) continue;
      const chain = findDeepestLowFoundation(slug, grades, graph, fullSortOrder);
      if (chain !== null && chain.length > bestDepth) {
        bestDepth = chain.length;
        bestChain = chain;
      }
    }

    req.log.info({ swimmerId, categoryId }, "dependency map suggestion computed");

    res.json({ suggestion: bestChain });
  }),
);

// ── DELETE /sessions/:id ──────────────────────────────────────────────────────

export const sessionsRouter = Router();

const SessionIdParamsSchema = z.object({ id: z.string().uuid() });
type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;

sessionsRouter.delete(
  "/:id",
  requireUser,
  requireCoach,
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

// ── GET /categories ──────────────────────────────────────────────────────────

export const coachCategoriesRouter = Router();

coachCategoriesRouter.get(
  "/categories",
  requireUser,
  requireCoach,
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
        ratedPerSide: skills.ratedPerSide,
        parentSkillId: skills.parentSkillId,
        sortOrder: skills.sortOrder,
        faultTags: skills.faultTags,
        categoryId: skills.categoryId,
      })
      .from(skills)
      .where(isNull(skills.archivedAt))
      .orderBy(skills.sortOrder);

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
        ratedPerSide: skill.ratedPerSide,
        parentSkillId: skill.parentSkillId ?? null,
        sortOrder: skill.sortOrder,
        faultTags: skill.faultTags ?? [],
      })),
    }));

    req.log.info({ count: categoryRows.length }, "skill categories fetched");
    res.json(result);
  }),
);

// ── DELETE /ratings/:id ───────────────────────────────────────────────────────
// Registered separately in app.ts under /ratings

export const ratingsRouter = Router();

ratingsRouter.delete(
  "/:id",
  requireUser,
  requireCoach,
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
  requireUser,
  requireCoach,
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
