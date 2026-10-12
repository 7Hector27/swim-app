import { z } from "zod";

export const SkillTypeSchema = z.enum(["rubric", "measured", "score", "composite", "rollup"]);
export type SkillType = z.infer<typeof SkillTypeSchema>;

export const StrokeSchema = z.enum(["free", "back", "breast", "fly"]);
export type Stroke = z.infer<typeof StrokeSchema>;

export const SkillCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  categoryId: z.string().uuid(),
  name: z.string(),
  type: SkillTypeSchema,
  unit: z.string().nullable(),
  stroke: StrokeSchema.nullable(),
  appliesTo: z.array(StrokeSchema).nullable(),
  parentSkillId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Skill = z.infer<typeof SkillSchema>;

export const SkillLevelDescriptorSchema = z.object({
  skillId: z.string().uuid(),
  level: z.number().int().min(1).max(5),
  text: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type SkillLevelDescriptor = z.infer<typeof SkillLevelDescriptorSchema>;

export const SkillDependencySchema = z.object({
  skillId: z.string().uuid(),
  dependsOnSkillId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
});
export type SkillDependency = z.infer<typeof SkillDependencySchema>;

export const RatingScaleLevelSchema = z.object({
  level: z.number().int().min(1).max(5),
  label: z.string(),
  meaning: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type RatingScaleLevel = z.infer<typeof RatingScaleLevelSchema>;
