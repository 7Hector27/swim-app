// Integration test for the catalog sync script.
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  ratingScaleLevels,
  skillCategories,
  skillDependencies,
  skillLevelDescriptors,
  skills,
} from "../../db/schema";
import { SKILLS_CATALOG, RATING_SCALE } from "../../db/reference/skillsCatalog";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";

// setup.ts sets DATABASE_URL = INTEGRATION_DATABASE_URL before any test file loads
let pool: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
  pool = postgres(process.env["DATABASE_URL"]!);
  db = drizzle(pool);
});

afterAll(async () => {
  // Clean up catalog rows inserted by these tests
  await db.delete(skillDependencies);
  await db.delete(skillLevelDescriptors);
  await db.delete(skills);
  await db.delete(skillCategories);
  await db.delete(ratingScaleLevels);
  await pool.end();
});

describe("catalog sync", () => {
  it("populates all categories and skills on first run", async () => {
    await syncCatalogFn(db);

    const categoryRows = await db.select().from(skillCategories);
    expect(categoryRows).toHaveLength(SKILLS_CATALOG.length);

    const skillRows = await db.select().from(skills);
    const expectedCount = SKILLS_CATALOG.flatMap((category) => category.skills).length;
    expect(skillRows).toHaveLength(expectedCount);

    const ratingRows = await db.select().from(ratingScaleLevels);
    expect(ratingRows).toHaveLength(RATING_SCALE.length);
  });

  it("is idempotent — running sync twice produces the same row count", async () => {
    const categoryCount = (await db.select().from(skillCategories)).length;
    const skillCount = (await db.select().from(skills)).length;
    const descriptorCount = (await db.select().from(skillLevelDescriptors)).length;
    const dependencyCount = (await db.select().from(skillDependencies)).length;
    const ratingCount = (await db.select().from(ratingScaleLevels)).length;

    await syncCatalogFn(db);

    expect(await db.select().from(skillCategories)).toHaveLength(categoryCount);
    expect(await db.select().from(skills)).toHaveLength(skillCount);
    expect(await db.select().from(skillLevelDescriptors)).toHaveLength(descriptorCount);
    expect(await db.select().from(skillDependencies)).toHaveLength(dependencyCount);
    expect(await db.select().from(ratingScaleLevels)).toHaveLength(ratingCount);
  });

  it("updates a changed descriptor in place on re-sync", async () => {
    const targetSkill = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.slug, "free-catch"))
      .limit(1);

    expect(targetSkill[0]).toBeDefined();
    const skillId = targetSkill[0]!.id;

    // Mutate a descriptor directly in the DB
    await db
      .update(skillLevelDescriptors)
      .set({ text: "MUTATED TEXT FOR TEST" })
      .where(eq(skillLevelDescriptors.skillId, skillId));

    const before = await db
      .select()
      .from(skillLevelDescriptors)
      .where(eq(skillLevelDescriptors.skillId, skillId));
    expect(before.some((row) => row.text === "MUTATED TEXT FOR TEST")).toBe(true);

    // Sync restores the canonical text
    await syncCatalogFn(db);

    const after = await db
      .select()
      .from(skillLevelDescriptors)
      .where(eq(skillLevelDescriptors.skillId, skillId));
    expect(after.some((row) => row.text === "MUTATED TEXT FOR TEST")).toBe(false);

    const originalText = SKILLS_CATALOG.flatMap((category) => category.skills)
      .find((skill) => skill.slug === "free-catch")
      ?.descriptors?.find((descriptor) => descriptor.level === 1)?.text;
    expect(after.some((row) => row.text === originalText)).toBe(true);
  });
});
