// Layout-structure tests for the single-tree parent progress page.
// The grid root uses grid-template-areas per breakpoint; JSDOM
// doesn't apply media queries, so the strategy is structural:
// assert that each section lives inside a slot tagged with the
// expected grid-area via `[grid-area:name]` className, and that
// every element id in the rendered tree is unique.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  ParentProgressRatingPoint,
  ParentSkillProgress,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ProgressCoachingPriority,
  SkillCurrentLevel,
} from "@swim-app/shared";
import ParentSwimmerProgressContent from "../content/ParentSwimmerProgressContent/ParentSwimmerProgressContent";

vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/LevelLadder", () => ({ default: () => null }));
vi.mock("@/components/StartsSection", () => ({ default: () => null }));
vi.mock("@/content/SwimmerProgressContent/charts/CategoryRadar", () => ({ default: () => null }));

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const CAT_ID = "cccc0000-0000-0000-0000-000000000001";

const swimmer: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: "Lily",
  lastName: "Carbajal",
  birthDate: "2012-01-01",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

function level(grade: 1 | 2 | 3 | 4 | 5 | null, overrides: Partial<SkillCurrentLevel> = {}): SkillCurrentLevel {
  return {
    grade,
    notLegal: overrides.notLegal ?? false,
    noConcept: overrides.noConcept ?? false,
    capacityValue: overrides.capacityValue ?? null,
    capacityUnit: overrides.capacityUnit ?? null,
    measurementValue: overrides.measurementValue ?? null,
    measurementUnit: overrides.measurementUnit ?? null,
  };
}

function point(id: string, sessionDate: string, grade: 1 | 2 | 3 | 4 | 5): ParentProgressRatingPoint {
  return {
    id,
    sessionId: `sess-${id}`,
    sessionDate,
    ratedAt: `${sessionDate}T18:00:00.000Z`,
    grade,
    notLegal: false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    context: "practice",
    edited: false,
    previousValue: null,
  };
}

function skill(options: { slug: string; name: string; current?: SkillCurrentLevel | null; history?: ParentProgressRatingPoint[] }): ParentSkillProgress {
  return {
    skillId: `${options.slug}-id`,
    slug: options.slug,
    name: options.name,
    categoryId: CAT_ID,
    categoryName: "Freestyle",
    type: "rubric",
    unit: null,
    ratedPerSide: false,
    parentSkillId: null,
    current: options.current ?? null,
    currentLeft: null,
    currentRight: null,
    history: options.history ?? [],
  };
}

function priority(slug: string, name: string): ProgressCoachingPriority {
  return { targetSlug: slug, targetName: name, chain: [] };
}

const baseProgress: ParentSwimmerProgressResponse = {
  skills: [
    skill({
      slug: "free-kick",
      name: "Kick",
      current: level(4),
      history: [point("k4", "2026-11-10", 4), point("k2", "2026-09-30", 2)],
    }),
  ],
  startProgress: [
    {
      slug: "track-start",
      name: "Track start",
      grade: { status: "graded", grade: 3 },
      components: [{ slug: "track-start-reaction", name: "Reaction", current: level(3) }],
    },
  ],
  headPositionOverall: 3,
  coachingPriorities: [priority("free-pull", "Pull"), priority("free-catch", "Catch"), priority("free-head-position", "Head position")],
  latestCoachingPriority: { text: "Rotate the hips more on each stroke", sessionDate: "2026-11-10", coachName: "Jason" },
  latestCoachingNotes: [],
};

const baseScoreHistory = {
  points: [
    {
      sessionDate: "2026-11-10",
      headPositionOverall: 3,
      categoryRollups: [],
      screenGroupRollups: [{ screenSlug: "freestyle" as const, name: "Freestyle", average: 3, assessedCount: 1, totalCount: 1 }],
      starts: [{ slug: "track-start", name: "Track start", grade: { status: "graded" as const, grade: 3 as const } }],
      counts: { level1: 0, level2: 0, level3: 1, level4: 0, level5: 0, notLegal: 0, noConcept: 0 },
      totalLevelsGained: 0,
      skillsMastered: 0,
      skillsLearned: 0,
    },
  ],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

// ── Single-tree structure ────────────────────────────────────────────────

describe("ParentSwimmerProgressContent — single-tree layout", () => {
  it("renders exactly one layout root", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    expect(screen.getAllByTestId("parent-progress-layout")).toHaveLength(1);
  });

  it("each section mounts exactly once — no duplicate mobile/desktop subtrees", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    // Testids from each section component appear once in the rendered tree.
    expect(screen.getAllByTestId("parent-progress-summary-card")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-recent-wins")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-coach-focus-note")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-focus")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-snapshot")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-starts")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-skills")).toHaveLength(1);
  });

  it("each section lives inside the grid area that matches its name", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    // Grid slot wrappers: summary, wins, note each wrap their section;
    // focus/snapshot/starts/skills each are the sections themselves
    // tagged with `[grid-area:*]`.
    const assertGridArea = (element: Element, area: string) => {
      // The arbitrary-value class contains the grid-area name.
      expect(element.className).toMatch(new RegExp(`\\[grid-area:${area}\\]`));
    };
    // Each section's grid cell is either the section or its wrapper div.
    assertGridArea(screen.getByTestId("parent-progress-summary-card").parentElement!, "summary");
    assertGridArea(screen.getByTestId("parent-progress-recent-wins").parentElement!, "wins");
    assertGridArea(screen.getByTestId("parent-coach-focus-note").parentElement!, "note");
    assertGridArea(screen.getByTestId("parent-progress-focus"), "focus");
    assertGridArea(screen.getByTestId("parent-progress-snapshot"), "snapshot");
    assertGridArea(screen.getByTestId("parent-progress-starts"), "starts");
    assertGridArea(screen.getByTestId("parent-progress-skills"), "skills");
  });

  it("every id in the rendered tree is unique", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    const nodes = document.querySelectorAll("[id]");
    const ids: string[] = [];
    for (const node of nodes) {
      const id = node.getAttribute("id");
      if (id !== null && id.length > 0) ids.push(id);
    }
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(id);
      else seen.add(id);
    }
    expect(duplicates, `duplicate ids found: ${duplicates.join(", ")}`).toEqual([]);
  });
});

// ── Focus cards row ──────────────────────────────────────────────────────

describe("ParentSwimmerProgressContent — focus cards share a row", () => {
  function render3(priorities: ProgressCoachingPriority[]) {
    const progress = { ...baseProgress, coachingPriorities: priorities };
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
  }

  it("with 1 priority: card-count=1 — the single card fills its row", () => {
    render3([priority("a", "A")]);
    const list = screen.getByTestId("parent-coach-focus-list");
    expect(list.getAttribute("data-card-count")).toBe("1");
  });

  it("with 2 priorities: card-count=2 — row splits 50/50, no third-column gap", () => {
    render3([priority("a", "A"), priority("b", "B")]);
    const list = screen.getByTestId("parent-coach-focus-list");
    expect(list.getAttribute("data-card-count")).toBe("2");
  });

  it("with 3 priorities: card-count=3 — never a 2+1 wrap", () => {
    render3([priority("a", "A"), priority("b", "B"), priority("c", "C")]);
    const list = screen.getByTestId("parent-coach-focus-list");
    expect(list.getAttribute("data-card-count")).toBe("3");
  });
});
