import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  evaluationSessions,
  meetSwims,
  meets,
  skillLevelDescriptors,
  skillRatings,
} from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdSwimmer } from "../middleware/requireHouseholdSwimmer";
import { computeSwimmerProgress } from "../lib/progressCalculation";
import { computeScoreHistory } from "../lib/scoreHistory";
import {
  formatSwimTime,
  IdParamsSchema,
  ParentPersonalBestsResponseSchema,
  ParentScoreHistoryResponseSchema,
  ParentSwimmerProgressResponseSchema,
  SCREEN_NAMES,
  type IdParams,
  type LatestCoachingPriority,
  type ParentCoachingNote,
  type ParentPersonalBest,
  type ParentPersonalBestsResponse,
  type ParentSwimmerProgressResponse,
} from "@swim-app/shared";

export const parentProgressRouter = Router();

// GET /swimmers/:id/progress — parent-facing progress (no fault tags, no coach fields)
parentProgressRouter.get(
  "/:id/progress",
  requireUser,
  requireParent,
  validate({ params: IdParamsSchema }),
  requireHouseholdMember,
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const full = await computeSwimmerProgress(swimmerId, { audience: "parent" });

    const displayedSkillIds = full.skills.map((skill) => skill.skillId);

    // Fetch level descriptors, coaching-note sessions, and the single-latest
    // non-empty / non-voided priority in parallel.
    //
    // The "non-voided evaluation" rule: a session counts only when it has at
    // least one skill_ratings row with voidedAt IS NULL. A session whose every
    // rating has been voided is treated as a voided evaluation and skipped.
    const [descriptorRows, sessionRows, latestPriorityRows] = await Promise.all([
      displayedSkillIds.length > 0
        ? db
            .select({ skillId: skillLevelDescriptors.skillId, level: skillLevelDescriptors.level, text: skillLevelDescriptors.text })
            .from(skillLevelDescriptors)
            .where(inArray(skillLevelDescriptors.skillId, displayedSkillIds))
        : Promise.resolve([]),
      db
        .select({
          screenSlug: evaluationSessions.screenSlug,
          sessionDate: evaluationSessions.sessionDate,
          coachingPriority: evaluationSessions.coachingPriority,
        })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.swimmerId, swimmerId))
        .orderBy(desc(evaluationSessions.sessionDate), desc(evaluationSessions.createdAt)),
      db
        .select({
          sessionDate: evaluationSessions.sessionDate,
          coachingPriority: evaluationSessions.coachingPriority,
        })
        .from(evaluationSessions)
        .where(
          and(
            eq(evaluationSessions.swimmerId, swimmerId),
            isNotNull(evaluationSessions.coachingPriority),
            // Correlated EXISTS: skip sessions whose every rating is voided or
            // superseded. A session where every rating has been corrected is
            // still a non-empty session as long as at least one correction
            // row (supersedes_rating_id set, superseded_at null) exists —
            // that row satisfies this EXISTS.
            sql`EXISTS (
              SELECT 1 FROM ${skillRatings}
              WHERE ${skillRatings.sessionId} = ${evaluationSessions.id}
                AND ${skillRatings.voidedAt} IS NULL
                AND ${skillRatings.supersededAt} IS NULL
            )`,
          ),
        )
        .orderBy(desc(evaluationSessions.sessionDate), desc(evaluationSessions.createdAt))
        .limit(1),
    ]);

    const latestPriorityRow = latestPriorityRows[0];
    const latestCoachingPriority: LatestCoachingPriority | null =
      latestPriorityRow && latestPriorityRow.coachingPriority !== null
        ? {
            text: latestPriorityRow.coachingPriority,
            sessionDate: latestPriorityRow.sessionDate,
          }
        : null;

    // Build per-skill descriptor map: skillId -> { "1": text, "2": text, ... }
    const descriptorMap = new Map<string, Record<string, string>>();
    for (const row of descriptorRows) {
      const existing = descriptorMap.get(row.skillId) ?? {};
      existing[String(row.level)] = row.text;
      descriptorMap.set(row.skillId, existing);
    }

    // Latest coaching note per screen. We only consider sessions with a
    // non-null priority — empty priorities aren't shown. First row per screen
    // wins since sessionRows are ordered by date DESC. (Voided-session
    // filtering is added below, at the single-latest-priority step.)
    const seenScreens = new Set<string>();
    const latestCoachingNotes: ParentCoachingNote[] = [];
    for (const row of sessionRows) {
      if (row.screenSlug === null) continue;
      if (row.coachingPriority === null) continue;
      if (seenScreens.has(row.screenSlug)) continue;
      seenScreens.add(row.screenSlug);
      latestCoachingNotes.push({
        screenSlug: row.screenSlug,
        screenName: SCREEN_NAMES[row.screenSlug] ?? row.screenSlug,
        text: row.coachingPriority,
        sessionDate: row.sessionDate,
      });
    }

    // Attach level descriptors per skill
    const parentSkills = full.skills.map((skill) => ({
      ...skill,
      ...(descriptorMap.has(skill.skillId) && { levelDescriptors: descriptorMap.get(skill.skillId) }),
    }));

    const response: ParentSwimmerProgressResponse = ParentSwimmerProgressResponseSchema.parse({
      skills: parentSkills,
      startProgress: full.startProgress,
      headPositionOverall: full.headPositionOverall,
      coachingPriorities: full.coachingPriorities,
      latestCoachingNotes,
      latestCoachingPriority,
    });

    req.log.info({ swimmerId, skillCount: parentSkills.length }, "parent swimmer progress fetched");
    res.json(response);
  }),
);

