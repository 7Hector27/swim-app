import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  evaluationSessions,
  lessonLocations,
  lessonSwimmers,
  lessons,
  meetSwims,
  meets,
  skillLevelDescriptors,
  skillRatings,
  swimmers,
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
  ParentSwimmerSummariesResponseSchema,
  SCREEN_NAMES,
  type IdParams,
  type LatestCoachingPriority,
  type ParentCoachingNote,
  type ParentPersonalBest,
  type ParentPersonalBestsResponse,
  type ParentSwimmerSummariesResponse,
  type ParentSwimmerSummary,
  type ParentSwimmerSummaryBestEvent,
  type ParentSwimmerSummaryNextLesson,
  type ParentSwimmerProgressResponse,
  type SwimStroke,
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

// GET /swimmers/me/summary: one row per active swimmer in the parent's
// household. Powers the dashboard swimmer cards in a single round-trip so the
// client does not have to fan out one request per swimmer. Four scoped queries:
// (1) active swimmers in the household, (2) next upcoming lesson per swimmer
// via DISTINCT ON, (3) latest evaluation date per swimmer with at least one
// live rating, (4) meet personal bests per swimmer. The best-event choice
// mirrors the previous dashboard logic: prefer the fastest 50 Free across
// courses, otherwise fall back to the lowest stroke order then shortest
// distance. Access control: same middleware chain as /swimmers/me so the
// response can never reach a non-parent or a user without a household.
parentProgressRouter.get(
  "/me/summary",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const { householdId } = req;

    const activeSwimmers = await db
      .select({ id: swimmers.id, isPublic: swimmers.isPublic })
      .from(swimmers)
      .where(and(isNull(swimmers.archivedAt), eq(swimmers.householdId, householdId)));

    if (activeSwimmers.length === 0) {
      const empty: ParentSwimmerSummariesResponse = ParentSwimmerSummariesResponseSchema.parse({
        summaries: [],
      });
      res.json(empty);
      return;
    }

    const swimmerIds = activeSwimmers.map((row) => row.id);
    const now = new Date();

    const [nextLessonRows, lastEvalRows, pbRows] = await Promise.all([
      // (2) DISTINCT ON (ls.swimmer_id): one row per swimmer, the earliest
      // upcoming lesson they're on. Upcoming = status in (pending, approved)
      // AND end time > now, matching the /lessons?filter=upcoming definition.
      db.execute<{
        swimmer_id: string;
        starts_at: Date;
        duration_minutes: number;
        location_name: string;
      }>(sql`
        SELECT DISTINCT ON (${lessonSwimmers.swimmerId})
          ${lessonSwimmers.swimmerId} AS swimmer_id,
          ${lessons.startsAt} AS starts_at,
          ${lessons.durationMinutes} AS duration_minutes,
          ${lessonLocations.name} AS location_name
        FROM ${lessonSwimmers}
        INNER JOIN ${lessons} ON ${lessons.id} = ${lessonSwimmers.lessonId}
        INNER JOIN ${lessonLocations} ON ${lessonLocations.id} = ${lessons.locationId}
        WHERE ${lessons.householdId} = ${householdId}
          AND ${lessons.status} IN ('pending', 'approved')
          AND ${lessons.startsAt} + ${lessons.durationMinutes} * interval '1 minute' > ${now.toISOString()}::timestamptz
          AND ${lessonSwimmers.swimmerId} IN (${sql.join(
            swimmerIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
        ORDER BY ${lessonSwimmers.swimmerId}, ${lessons.startsAt} ASC
      `),
      // (3) Latest evaluation date per swimmer. A session only counts when it
      // has at least one non-voided, non-superseded rating — matches the
      // "non-voided evaluation" rule used elsewhere in this file so the
      // relative-date label stays consistent with the rest of the parent UI.
      db
        .select({
          swimmerId: evaluationSessions.swimmerId,
          lastSessionDate: sql<string>`MAX(${evaluationSessions.sessionDate})`.as(
            "last_session_date",
          ),
        })
        .from(evaluationSessions)
        .where(
          and(
            inArray(evaluationSessions.swimmerId, swimmerIds),
            sql`EXISTS (
              SELECT 1 FROM ${skillRatings}
              WHERE ${skillRatings.sessionId} = ${evaluationSessions.id}
                AND ${skillRatings.voidedAt} IS NULL
                AND ${skillRatings.supersededAt} IS NULL
            )`,
          ),
        )
        .groupBy(evaluationSessions.swimmerId),
      // (4) Meet personal bests per swimmer, grouped by event+course. Practice
      // swims are excluded, matching the single-swimmer /personal-bests route.
      db
        .select({
          swimmerId: meetSwims.swimmerId,
          eventDistance: meetSwims.eventDistance,
          eventStroke: meetSwims.eventStroke,
          course: meetSwims.course,
          timeHundredths: sql<number>`MIN(${meetSwims.timeHundredths})`.as(
            "time_hundredths",
          ),
        })
        .from(meetSwims)
        .where(
          and(
            inArray(meetSwims.swimmerId, swimmerIds),
            eq(meetSwims.swimType, "meet"),
          ),
        )
        .groupBy(
          meetSwims.swimmerId,
          meetSwims.eventDistance,
          meetSwims.eventStroke,
          meetSwims.course,
        ),
    ]);

    // db.execute returns a RowList that still exposes array semantics; iterate
    // directly to collect typed next-lesson rows per swimmer.
    const nextLessonBySwimmer = new Map<string, ParentSwimmerSummaryNextLesson>();
    for (const row of nextLessonRows as unknown as Array<{
      swimmer_id: string;
      starts_at: Date | string;
      duration_minutes: number;
      location_name: string;
    }>) {
      const startsAt = row.starts_at instanceof Date
        ? row.starts_at.toISOString()
        : new Date(row.starts_at).toISOString();
      nextLessonBySwimmer.set(row.swimmer_id, {
        startsAt,
        durationMinutes: row.duration_minutes,
        locationName: row.location_name,
      });
    }

    const lastEvalBySwimmer = new Map<string, string>();
    for (const row of lastEvalRows) {
      if (row.lastSessionDate) lastEvalBySwimmer.set(row.swimmerId, row.lastSessionDate);
    }

    const pbsBySwimmer = new Map<
      string,
      Array<{ eventDistance: number; eventStroke: SwimStroke; timeHundredths: number }>
    >();
    for (const row of pbRows) {
      const existing = pbsBySwimmer.get(row.swimmerId) ?? [];
      existing.push({
        eventDistance: row.eventDistance,
        eventStroke: row.eventStroke,
        timeHundredths: row.timeHundredths,
      });
      pbsBySwimmer.set(row.swimmerId, existing);
    }

    const summaries: ParentSwimmerSummary[] = activeSwimmers.map((swimmer) => {
      const pbs = pbsBySwimmer.get(swimmer.id) ?? [];
      const bestEvent = pickBestEvent(pbs);
      return {
        swimmerId: swimmer.id,
        nextLesson: nextLessonBySwimmer.get(swimmer.id) ?? null,
        lastEvaluatedOn: lastEvalBySwimmer.get(swimmer.id) ?? null,
        bestEvent,
        onLeaderboards: swimmer.isPublic && pbs.length > 0,
      };
    });

    const body: ParentSwimmerSummariesResponse = ParentSwimmerSummariesResponseSchema.parse({
      summaries,
    });

    req.log.info(
      { householdId, swimmerCount: summaries.length },
      "parent swimmer summary fetched",
    );
    res.json(body);
  }),
);

