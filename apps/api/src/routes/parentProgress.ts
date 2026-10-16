import { Router } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { evaluationSessions, skillLevelDescriptors } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdSwimmer } from "../middleware/requireHouseholdSwimmer";
import { computeSwimmerProgress } from "../lib/progressCalculation";
import {
  IdParamsSchema,
  ParentSwimmerProgressResponseSchema,
  SCREEN_NAMES,
  type IdParams,
  type ParentCoachingNote,
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

    // Fetch level descriptors and latest coaching notes in parallel
    const [descriptorRows, sessionRows] = await Promise.all([
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
        .orderBy(desc(evaluationSessions.sessionDate)),
    ]);

    // Build per-skill descriptor map: skillId -> { "1": text, "2": text, ... }
    const descriptorMap = new Map<string, Record<string, string>>();
    for (const row of descriptorRows) {
      const existing = descriptorMap.get(row.skillId) ?? {};
      existing[String(row.level)] = row.text;
      descriptorMap.set(row.skillId, existing);
    }

    // Latest coaching note per screen (first seen wins since ordered by date DESC)
    const seenScreens = new Set<string>();
    const latestCoachingNotes: ParentCoachingNote[] = [];
    for (const row of sessionRows) {
      if (row.screenSlug === null) continue;
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
    });

    req.log.info({ swimmerId, skillCount: parentSkills.length }, "parent swimmer progress fetched");
    res.json(response);
  }),
);
