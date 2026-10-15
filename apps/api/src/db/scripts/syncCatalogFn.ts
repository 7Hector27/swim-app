// Core sync logic extracted so it can be called from tests with an injected db.

import { and, eq, inArray, isNull, not } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  ratingScaleLevels,
  skillCategories,
  skillDependencies,
  skillLevelDescriptors,
  skills,
} from "../schema";
import {
  RATING_SCALE,
  SKILLS_CATALOG,
  type CatalogCategory,
  type CatalogSkill,
} from "../reference/skillsCatalog";

// ── Validation ────────────────────────────────────────────────────────────────

function validateCatalog(categories: CatalogCategory[]): void {
  const allSlugs = new Set<string>();
  const allSkills: CatalogSkill[] = [];

  for (const category of categories) {
    for (const skill of category.skills) {
      if (allSlugs.has(skill.slug)) {
        throw new Error(`Duplicate skill slug: ${skill.slug}`);
      }
      allSlugs.add(skill.slug);
      allSkills.push(skill);

      for (const descriptor of skill.descriptors ?? []) {
        if (descriptor.level < 1 || descriptor.level > 5) {
          throw new Error(
            `Descriptor level out of range for skill ${skill.slug}: ${descriptor.level}`,
          );
        }
      }
    }
  }

  for (const skill of allSkills) {
    for (const dep of skill.builtOnSlugs ?? []) {
      if (!allSlugs.has(dep)) {
        throw new Error(
          `Skill ${skill.slug} references unknown dependency slug: ${dep}`,
        );
      }
    }
    if (skill.parentSlug !== undefined && !allSlugs.has(skill.parentSlug)) {
      throw new Error(
        `Skill ${skill.slug} references unknown parent slug: ${skill.parentSlug}`,
      );
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const skill of allSkills) {
    adjacency.set(skill.slug, skill.builtOnSlugs ?? []);
  }
  detectCycles(adjacency);
}

function detectCycles(graph: Map<string, string[]>): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of graph.keys()) color.set(node, WHITE);

  function dfs(node: string, path: string[]): void {
    color.set(node, GRAY);
    for (const neighbor of graph.get(node) ?? []) {
      const neighborColor = color.get(neighbor) ?? WHITE;
      if (neighborColor === GRAY) {
        throw new Error(
          `Dependency cycle detected: ${[...path, node, neighbor].join(" → ")}`,
        );
      }
      if (neighborColor === WHITE) {
        dfs(neighbor, [...path, node]);
      }
    }
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) dfs(node, []);
  }
}

// ── Sync ──────────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof drizzle>;

