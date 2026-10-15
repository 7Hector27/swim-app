import { Router } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { evaluationSessions, skillCategories, skillLevelDescriptors } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireHouseholdSwimmer } from "../middleware/requireHouseholdSwimmer";
import { computeSwimmerProgress } from "../lib/progressCalculation";
import {
  IdParamsSchema,
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
  requireHouseholdMember,
  requireHouseholdSwimmer,
  validate({ params: IdParamsSchema }),
  asyncHandler(async (req, res) => {
    const { id: swimmerId } = req.params as unknown as IdParams;
    const full = await computeSwimmerProgress(swimmerId);

    const displayedSkillIds = full.skills.map((s) => s.skillId);

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
          categoryId: evaluationSessions.categoryId,
          categoryName: skillCategories.name,
          sessionDate: evaluationSessions.sessionDate,
          coachingPriority: evaluationSessions.coachingPriority,
        })
        .from(evaluationSessions)
        .innerJoin(skillCategories, eq(skillCategories.id, evaluationSessions.categoryId))
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

    // Latest coaching note per category (first seen wins since ordered by date DESC)
    const seenCategories = new Set<string>();
    const latestCoachingNotes: ParentCoachingNote[] = [];
    for (const row of sessionRows) {
      if (seenCategories.has(row.categoryId)) continue;
      seenCategories.add(row.categoryId);
      latestCoachingNotes.push({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        text: row.coachingPriority,
        sessionDate: row.sessionDate,
      });
    }

    // Strip faultTags from every history point, attach level descriptors
    const parentSkills = full.skills.map((skill) => ({
      ...skill,
      history: skill.history.map(({ faultTags: _faultTags, ...point }) => point),
      ...(descriptorMap.has(skill.skillId) && { levelDescriptors: descriptorMap.get(skill.skillId) }),
    }));

    const response: ParentSwimmerProgressResponse = {
      skills: parentSkills,
      startProgress: full.startProgress,
      headPositionOverall: full.headPositionOverall,
      coachingPriorities: full.coachingPriorities,
      latestCoachingNotes,
    };

    req.log.info({ swimmerId, skillCount: parentSkills.length }, "parent swimmer progress fetched");
    res.json(response);
  }),
);