// GET /swimmers/:id/score-history: parent-facing time-series for charts.
// Reuses the same computation as the coach endpoint. The response contains
// only derived aggregates (head position overall, per-category averages,
// start grade progression) and never leaks fault tags, voided rows, or coach
// notes. Access is gated by the same middleware chain as the parent progress
// route: parent role, member of the swimmer's household, swimmer is active.
parentProgressRouter.get(
  "/:id/score-history",
  requireUser,
  requireParent,
  validate({ params: IdParamsSchema }),
  requireHouseholdMember,
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    // Pass includeFaultTrends:false EXPLICITLY so the contract isn't tied
    // to a library default; the result still carries a `faultTrends: []`
    // field and sessionIds on every point / recentChange / milestone /
    // measurement point. The parent-facing shape omits both — fault data
    // because parents never see negative coaching language, sessionIds
    // because they exist to deep-link to the coach edit page which parents
    // can't reach (ADR 032). Both omissions are serialization-boundary
    // invariants: `.strict()` on the parent schema rejects any slip-through
    // at parse time instead of silently reaching a parent client.
    const raw = await computeScoreHistory(swimmerId, { includeFaultTrends: false });
    const parentFacing = {
      points: raw.points.map(({ sessionId: _sessionId, ...rest }) => rest),
      recentChanges: raw.recentChanges.map(({ sessionId: _sessionId, ...rest }) => rest),
      milestones: raw.milestones.map((milestone) =>
        milestone.type === "personal_best"
          ? milestone
          : (() => {
              const { sessionId: _sessionId, ...rest } = milestone;
              return rest;
            })(),
      ),
      measurements: raw.measurements.map((series) => ({
        ...series,
        points: series.points.map(({ sessionId: _sessionId, ...rest }) => rest),
      })),
    };
    const body = ParentScoreHistoryResponseSchema.parse(parentFacing);
    req.log.info({ swimmerId, pointCount: body.points.length }, "parent score history fetched");
    res.json(body);
  }),
);

// GET /swimmers/:id/personal-bests: parent-facing personal bests.
// Mirrors the coach-side best-time computation (meet swims only, grouped by
// event + course, MIN(timeHundredths)) and joins meets to include the meet
// date and name of the swim that set each PB.
parentProgressRouter.get(
  "/:id/personal-bests",
  requireUser,
  requireParent,
  validate({ params: IdParamsSchema }),
  requireHouseholdMember,
  requireHouseholdSwimmer,
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;

    const pbRows = await db
      .select({
        eventDistance: meetSwims.eventDistance,
        eventStroke: meetSwims.eventStroke,
        course: meetSwims.course,
        timeHundredths: sql<number>`MIN(${meetSwims.timeHundredths})`.as("time_hundredths"),
      })
      .from(meetSwims)
      .where(and(eq(meetSwims.swimmerId, swimmerId), eq(meetSwims.swimType, "meet")))
      .groupBy(meetSwims.eventDistance, meetSwims.eventStroke, meetSwims.course);

    const swimRows = pbRows.length === 0
      ? []
      : await db
          .select({
            eventDistance: meetSwims.eventDistance,
            eventStroke: meetSwims.eventStroke,
            course: meetSwims.course,
            timeHundredths: meetSwims.timeHundredths,
            meetName: meets.name,
            meetDate: meets.meetDate,
          })
          .from(meetSwims)
          .leftJoin(meets, eq(meets.id, meetSwims.meetId))
          .where(and(eq(meetSwims.swimmerId, swimmerId), eq(meetSwims.swimType, "meet")));

    const personalBests: ParentPersonalBest[] = pbRows.flatMap((pb) => {
      const match = swimRows.find(
        (row) =>
          row.eventDistance === pb.eventDistance &&
          row.eventStroke === pb.eventStroke &&
          row.course === pb.course &&
          row.timeHundredths === pb.timeHundredths,
      );
      if (!match) return [];
      return [
        {
          eventDistance: pb.eventDistance,
          eventStroke: pb.eventStroke,
          course: pb.course,
          timeHundredths: pb.timeHundredths,
          timeString: formatSwimTime(pb.timeHundredths),
          meetDate: match.meetDate ?? null,
          meetName: match.meetName ?? null,
        },
      ];
    });

    const body: ParentPersonalBestsResponse = ParentPersonalBestsResponseSchema.parse({
      personalBests,
    });

    req.log.info(
      { swimmerId, pbCount: personalBests.length },
      "parent swimmer personal bests fetched",
    );
    res.json(body);
  }),
);