export default async function syncCatalogFn(db: Db): Promise<void> {
  // Guard: an empty catalog import would archive every skill in the database.
  const allCatalogSkills = SKILLS_CATALOG.flatMap((c) => c.skills);
  if (SKILLS_CATALOG.length === 0 || allCatalogSkills.length === 0) {
    throw new Error(
      "Catalog is empty — aborting to prevent archiving all skills in the database.",
    );
  }

  process.stdout.write("Validating catalog…\n");
  validateCatalog(SKILLS_CATALOG);
  process.stdout.write("Validation passed.\n");

  await db.transaction(async (tx) => {
    // ── Rating scale ───────────────────────────────────────────────────────────
    process.stdout.write("Syncing rating scale…\n");
    for (const row of RATING_SCALE) {
      await tx
        .insert(ratingScaleLevels)
        .values({ level: row.level, label: row.label, meaning: row.meaning })
        .onConflictDoUpdate({
          target: ratingScaleLevels.level,
          set: { label: row.label, meaning: row.meaning },
        });
    }

    // ── Categories ─────────────────────────────────────────────────────────────
    process.stdout.write("Syncing categories…\n");
    const categorySlugToId = new Map<string, string>();

    for (const category of SKILLS_CATALOG) {
      const [row] = await tx
        .insert(skillCategories)
        .values({
          slug: category.slug,
          name: category.name,
          sortOrder: category.sortOrder,
        })
        .onConflictDoUpdate({
          target: skillCategories.slug,
          set: { name: category.name, sortOrder: category.sortOrder },
        })
        .returning({ id: skillCategories.id });

      if (!row) throw new Error(`Category upsert returned no row: ${category.slug}`);
      categorySlugToId.set(category.slug, row.id);
    }

    // ── Skills — two passes ────────────────────────────────────────────────────
    process.stdout.write("Syncing skills (pass 1)…\n");
    const skillSlugToId = new Map<string, string>();

    for (const category of SKILLS_CATALOG) {
      const categoryId = categorySlugToId.get(category.slug);
      if (!categoryId) throw new Error(`No categoryId for ${category.slug}`);

      for (const skill of category.skills) {
        const [row] = await tx
          .insert(skills)
          .values({
            slug: skill.slug,
            categoryId,
            name: skill.name,
            type: skill.type,
            unit: skill.unit ?? null,
            stroke: skill.stroke ?? null,
            appliesTo: skill.appliesTo ?? null,
            parentSkillId: null,
            sortOrder: skill.sortOrder,
            faultTags: skill.faultTags ?? null,
            ratedPerSide: skill.ratedPerSide ?? false,
            notLegalAllowed: skill.notLegalAllowed ?? false,
          })
          .onConflictDoUpdate({
            target: skills.slug,
            set: {
              categoryId,
              name: skill.name,
              type: skill.type,
              unit: skill.unit ?? null,
              stroke: skill.stroke ?? null,
              appliesTo: skill.appliesTo ?? null,
              parentSkillId: null,
              sortOrder: skill.sortOrder,
              archivedAt: null,
              faultTags: skill.faultTags ?? null,
              ratedPerSide: skill.ratedPerSide ?? false,
              notLegalAllowed: skill.notLegalAllowed ?? false,
            },
          })
          .returning({ id: skills.id });

        if (!row) throw new Error(`Skill upsert returned no row: ${skill.slug}`);
        skillSlugToId.set(skill.slug, row.id);
      }
    }

    // Pass 2: set parentSkillId
    process.stdout.write("Syncing skills (pass 2 — parent links)…\n");
    for (const category of SKILLS_CATALOG) {
      for (const skill of category.skills) {
        if (!skill.parentSlug) continue;
        const parentId = skillSlugToId.get(skill.parentSlug);
        if (!parentId) throw new Error(`No id for parent slug ${skill.parentSlug}`);
        const skillId = skillSlugToId.get(skill.slug);
        if (!skillId) throw new Error(`No id for skill ${skill.slug}`);

        await tx
          .update(skills)
          .set({ parentSkillId: parentId })
          .where(eq(skills.id, skillId));
      }
    }

    // ── Archive removed skills ─────────────────────────────────────────────────
    process.stdout.write("Archiving removed skills…\n");
    const catalogSlugs = SKILLS_CATALOG.flatMap((category) =>
      category.skills.map((skill) => skill.slug),
    );

    await tx
      .update(skills)
      .set({ archivedAt: new Date() })
      .where(
        and(
          not(inArray(skills.slug, catalogSlugs)),
          isNull(skills.archivedAt),
        ),
      );

    // ── Descriptors ────────────────────────────────────────────────────────────
    process.stdout.write("Syncing descriptors…\n");
    for (const category of SKILLS_CATALOG) {
      for (const skill of category.skills) {
        if (!skill.descriptors?.length) continue;
        const skillId = skillSlugToId.get(skill.slug);
        if (!skillId) throw new Error(`No id for skill ${skill.slug}`);

        for (const descriptor of skill.descriptors) {
          await tx
            .insert(skillLevelDescriptors)
            .values({ skillId, level: descriptor.level, text: descriptor.text })
            .onConflictDoUpdate({
              target: [skillLevelDescriptors.skillId, skillLevelDescriptors.level],
              set: { text: descriptor.text },
            });
        }
      }
    }

    // ── Dependencies ───────────────────────────────────────────────────────────
    // Delete all existing deps for catalog skills, then re-insert from the
    // catalog. This removes stale edges when builtOnSlugs entries are removed.
    process.stdout.write("Syncing dependencies…\n");
    const catalogSkillIds = [...skillSlugToId.values()];

    if (catalogSkillIds.length > 0) {
      await tx
        .delete(skillDependencies)
        .where(inArray(skillDependencies.skillId, catalogSkillIds));
    }

    for (const category of SKILLS_CATALOG) {
      for (const skill of category.skills) {
        if (!skill.builtOnSlugs?.length) continue;
        const skillId = skillSlugToId.get(skill.slug);
        if (!skillId) throw new Error(`No id for skill ${skill.slug}`);

        for (const depSlug of skill.builtOnSlugs) {
          const dependsOnId = skillSlugToId.get(depSlug);
          if (!dependsOnId) throw new Error(`No id for dependency slug ${depSlug}`);

          await tx
            .insert(skillDependencies)
            .values({ skillId, dependsOnSkillId: dependsOnId });
        }
      }
    }
  });

  process.stdout.write("Catalog sync complete.\n");
}