// Prefer the fastest 50 Free (across courses); otherwise fall back by stroke
// order (free, back, breast, fly, im), then shortest distance. Returns the
// pre-formatted label + timeString shape the parent card displays verbatim.
const STROKE_LABEL: Record<SwimStroke, string> = {
  free: "Free",
  back: "Back",
  breast: "Breast",
  fly: "Fly",
  im: "IM",
};
const STROKE_ORDER: Record<SwimStroke, number> = {
  free: 0,
  back: 1,
  breast: 2,
  fly: 3,
  im: 4,
};

function pickBestEvent(
  pbs: Array<{ eventDistance: number; eventStroke: SwimStroke; timeHundredths: number }>,
): ParentSwimmerSummaryBestEvent | null {
  if (pbs.length === 0) return null;

  const fiftyFrees = pbs.filter((pb) => pb.eventDistance === 50 && pb.eventStroke === "free");
  if (fiftyFrees.length > 0) {
    const fastest = fiftyFrees.reduce((best, current) =>
      current.timeHundredths < best.timeHundredths ? current : best,
    );
    return { label: "50 Free", timeString: formatSwimTime(fastest.timeHundredths) };
  }

  const sorted = [...pbs].sort((a, b) => {
    const strokeDiff = STROKE_ORDER[a.eventStroke] - STROKE_ORDER[b.eventStroke];
    if (strokeDiff !== 0) return strokeDiff;
    return a.eventDistance - b.eventDistance;
  });
  const pick = sorted[0];
  if (!pick) return null;
  return {
    label: `${pick.eventDistance} ${STROKE_LABEL[pick.eventStroke]}`,
    timeString: formatSwimTime(pick.timeHundredths),
  };
}
