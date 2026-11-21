// Layout tests for the rebuilt parent progress page. The page is a
// single flat column of sections — no breakpoint-cloned subtrees. JSDOM
// doesn't apply media queries, so the strategy is structural:
//
//   - exactly one section node for each section testid
//   - section order (top-to-bottom) matches the coach mock
//   - every element id in the rendered tree is unique
//   - no removed-variant markers linger (compact starts tiles, compact
//     golf list, short radar labels)

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
  latestCoachingPriority: { text: "Rotate the hips more on each stroke", sessionDate: "2026-11-10", coachFirstName: "Jason" },
  latestCoachingNotes: [],
};

const baseScoreHistory = {
  points: [
    {
      sessionDate: "2026-09-30",
      headPositionOverall: 2,
      categoryRollups: [],
      screenGroupRollups: [{ screenSlug: "freestyle" as const, name: "Freestyle", average: 2, assessedCount: 1, totalCount: 2 }],
      starts: [],
      counts: { level1: 0, level2: 1, level3: 0, level4: 0, level5: 0, notLegal: 0, noConcept: 0 },
      totalLevelsGained: 0,
      skillsMastered: 0,
      skillsLearned: 1,
    },
    {
      sessionDate: "2026-11-10",
      headPositionOverall: 3,
      categoryRollups: [],
      screenGroupRollups: [{ screenSlug: "freestyle" as const, name: "Freestyle", average: 3, assessedCount: 1, totalCount: 2 }],
      starts: [{ slug: "track-start", name: "Track start", grade: { status: "graded" as const, grade: 3 as const } }],
      counts: { level1: 0, level2: 0, level3: 1, level4: 0, level5: 0, notLegal: 0, noConcept: 0 },
      totalLevelsGained: 1,
      skillsMastered: 0,
      skillsLearned: 1,
    },
  ],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

// ── Single-tree structure ────────────────────────────────────────────────

describe("ParentSwimmerProgressContent — single tree", () => {
  it("renders exactly one layout root and one node per section", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    expect(screen.getAllByTestId("parent-progress-layout")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-summary-card")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-recent-wins")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-coach-focus-note")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-focus")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-snapshot")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-group-standings")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-skills")).toHaveLength(1);
    expect(screen.getAllByTestId("parent-progress-starts")).toHaveLength(1);
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
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const node of nodes) {
      const id = node.getAttribute("id");
      if (id === null || id.length === 0) continue;
      if (seen.has(id)) duplicates.push(id);
      else seen.add(id);
    }
    expect(duplicates, `duplicate ids found: ${duplicates.join(", ")}`).toEqual([]);
  });

  it("sections appear top-to-bottom in the order from the coach mock", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    const orderedTestIds = [
      "parent-progress-summary-card",
      "parent-progress-recent-wins",
      "parent-coach-focus-note",
      "parent-progress-focus",
      "parent-progress-snapshot",
      "parent-progress-group-standings",
      "parent-progress-skills",
      "parent-progress-starts",
    ];
    const layout = screen.getByTestId("parent-progress-layout");
    const positions = orderedTestIds.map((testid) => {
      const node = layout.querySelector(`[data-testid="${testid}"]`);
      expect(node, `missing ${testid}`).not.toBeNull();
      // compareDocumentPosition ordering: iterate all candidates in DOM
      // order and pick the first matching testid for stable comparison.
      return positionIn(layout, node!);
    });
    for (let index = 1; index < positions.length; index += 1) {
      expect(
        positions[index]! > positions[index - 1]!,
        `${orderedTestIds[index]} should come after ${orderedTestIds[index - 1]}`,
      ).toBe(true);
    }
  });

  it("no side-column artifacts linger (compact starts / compact golf / short radar labels)", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    expect(screen.queryByTestId("start-stat-tiles-compact")).toBeNull();
    expect(screen.queryByTestId("parent-golf-score-compact-list")).toBeNull();
    // Radar renders FULL labels only (no short label variant).
    const shortVariant = document.querySelector('[data-variant="short"]');
    expect(shortVariant).toBeNull();
  });
});

describe("ParentSwimmerProgressContent — Snapshot / Group standings row", () => {
  it("is a named @container/progress so inner rows can query the content width", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    const layout = screen.getByTestId("parent-progress-layout");
    expect(layout.className).toContain("@container/progress");
  });

  it("switches from stacked to two columns only when the container is at least 864px (2×420 + 24 gap)", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    const row = document.querySelector('[data-testid="parent-progress-group-row"]');
    expect(row).not.toBeNull();
    const className = (row as HTMLElement).className;
    expect(className).toContain("grid-cols-1");
    expect(className).toContain("@min-[864px]/progress:grid-cols-2");
    // The Snapshot column renders first so stacked order is Snapshot above WhereSheStands.
    const snapshot = (row as HTMLElement).querySelector('[data-testid="parent-progress-snapshot"]');
    const where = (row as HTMLElement).querySelector('[data-testid="parent-progress-group-standings"]');
    expect(snapshot).not.toBeNull();
    expect(where).not.toBeNull();
    const position = snapshot!.compareDocumentPosition(where!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("each column in the row sets min-w-0 so a wide child can't stretch the row past its container", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
      />,
    );
    const row = document.querySelector('[data-testid="parent-progress-group-row"]')!;
    const children = Array.from(row.children) as HTMLElement[];
    expect(children.length).toBe(2);
    for (const child of children) {
      expect(child.className, `row child missing min-w-0: ${child.className}`).toContain("min-w-0");
    }
  });
});

describe("ParentSwimmerProgressContent — golf visibility", () => {
  it("hides the entire golf section (heading included) when no trends have scored points", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
        // No golfScore prop → defaults to empty trends array
      />,
    );
    expect(screen.queryByTestId("parent-progress-golf")).toBeNull();
    expect(screen.queryByText("Golf score")).toBeNull();
  });

  it("renders the golf section when at least one trend has a scored point", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
        golfScore={{
          trends: [
            {
              skillSlug: "free-golf-score",
              skillName: "Freestyle golf score",
              byCategory: [
                {
                  category: "push_off_in_water",
                  ageBands: null,
                  points: [
                    {
                      ratedAt: "2026-11-10T18:00:00.000Z",
                      sessionDate: "2026-11-10",
                      grade: 3,
                      timeSeconds: 14,
                      strokeCountValue: 22,
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("parent-progress-golf")).toBeInTheDocument();
    expect(screen.getByText("Golf score")).toBeInTheDocument();
  });

  it("hides the golf section when the only points are partial (time or strokes missing)", () => {
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={baseProgress}
        categories={[]}
        scoreHistory={baseScoreHistory}
        golfScore={{
          trends: [
            {
              skillSlug: "free-golf-score",
              skillName: "Freestyle golf score",
              byCategory: [
                {
                  category: "push_off_in_water",
                  ageBands: null,
                  points: [
                    {
                      ratedAt: "2026-11-10T18:00:00.000Z",
                      sessionDate: "2026-11-10",
                      grade: 3,
                      timeSeconds: 14,
                      strokeCountValue: null,
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.queryByTestId("parent-progress-golf")).toBeNull();
  });
});

// Walk `layout` in document order and return the index of `target`.
// Lets the order test compare positions of nested nodes across branches.
function positionIn(layout: Element, target: Element): number {
  const walker = document.createTreeWalker(layout, NodeFilter.SHOW_ELEMENT);
  let index = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === target) return index;
    index += 1;
    node = walker.nextNode();
  }
  return -1;
}
