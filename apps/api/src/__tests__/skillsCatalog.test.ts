import { describe, it, expect } from "vitest";
import { SKILLS_CATALOG, RATING_SCALE } from "../db/reference/skillsCatalog";

describe("SKILLS_CATALOG", () => {
  const allSkills = SKILLS_CATALOG.flatMap((category) => category.skills);
  const allSlugs = allSkills.map((skill) => skill.slug);
  const slugSet = new Set(allSlugs);

  it("has no duplicate skill slugs", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const slug of allSlugs) {
      if (seen.has(slug)) duplicates.push(slug);
      seen.add(slug);
    }
    expect(duplicates).toEqual([]);
  });

  it("has no duplicate category slugs", () => {
    const categorySlugs = SKILLS_CATALOG.map((category) => category.slug);
    const unique = new Set(categorySlugs);
    expect(unique.size).toBe(categorySlugs.length);
  });

  it("all builtOnSlugs reference known skill slugs", () => {
    const unknownDeps: string[] = [];
    for (const skill of allSkills) {
      for (const dep of skill.builtOnSlugs ?? []) {
        if (!slugSet.has(dep)) {
          unknownDeps.push(`${skill.slug} → ${dep}`);
        }
      }
    }
    expect(unknownDeps).toEqual([]);
  });

  it("all parentSlugs reference known skill slugs", () => {
    const unknownParents: string[] = [];
    for (const skill of allSkills) {
      if (skill.parentSlug !== undefined && !slugSet.has(skill.parentSlug)) {
        unknownParents.push(`${skill.slug} → ${skill.parentSlug}`);
      }
    }
    expect(unknownParents).toEqual([]);
  });

  it("all descriptor levels are between 1 and 5", () => {
    const invalid: string[] = [];
    for (const skill of allSkills) {
      for (const descriptor of skill.descriptors ?? []) {
        if (descriptor.level < 1 || descriptor.level > 5) {
          invalid.push(`${skill.slug} level ${descriptor.level}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it("has no dependency cycles", () => {
    const adjacency = new Map<string, string[]>();
    for (const skill of allSkills) {
      adjacency.set(skill.slug, skill.builtOnSlugs ?? []);
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const node of adjacency.keys()) color.set(node, WHITE);

    const cycles: string[] = [];

    function dfs(node: string, path: string[]): void {
      color.set(node, GRAY);
      for (const neighbor of adjacency.get(node) ?? []) {
        const neighborColor = color.get(neighbor) ?? WHITE;
        if (neighborColor === GRAY) {
          cycles.push([...path, node, neighbor].join(" → "));
        } else if (neighborColor === WHITE) {
          dfs(neighbor, [...path, node]);
        }
      }
      color.set(node, BLACK);
    }

    for (const node of adjacency.keys()) {
      if ((color.get(node) ?? WHITE) === WHITE) dfs(node, []);
    }

    expect(cycles).toEqual([]);
  });

  it("has 8 categories in the correct order", () => {
    const slugs = SKILLS_CATALOG.map((category) => category.slug);
    expect(slugs).toEqual([
      "body-position-balance",
      "breathing-coordination",
      "freestyle",
      "backstroke",
      "breaststroke",
      "butterfly",
      "starts-turns-underwaters",
      "racing-performance",
    ]);
  });

  it("skill counts per category match the rubric", () => {
    const counts = Object.fromEntries(
      SKILLS_CATALOG.map((category) => [category.slug, category.skills.length]),
    );
    expect(counts).toEqual({
      "body-position-balance": 8,
      "breathing-coordination": 12,
      freestyle: 10,
      backstroke: 11,
      breaststroke: 9,
      butterfly: 9,
      "starts-turns-underwaters": 30,
      "racing-performance": 8,
    });
  });
});

describe("RATING_SCALE", () => {
  it("has exactly 5 levels", () => {
    expect(RATING_SCALE).toHaveLength(5);
  });

  it("levels are 1 through 5 in order", () => {
    expect(RATING_SCALE.map((row) => row.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it("labels are Emerging through Mastery", () => {
    expect(RATING_SCALE.map((row) => row.label)).toEqual([
      "Emerging",
      "Developing",
      "Competent",
      "Advanced",
      "Mastery",
    ]);
  });
});
