// Static token-pair check for the rebuilt parent progress sections.
// Every inline background/text pair must sit in the light-safe space
// (never --color-card / --color-section on a surface, never on-section
// text on a light surface) — this test fired the coach-Starts regression
// into the open when the Starts card shipped with var(--color-card).
//
// JSDOM preserves CSS var() references in `style` attributes verbatim
// (it can't resolve custom-property values), which is useful here: we
// assert the token name, not a resolved hex.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  ParentProgressRatingPoint,
  ParentSkillProgress,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  SkillCurrentLevel,
} from "@swim-app/shared";
import ParentSwimmerProgressContent from "../content/ParentSwimmerProgressContent/ParentSwimmerProgressContent";

// Mock heavy render-only dependencies that would drag SVG + motion into
// this test — the tokens we care about are on the parent sections and
// their immediate wrappers, not on the shared ladder internals.
import { vi } from "vitest";
vi.mock("@/components/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/LevelLadder", () => ({ default: () => null }));
vi.mock("@/components/StartsSection", () => ({ default: () => null }));
// The radar provides its own light-surface background on its SVG root,
// so the test mock needs to emit a node carrying that token — otherwise
// the snapshot section has nothing to inspect.
vi.mock("@/content/SwimmerProgressContent/charts/CategoryRadar", () => ({
  default: () => (
    <div data-testid="category-radar-mock" style={{ backgroundColor: "var(--color-surface-soft)" }} />
  ),
}));

const LIGHT_SURFACE_TOKENS = new Set(["--color-background", "--color-surface-soft"]);
const DARK_SURFACE_TOKENS = new Set(["--color-card", "--color-section", "--color-ink"]);

function readStyleToken(element: Element, cssProp: string): string | null {
  const style = element.getAttribute("style") ?? "";
  const regex = new RegExp(`(?:^|;\\s*)${cssProp}:\\s*var\\((--color-[\\w-]+)\\)`);
  const match = style.match(regex);
  return match?.[1] ?? null;
}

// ── Fixture ──────────────────────────────────────────────────────────────

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const SKILL_ID = "bbbb0000-0000-0000-0000-000000000001";
const CAT_ID = "cccc0000-0000-0000-0000-000000000001";

const swimmer: ParentSwimmer = {
  id: SWIMMER_ID,
  firstName: "Maya",
  lastName: "Rivera",
  birthDate: "2012-01-01",
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  clubs: [],
  currentLeagues: [],
};

function level(grade: 1 | 2 | 3 | 4 | 5 | null): SkillCurrentLevel {
  return {
    grade,
    notLegal: false,
    noConcept: false,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
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

const skill: ParentSkillProgress = {
  skillId: SKILL_ID,
  slug: "free-kick",
  name: "Freestyle Kick",
  categoryId: CAT_ID,
  categoryName: "Freestyle",
  type: "rubric",
  unit: null,
  ratedPerSide: false,
  parentSkillId: null,
  current: level(4),
  currentLeft: null,
  currentRight: null,
  history: [point("p3", "2026-11-10", 4), point("p2", "2026-10-28", 3), point("p1", "2026-10-14", 2)],
};

const progress: ParentSwimmerProgressResponse = {
  skills: [skill],
  startProgress: [],
  headPositionOverall: 3,
  coachingPriorities: [{ targetSlug: "free-pull", targetName: "Pull", chain: [] }],
  latestCoachingPriority: { text: "Rotate the hips more on each stroke", sessionDate: "2026-11-10", coachFirstName: null },
  latestCoachingNotes: [],
};

describe("ParentSwimmerProgressContent — token pair contrast", () => {
  it("summary card uses a light surface + light-safe text", () => {
    render(<ParentSwimmerProgressContent swimmer={swimmer} progress={progress} categories={[]} />);
    const card = screen.getByTestId("parent-progress-summary-card");
    const bg = readStyleToken(card, "background-color");
    expect(bg && DARK_SURFACE_TOKENS.has(bg), `summary card uses dark surface token ${bg}`).toBe(false);
    expect(bg && LIGHT_SURFACE_TOKENS.has(bg)).toBe(true);
  });

  it("Coach's note card uses a light surface", () => {
    render(<ParentSwimmerProgressContent swimmer={swimmer} progress={progress} categories={[]} />);
    const note = screen.getByTestId("parent-coach-focus-note");
    const bg = readStyleToken(note, "background-color");
    expect(bg && DARK_SURFACE_TOKENS.has(bg), `coach note uses dark surface token ${bg}`).toBe(false);
    expect(bg && LIGHT_SURFACE_TOKENS.has(bg)).toBe(true);
  });

  it("Recent wins card uses a light surface", () => {
    render(<ParentSwimmerProgressContent swimmer={swimmer} progress={progress} categories={[]} />);
    const section = screen.getByTestId("parent-progress-recent-wins");
    const card = section.querySelector('[style*="background-color"]');
    expect(card).not.toBeNull();
    const bg = readStyleToken(card as Element, "background-color");
    expect(bg && DARK_SURFACE_TOKENS.has(bg)).toBe(false);
    expect(bg && LIGHT_SURFACE_TOKENS.has(bg)).toBe(true);
  });

  it("Snapshot card uses a light surface", () => {
    // Need scoreHistory with some rollups so the snapshot section renders.
    const scoreHistory = {
      points: [
        {
          sessionDate: "2026-11-10",
          headPositionOverall: 3,
          categoryRollups: [{ categoryId: CAT_ID, categorySlug: "freestyle", categoryName: "Freestyle", average: 3, assessedCount: 1, totalCount: 1 }],
          screenGroupRollups: [{ screenSlug: "freestyle" as const, name: "Freestyle", average: 3, assessedCount: 1, totalCount: 1 }],
          starts: [],
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
    render(
      <ParentSwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={[]}
        scoreHistory={scoreHistory}
      />,
    );
    const snapshot = screen.getByTestId("parent-progress-snapshot");
    // The snapshot section itself has no card wrapper — the radar SVG
    // inside carries the light-surface background so it reads as a card
    // without being nested inside another one.
    const surfaceNode = snapshot.querySelector('[style*="background-color"]');
    expect(surfaceNode).not.toBeNull();
    const bg = readStyleToken(surfaceNode as Element, "background-color");
    expect(bg && DARK_SURFACE_TOKENS.has(bg)).toBe(false);
    expect(bg && LIGHT_SURFACE_TOKENS.has(bg)).toBe(true);
  });
});
