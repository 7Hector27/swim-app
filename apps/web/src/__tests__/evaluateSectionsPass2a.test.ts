// Pass 2a assertions: the race-order section layout, shared-skill resolution,
// label disambiguation, and section-name slug helper. These live apart from
// evaluateHelpers.test.ts so the Pass 2a layout contract is easy to find.

import { describe, it, expect } from "vitest";
import type { SkillForRating } from "@swim-app/shared";
import { SCREEN_SECTIONS } from "@swim-app/shared";
import {
  buildRatingsArray,
  buildSectionGroups,
  defaultSkillDraft,
  getDisambiguatedLabel,
  slugifySectionName,
} from "../content/EvaluateContent/helpers";

describe("SCREEN_SECTIONS — race-order sections for stroke screens", () => {
  const RACE_ORDER = [
    "Start",
    "Underwaters",
    "Breakout",
    "The swim",
    "The wall",
    "Finish",
    "Numbers",
  ];

  for (const slug of ["freestyle", "backstroke", "breaststroke", "butterfly"] as const) {
    it(`${slug} sections follow Start → Underwaters → Breakout → The swim → The wall → Finish → Numbers`, () => {
      const sections = SCREEN_SECTIONS[slug];
      expect(sections).toBeDefined();
      expect(sections!.map((section) => section.name)).toEqual(RACE_ORDER);
    });
  }

  it("free, breast, fly Start lists the track-start parent only (StartGroupSection renders children)", () => {
    for (const slug of ["freestyle", "breaststroke", "butterfly"] as const) {
      const start = SCREEN_SECTIONS[slug]!.find((section) => section.name === "Start");
      expect(start, `${slug} is missing Start`).toBeDefined();
      expect(start!.slugs).toContain("track-start");
      for (const componentSlug of [
        "track-start-reaction",
        "track-start-acceleration",
        "track-start-height",
        "track-start-distance",
        "track-start-head-arm-hand",
        "track-start-leg-feet",
      ]) {
        expect(
          start!.slugs,
          `${slug} Start should not list ${componentSlug} (would double-render under the parent group)`,
        ).not.toContain(componentSlug);
      }
    }
  });

  it("backstroke Start uses back-start (no track-start)", () => {
    const start = SCREEN_SECTIONS.backstroke!.find((section) => section.name === "Start");
    expect(start!.slugs).toContain("back-start");
    expect(start!.slugs).not.toContain("track-start");
  });

  it("push-off and streamline-in-motion appear in both Start and The wall on free/fly", () => {
    for (const slug of ["freestyle", "butterfly"] as const) {
      const sections = SCREEN_SECTIONS[slug]!;
      const start = sections.find((section) => section.name === "Start");
      const wall = sections.find((section) => section.name === "The wall");
      expect(start!.slugs).toContain("push-off");
      expect(start!.slugs).toContain("streamline-in-motion");
      expect(wall!.slugs).toContain("push-off");
      expect(wall!.slugs).toContain("streamline-in-motion");
    }
  });

  it("backstroke Start lists streamline-in-motion; The wall lists push-off and streamline-in-motion", () => {
    const sections = SCREEN_SECTIONS.backstroke!;
    const start = sections.find((section) => section.name === "Start");
    const wall = sections.find((section) => section.name === "The wall");
    expect(start!.slugs).toContain("streamline-in-motion");
    expect(wall!.slugs).toContain("push-off");
    expect(wall!.slugs).toContain("streamline-in-motion");
  });

  it("breaststroke The wall has only wall-approach and the open turn (no push-off / streamline)", () => {
    const wall = SCREEN_SECTIONS.breaststroke!.find((section) => section.name === "The wall");
    expect(wall!.slugs).toEqual(["wall-approach", "breaststroke-open-turn"]);
  });

  it("relay-start is NOT on any stroke screen — only on the Starts screen", () => {
    for (const slug of ["freestyle", "backstroke", "breaststroke", "butterfly"] as const) {
      const sections = SCREEN_SECTIONS[slug]!;
      for (const section of sections) {
        expect(
          section.slugs,
          `${slug} ${section.name} should not list relay-start`,
        ).not.toContain("relay-start");
      }
    }
    const starts = SCREEN_SECTIONS.starts!.find((section) => section.name === "Starts");
    expect(starts!.slugs).toContain("relay-start");
  });
});

