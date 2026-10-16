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

  it("has 9 categories in the correct order", () => {
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
      "water-confidence",
    ]);
  });

  it("skill counts per category match the rubric", () => {
    const counts = Object.fromEntries(
      SKILLS_CATALOG.map((category) => [category.slug, category.skills.length]),
    );
    expect(counts).toEqual({
      "body-position-balance": 8,
      "breathing-coordination": 12,
      freestyle: 16,
      backstroke: 16,
      breaststroke: 13,
      butterfly: 15,
      "starts-turns-underwaters": 41,
      "racing-performance": 5,
      "water-confidence": 5,
    });
  });

  it("all skills with faultTags have string[] values", () => {
    const invalid: string[] = [];
    for (const skill of allSkills) {
      if (skill.faultTags !== undefined) {
        if (!skill.faultTags.every((tag) => typeof tag === "string")) {
          invalid.push(skill.slug);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it("ratedPerSide is a boolean when present", () => {
    const invalid: string[] = [];
    for (const skill of allSkills) {
      if (skill.ratedPerSide !== undefined && typeof skill.ratedPerSide !== "boolean") {
        invalid.push(skill.slug);
      }
    }
    expect(invalid).toEqual([]);
  });

  it("free-bilateral-breathing is type rollup", () => {
    const allSkills = SKILLS_CATALOG.flatMap((c) => c.skills);
    const bilateral = allSkills.find((s) => s.slug === "free-bilateral-breathing");
    expect(bilateral?.type).toBe("rollup");
    expect(bilateral?.ratedPerSide).toBeUndefined();
  });

  it("notLegalAllowed is true on the correct skills and false/absent on all others", () => {
    const expectedAllowed = new Set([
      // start components
      "track-start-reaction", "track-start-acceleration", "track-start-height",
      "track-start-distance", "track-start-head-arm-hand", "track-start-leg-feet",
      "relay-start-reaction", "relay-start-acceleration", "relay-start-height",
      "relay-start-distance", "relay-start-head-arm-hand", "relay-start-leg-feet",
      "back-start-reaction", "back-start-push", "back-start-arch",
      "back-start-distance", "back-start-entry-alignment", "back-start-streamline",
      // turns
      "freestyle-flip-turn", "backstroke-flip-turn",
      "breaststroke-open-turn", "butterfly-open-turn",
      "im-fly-to-back", "im-back-to-breast-open", "im-back-to-breast-bucket",
      "im-back-to-breast-crossover", "im-breast-to-free",
      // breakouts
      "breakout-free", "breakout-back", "breakout-breast", "breakout-fly",
      // stroke kicks
      "free-kick", "back-kick", "breast-kick-mechanics", "fly-dolphin-kick",
    ]);
    const allSkills = SKILLS_CATALOG.flatMap((c) => c.skills);
    const actualAllowed = allSkills
      .filter((s) => s.notLegalAllowed === true)
      .map((s) => s.slug);
    expect(new Set(actualAllowed)).toEqual(expectedAllowed);

    const wronglyAllowed = allSkills
      .filter((s) => s.notLegalAllowed === true && !expectedAllowed.has(s.slug));
    expect(wronglyAllowed).toEqual([]);
  });

  it("archived skills are not present in the catalog", () => {
    const archivedSlugs = [
      "body-rotation",
      "rhythmic-breathing",
      "bilateral-breathing",
      "breast-stroke-rate",
      "breathing-timing-back",
      "stroke-breath-coordination-back",
      "im-back-to-breast",
      "stroke-count",
      "free-distance-per-stroke",
      "tempo",
      "finishing",
      "udk-free-fly",
    ];
    const present = archivedSlugs.filter((slug) => slugSet.has(slug));
    expect(present).toEqual([]);
  });

  it("skills from this PR that are archived have archived: true", () => {
    const expectedArchived = [
      "horizontal-alignment",
      "hip-position",
      "free-breathing-mechanics",
      "breast-breathing",
      "back-start-streamline",
    ];
    for (const slug of expectedArchived) {
      expect(slugSet.has(slug), `${slug} should be in the catalog`).toBe(true);
      const skill = allSkills.find((skillItem) => skillItem.slug === slug);
      expect(skill?.archived, `${slug} should have archived: true`).toBe(true);
    }
  });

  it("breathing-timing and stroke-breath-coordination skills have updated names", () => {
    const breathTimingSlugs = [
      "breathing-timing-free",
      "breathing-timing-breast",
      "breathing-timing-fly",
    ];
    for (const slug of breathTimingSlugs) {
      const skill = allSkills.find((skillItem) => skillItem.slug === slug);
      expect(skill?.name, `${slug} should have name "Breath timing"`).toBe("Breath timing");
    }

    const strokeIntegritySlugs = [
      "stroke-breath-coordination-free",
      "stroke-breath-coordination-breast",
      "stroke-breath-coordination-fly",
    ];
    for (const slug of strokeIntegritySlugs) {
      const skill = allSkills.find((skillItem) => skillItem.slug === slug);
      expect(
        skill?.name,
        `${slug} should have name "Stroke integrity on breath"`,
      ).toBe("Stroke integrity on breath");
    }
  });

  it("per-stroke alignment and hip-position skills are present for free, breast, fly and back", () => {
    const expectedSlugs = [
      "free-horizontal-alignment",
      "free-hip-position",
      "breast-horizontal-alignment",
      "breast-hip-position",
      "fly-horizontal-alignment",
      "fly-hip-position",
      "back-hip-position",
    ];
    for (const slug of expectedSlugs) {
      expect(slugSet.has(slug), `${slug} should be in the catalog`).toBe(true);
    }
  });

  it("golf scores are present for all four strokes", () => {
    const golfScoreSlugs = ["free-golf-score", "back-golf-score", "fly-golf-score"];
    for (const slug of golfScoreSlugs) {
      expect(slugSet.has(slug), `${slug} should be in the catalog`).toBe(true);
    }
    const breastEfficiency = allSkills.find(
      (skillItem) => skillItem.slug === "breast-propulsion-efficiency",
    );
    expect(breastEfficiency?.name).toBe("Golf score");
    expect(breastEfficiency?.type).toBe("score");
  });

  it("streamline-in-motion is present and shared across all strokes", () => {
    const skill = allSkills.find((skillItem) => skillItem.slug === "streamline-in-motion");
    expect(skill).toBeDefined();
    expect(skill?.appliesTo).toContain("free");
    expect(skill?.appliesTo).toContain("back");
    expect(skill?.appliesTo).toContain("breast");
    expect(skill?.appliesTo).toContain("fly");
  });

  it("the 5 skills with new descriptors each have exactly 5 descriptors", () => {
    const slugsWithDescriptors = [
      "breathing-timing-free",
      "stroke-breath-coordination-free",
      "breathing-timing-fly",
      "breathing-timing-breast",
      "exhalation",
    ];
    for (const slug of slugsWithDescriptors) {
      const skill = allSkills.find((skillItem) => skillItem.slug === slug);
      expect(skill, `${slug} should be in the catalog`).toBeDefined();
      expect(skill?.descriptors?.length, `${slug} should have exactly 5 descriptors`).toBe(5);
    }
  });

  it("the 3 skills with new fault tags have the correct tags", () => {
    const exhalation = allSkills.find((skillItem) => skillItem.slug === "exhalation");
    expect(exhalation?.faultTags).toEqual(["holds breath", "exhales above water", "empties too early"]);

    const strokeBreathCoordFree = allSkills.find(
      (skillItem) => skillItem.slug === "stroke-breath-coordination-free",
    );
    expect(strokeBreathCoordFree?.faultTags).toEqual([
      "lead arm drops",
      "kick stops",
      "stroke pauses",
      "hips sink",
      "over-rotates",
    ]);

    const breathingTimingBreast = allSkills.find(
      (skillItem) => skillItem.slug === "breathing-timing-breast",
    );
    expect(breathingTimingBreast?.faultTags).toEqual([
      "lifts early",
      "lifts late",
      "surfaces late",
      "returns too slow",
      "returns too fast",
      "stays up through the kick",
    ]);
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
