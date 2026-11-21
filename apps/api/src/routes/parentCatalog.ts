// GET /parent/categories — the same skill-catalog shape the coach gets at
// /coach/categories, minus fault tags. Parents never see fault-tag metadata.
//
// Why the parent needs it: the parent progress page renders a group
// switcher that needs to know which skills live in each stroke/group.
// Before this route existed, the parent page called /coach/categories and
// got 403 because the coach router guards the entire /coach/* tree with
// requireCoach — the page then rendered a "Couldn't load skill categories"
// banner.

import { Router } from "express";
import { asc, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { skillCategories, skillLevelDescriptors, skills } from "../db/schema";
import { requireUser } from "../middleware/requireUser";
import { requireParent } from "../middleware/requireParent";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  ParentCategoriesResponseSchema,
  type ParentCategoriesResponse,
} from "@swim-app/shared";

export const parentCatalogRouter = Router();

parentCatalogRouter.get(
  "/categories",
  requireUser,
  requireParent,
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

    const payload = categoryRows.map((cat) => ({
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
        descriptors: descriptorsBySkill.get(skill.id) ?? [],
      })),
    }));

    // Parse through the strict parent schema so a future addition of a
    // coach-only field to SkillForRating fails here rather than leaking.
    const response: ParentCategoriesResponse = ParentCategoriesResponseSchema.parse(payload);
    req.log.info({ count: response.length }, "parent skill categories fetched");
    res.json(response);
  }),
);