describe("buildSectionGroups — shared skill resolves in every listed section", () => {
  const PUSH_OFF: SkillForRating = {
    id: "push-off-id",
    slug: "push-off",
    name: "Push-off",
    type: "rubric",
    unit: null,
    stroke: null,
    ratedPerSide: false,
    notLegalAllowed: false,
    parentSkillId: null,
    sortOrder: 1,
    faultTags: [],
    descriptors: [],
  };
  const STREAMLINE: SkillForRating = {
    id: "streamline-id",
    slug: "streamline-in-motion",
    name: "Streamline",
    type: "rubric",
    unit: null,
    stroke: null,
    ratedPerSide: false,
    notLegalAllowed: false,
    parentSkillId: null,
    sortOrder: 2,
    faultTags: [],
    descriptors: [],
  };
  const WALL_APPROACH: SkillForRating = {
    id: "wall-approach-id",
    slug: "wall-approach",
    name: "Wall approach",
    type: "rubric",
    unit: null,
    stroke: null,
    ratedPerSide: false,
    notLegalAllowed: false,
    parentSkillId: null,
    sortOrder: 3,
    faultTags: [],
    descriptors: [],
  };

  const CONTAINER = { skills: [PUSH_OFF, STREAMLINE, WALL_APPROACH] };
  const SECTIONS = [
    { name: "Start", slugs: ["push-off", "streamline-in-motion"] },
    { name: "The wall", slugs: ["wall-approach", "push-off", "streamline-in-motion"] },
  ];

  it("places push-off and streamline-in-motion in both Start and The wall", () => {
    const groups = buildSectionGroups(CONTAINER, SECTIONS);
    expect(groups.map((group) => group.name)).toEqual(["Start", "The wall"]);
    expect(groups[0]!.skills.map((skill) => skill.slug)).toEqual([
      "push-off",
      "streamline-in-motion",
    ]);
    expect(groups[1]!.skills.map((skill) => skill.slug)).toEqual([
      "wall-approach",
      "push-off",
      "streamline-in-motion",
    ]);
  });

  it("the shared skill is the SAME SkillForRating object in both sections (one draft entry flows)", () => {
    const groups = buildSectionGroups(CONTAINER, SECTIONS);
    const startPushOff = groups[0]!.skills.find((skill) => skill.slug === "push-off");
    const wallPushOff = groups[1]!.skills.find((skill) => skill.slug === "push-off");
    expect(startPushOff).toBeDefined();
    expect(wallPushOff).toBeDefined();
    expect(startPushOff!.id).toBe(wallPushOff!.id);
  });

  it("buildRatingsArray saves a shared-skill grade exactly once per screen", () => {
    // Even though push-off appears in two sections, buildRatingsArray
    // iterates the flat skill list of the screen — the same SkillForRating
    // object is visited once, so the DB gets exactly one row.
    const draftSkills = {
      [PUSH_OFF.id]: { ...defaultSkillDraft(), grade: 4 as const },
    };
    const ratings = buildRatingsArray([PUSH_OFF, STREAMLINE, WALL_APPROACH], draftSkills);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]!.skillId).toBe(PUSH_OFF.id);
    expect(ratings[0]!.grade).toBe(4);
  });
});

describe("getDisambiguatedLabel", () => {
  function makeSkill(overrides: Partial<SkillForRating>): SkillForRating {
    return {
      id: "id",
      slug: "slug",
      name: "Name",
      type: "rubric",
      unit: null,
      stroke: null,
      ratedPerSide: false,
      notLegalAllowed: false,
      parentSkillId: null,
      sortOrder: 0,
      faultTags: [],
      descriptors: [],
      ...overrides,
    };
  }

  it("returns the plain name when no other skill in scope shares it", () => {
    const breakout = makeSkill({ id: "a", slug: "breakout-free", name: "Breakout", stroke: "free" });
    const udk = makeSkill({
      id: "b",
      slug: "udk-free",
      name: "Underwater dolphin kick",
      stroke: "free",
    });
    expect(getDisambiguatedLabel(breakout, [breakout, udk])).toBe("Breakout");
  });

  it("appends the stroke when another distinct skill in scope shares the name (Starts-screen Breakout)", () => {
    const freeBreakout = makeSkill({ id: "a", slug: "breakout-free", name: "Breakout", stroke: "free" });
    const flyBreakout = makeSkill({ id: "b", slug: "breakout-fly", name: "Breakout", stroke: "fly" });
    expect(getDisambiguatedLabel(freeBreakout, [freeBreakout, flyBreakout])).toBe(
      "Breakout (freestyle)",
    );
    expect(getDisambiguatedLabel(flyBreakout, [freeBreakout, flyBreakout])).toBe(
      "Breakout (butterfly)",
    );
  });

  it("does NOT suffix when the SAME skill id is in scope twice (push-off in Start + The wall)", () => {
    const pushOff = makeSkill({ id: "shared", slug: "push-off", name: "Push-off" });
    expect(getDisambiguatedLabel(pushOff, [pushOff, pushOff])).toBe("Push-off");
  });
});

describe("slugifySectionName", () => {
  it("lowercases, replaces non-alphanumeric with hyphen, trims edges", () => {
    expect(slugifySectionName("The swim")).toBe("the-swim");
    expect(slugifySectionName("Push-off & Streamline")).toBe("push-off-streamline");
    expect(slugifySectionName("Numbers")).toBe("numbers");
  });
});
