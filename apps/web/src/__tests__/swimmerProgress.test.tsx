import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type {
  CoachSwimmerDetail,
  SwimmerProgressResponse,
  CategoriesResponse,
  ScoreHistoryResponse,
  GolfScoreTrendsResponse,
} from "@swim-app/shared";

vi.mock("@/components/SiteNav", () => ({ default: () => <nav /> }));

import SwimmerProgressContent from "../content/SwimmerProgressContent/SwimmerProgressContent";

const SWIMMER_ID = "aaaa0000-0000-0000-0000-000000000001";
const FREE_SKILL_ID = "bbbb0000-0000-0000-0000-000000000001";
const SIDED_SKILL_ID = "dddd0000-0000-0000-0000-000000000001";
const FREE_CAT_ID = "cccc0000-0000-0000-0000-000000000001";
const BREATH_CAT_ID = "cccc0000-0000-0000-0000-000000000002";

const swimmer: CoachSwimmerDetail = {
  id: SWIMMER_ID,
  firstName: "Maya",
  lastName: "Rivera",
  age: 12,
  sex: "female",
  isPublic: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  birthDate: "2012-01-01",
  householdId: "00000000-0000-0000-0000-000000000ff0",
  currentLeagues: [],
  clubs: [],
  memberNames: [],
  members: [],
  homePool: null,
};

const emptyProgress: SwimmerProgressResponse = {
  skills: [],
  startProgress: [],
  headPositionOverall: null,
  coachingPriorities: [],
};

const emptyScoreHistory: ScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  faultTrends: [],
};

// Backfill the progression fields that every ScoreHistoryPoint now carries.
// Tests built before those fields existed only care about the pre-progression
// shape, so defaulting to zeros here keeps those cases byte-identical.
const EMPTY_LEVEL_COUNTS = {
  level1: 0,
  level2: 0,
  level3: 0,
  level4: 0,
  level5: 0,
  notLegal: 0,
  noConcept: 0,
} as const;
function makeScorePoint(overrides: {
  sessionDate: string;
  sessionId: string;
  headPositionOverall: number | null;
  categoryRollups?: ScoreHistoryResponse["points"][number]["categoryRollups"];
  starts?: ScoreHistoryResponse["points"][number]["starts"];
  counts?: ScoreHistoryResponse["points"][number]["counts"];
  totalLevelsGained?: number;
  skillsMastered?: number;
  skillsLearned?: number;
}): ScoreHistoryResponse["points"][number] {
  return {
    sessionDate: overrides.sessionDate,
    sessionId: overrides.sessionId,
    headPositionOverall: overrides.headPositionOverall,
    categoryRollups: overrides.categoryRollups ?? [],
    starts: overrides.starts ?? [],
    counts: overrides.counts ?? { ...EMPTY_LEVEL_COUNTS },
    totalLevelsGained: overrides.totalLevelsGained ?? 0,
    skillsMastered: overrides.skillsMastered ?? 0,
    skillsLearned: overrides.skillsLearned ?? 0,
  };
}
const emptyGolfScore: GolfScoreTrendsResponse = { trends: [] };
const emptyCategories: CategoriesResponse = [];

const NOW_ISO = "2026-10-29T18:00:00.000Z";

function renderPage(overrides: {
  progress?: SwimmerProgressResponse;
  categories?: CategoriesResponse;
  scoreHistory?: ScoreHistoryResponse;
  golfScore?: GolfScoreTrendsResponse;
}) {
  return render(
    <SwimmerProgressContent
      swimmer={swimmer}
      progress={overrides.progress ?? emptyProgress}
      categories={overrides.categories ?? emptyCategories}
      scoreHistory={overrides.scoreHistory ?? emptyScoreHistory}
      golfScore={overrides.golfScore ?? emptyGolfScore}
      nowIso={NOW_ISO}
    />,
  );
}

function makeSkill(options: {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  grade?: 1 | 2 | 3 | 4 | 5 | null;
  notLegal?: boolean;
  noConcept?: boolean;
  ratedPerSide?: boolean;
  currentLeft?: SwimmerProgressResponse["skills"][number]["currentLeft"];
  currentRight?: SwimmerProgressResponse["skills"][number]["currentRight"];
  history?: SwimmerProgressResponse["skills"][number]["history"];
}): SwimmerProgressResponse["skills"][number] {
  const current =
    options.ratedPerSide
      ? null
      : {
          grade: options.grade ?? 3,
          notLegal: options.notLegal ?? false,
          noConcept: options.noConcept ?? false,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
        };
  return {
    skillId: options.id,
    slug: options.slug,
    name: options.name,
    categoryId: options.categoryId,
    categoryName: options.categoryName,
    type: "rubric",
    unit: null,
    ratedPerSide: options.ratedPerSide ?? false,
    parentSkillId: null,
    current,
    currentLeft: options.currentLeft ?? null,
    currentRight: options.currentRight ?? null,
    history: options.history ?? [],
  };
}

function makePoint(options: {
  id: string;
  sessionDate: string;
  grade: 1 | 2 | 3 | 4 | 5 | null;
  faultTags?: string[];
  notLegal?: boolean;
  sessionId?: string;
  edited?: boolean;
  previousValue?: SwimmerProgressResponse["skills"][number]["history"][number]["previousValue"];
}): SwimmerProgressResponse["skills"][number]["history"][number] {
  return {
    id: options.id,
    sessionId: options.sessionId ?? "ssss0000-0000-0000-0000-000000000001",
    grade: options.grade,
    notLegal: options.notLegal ?? false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    edited: options.edited ?? false,
    previousValue: options.previousValue ?? null,
    context: "practice",
    faultTags: options.faultTags ?? [],
    ratedAt: `${options.sessionDate}T18:00:00.000Z`,
    sessionDate: options.sessionDate,
  };
}

describe("SwimmerProgressContent — empty state", () => {
  it("renders the empty-state card and a 'Start first evaluation' CTA", () => {
    renderPage({});
    expect(screen.getByText(/no evaluations recorded yet/i)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /start first evaluation/i });
    expect(cta).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_ID}/evaluate`);
    // No chart sections should render.
    expect(screen.queryByText(/head position overall/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/category snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/skills/i)).not.toBeInTheDocument();
  });
});

describe("SwimmerProgressContent — one-evaluation state", () => {
  it("renders the page with the trend-unlock hint and a single-point hero", () => {
    const progress: SwimmerProgressResponse = {
      ...emptyProgress,
      skills: [
        makeSkill({
          id: FREE_SKILL_ID,
          slug: "free-kick",
          name: "Freestyle Kick",
          categoryId: FREE_CAT_ID,
          categoryName: "Freestyle",
          grade: 3,
          history: [makePoint({ id: "p-only", sessionDate: "2026-10-25", grade: 3 })],
        }),
      ],
    };
    const scoreHistory: ScoreHistoryResponse = {
      points: [
        makeScorePoint({
          sessionDate: "2026-10-25",
          sessionId: "ssss0000-0000-0000-0000-000000000001",
          headPositionOverall: null,
          categoryRollups: [],
          starts: [],
        }),
      ],
      recentChanges: [],
      milestones: [],
      faultTrends: [],
    };
    renderPage({ progress, scoreHistory });
    expect(screen.getAllByText(/head position overall/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/trends unlock after the second rating/i)).toBeInTheDocument();
    // The expandable per-skill row is present.
    expect(screen.getByText("Freestyle Kick")).toBeInTheDocument();
  });
});

describe("SwimmerProgressContent — sections", () => {
  const progress: SwimmerProgressResponse = {
    headPositionOverall: 4,
    coachingPriorities: [
      {
        targetSlug: "free-pull",
        targetName: "Pull",
        chain: [
          { slug: "free-pull", name: "Pull", notAssessed: false },
          { slug: "free-catch", name: "Catch", notAssessed: false },
          { slug: "finger-spacing", name: "Finger spacing", notAssessed: true },
        ],
      },
    ],
    startProgress: [
      {
        slug: "track-start",
        name: "Track Start",
        grade: { status: "graded", grade: 4 },
        components: [],
      },
    ],
    skills: [
      makeSkill({
        id: FREE_SKILL_ID,
        slug: "free-kick",
        name: "Freestyle Kick",
        categoryId: FREE_CAT_ID,
        categoryName: "Freestyle",
        grade: 2,
        notLegal: true,
        history: [
          makePoint({ id: "p1", sessionDate: "2026-10-25", grade: 2, notLegal: true, faultTags: ["dropped elbow"] }),
          makePoint({ id: "p2", sessionDate: "2026-10-18", grade: 3, faultTags: ["dropped elbow", "breaks down 2nd length"] }),
        ],
      }),
      makeSkill({
        id: SIDED_SKILL_ID,
        slug: "free-bilateral-breathing",
        name: "Bilateral breathing",
        categoryId: BREATH_CAT_ID,
        categoryName: "Breathing",
        ratedPerSide: true,
        currentLeft: {
          grade: 3,
          notLegal: false,
          noConcept: false,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
        },
        currentRight: {
          grade: null,
          notLegal: false,
          noConcept: true,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
        },
        history: [
          makePoint({ id: "pL", sessionDate: "2026-10-25", grade: 3 }),
        ],
      }),
    ],
  };
  const scoreHistory: ScoreHistoryResponse = {
    points: [
      makeScorePoint({
        sessionDate: "2026-10-11",
        sessionId: "ssss0000-0000-0000-0000-000000000011",
        headPositionOverall: 3,
        categoryRollups: [
          { categoryId: FREE_CAT_ID, categorySlug: "freestyle", categoryName: "Freestyle", average: 3, assessedCount: 1, totalCount: 10 },
        ],
        starts: [{ slug: "track-start", name: "Track Start", grade: { status: "in_progress", missing: [] } }],
      }),
      makeScorePoint({
        sessionDate: "2026-10-25",
        sessionId: "ssss0000-0000-0000-0000-000000000025",
        headPositionOverall: 4,
        categoryRollups: [
          { categoryId: FREE_CAT_ID, categorySlug: "freestyle", categoryName: "Freestyle", average: 4, assessedCount: 2, totalCount: 10 },
        ],
        starts: [{ slug: "track-start", name: "Track Start", grade: { status: "graded", grade: 4 } }],
      }),
    ],
    recentChanges: [],
    milestones: [],
    faultTrends: [],
  };
  const golfScore: GolfScoreTrendsResponse = {
    trends: [
      {
        skillSlug: "free-golf-score",
        skillName: "Freestyle golf score",
        byCategory: [
          {
            category: "push_off_in_water",
            points: [
              { ratedAt: "2026-10-25T18:00:00.000Z", sessionDate: "2026-10-25", sessionId: "ssss0000-0000-0000-0000-000000000025", grade: 3, measurementValue: "29.5" },
              { ratedAt: "2026-10-11T18:00:00.000Z", sessionDate: "2026-10-11", sessionId: "ssss0000-0000-0000-0000-000000000011", grade: 3, measurementValue: "30.4" },
            ],
            ageBands: { bandCount: 12, p25: 25.0, p50: 28.0, p75: 32.0 },
          },
        ],
      },
    ],
  };

  it("renders every top-level section", () => {
    renderPage({ progress, scoreHistory, golfScore });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Maya.*Progress/);
    expect(screen.getByRole("heading", { name: /what to work on next/i })).toBeInTheDocument();
    expect(screen.getAllByText(/head position overall/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: /category snapshot/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^starts$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^golf score$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /fault tags/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /session cadence/i })).toBeInTheDocument();
    // Per-skill list category label
    expect(screen.getAllByText("Freestyle").length).toBeGreaterThan(0);
  });

  it("spells out 'Not legal' and 'No concept' as pills", () => {
    renderPage({ progress, scoreHistory, golfScore });
    expect(screen.getByText("Not legal")).toBeInTheDocument();
    // Right side is no_concept
    expect(screen.getByText("R No concept")).toBeInTheDocument();
    // Left side is grade 3
    expect(screen.getByText("L 3")).toBeInTheDocument();
  });

  it("renders fault-tag frequency entries (coach only)", () => {
    renderPage({ progress, scoreHistory, golfScore });
    expect(screen.getByText("dropped elbow")).toBeInTheDocument();
    expect(screen.getByText("breaks down 2nd length")).toBeInTheDocument();
  });

  it("evaluate deep links use ?skill=<slug>", () => {
    renderPage({ progress, scoreHistory, golfScore });
    const priorityLink = screen.getAllByRole("link", { name: "Pull" })[0]!;
    expect(priorityLink).toHaveAttribute(
      "href",
      `/coach/swimmers/${SWIMMER_ID}/evaluate?skill=free-pull`,
    );
    // Chain name links too
    const catchLink = screen.getByRole("link", { name: "Catch" });
    expect(catchLink).toHaveAttribute(
      "href",
      `/coach/swimmers/${SWIMMER_ID}/evaluate?skill=free-catch`,
    );
    // The skill row name itself is also a link to the deep eval
    const skillLink = screen.getByRole("link", { name: "Freestyle Kick" });
    expect(skillLink).toHaveAttribute(
      "href",
      `/coach/swimmers/${SWIMMER_ID}/evaluate?skill=free-kick`,
    );
  });

  it("Evaluate top button links to the plain evaluate route", () => {
    renderPage({ progress, scoreHistory, golfScore });
    const btn = screen.getByRole("link", { name: /^evaluate$/i });
    expect(btn).toHaveAttribute("href", `/coach/swimmers/${SWIMMER_ID}/evaluate`);
  });

  it("priority chain entries flagged notAssessed get a '(check this)' hint", () => {
    renderPage({ progress, scoreHistory, golfScore });
    expect(screen.getByText(/finger spacing \(check this\)/i)).toBeInTheDocument();
  });

  it("renders deterministically (hydration-safe): HTML identical across two renders with same props, modulo React useId counters", () => {
    // useId generates incremented identifiers (_r_0_, _r_1_, …) across renders
    // in the same jsdom test, which is irrelevant to hydration (React 19
    // serializes a stable server identifier). Everything else — chart text,
    // dates, aria labels, order — must be byte-identical, or SSR vs.
    // hydration can mismatch.
    const normalizeIds = (html: string): string => html.replace(/_r_[^_]+_/g, "_r_X_");

    const { container: firstContainer, unmount } = render(
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={emptyCategories}
        scoreHistory={scoreHistory}
        golfScore={golfScore}
        nowIso={NOW_ISO}
      />,
    );
    const firstHtml = normalizeIds(firstContainer.innerHTML);
    unmount();

    const { container: secondContainer } = render(
      <SwimmerProgressContent
        swimmer={swimmer}
        progress={progress}
        categories={emptyCategories}
        scoreHistory={scoreHistory}
        golfScore={golfScore}
        nowIso={NOW_ISO}
      />,
    );
    expect(normalizeIds(secondContainer.innerHTML)).toBe(firstHtml);
  });

  it("groups skills under their category in the Skills column", () => {
    renderPage({
      progress,
      scoreHistory,
      golfScore,
      categories: [
        { id: FREE_CAT_ID, slug: "freestyle", name: "Freestyle", sortOrder: 3, skills: [] },
        { id: BREATH_CAT_ID, slug: "breathing", name: "Breathing", sortOrder: 2, skills: [] },
      ],
    });
    // Both categories appear as disclosure headers in the Skills column
    const skillsHeading = screen.getByRole("heading", { name: /^skills$/i });
    const skillsSection = skillsHeading.parentElement as HTMLElement;
    expect(within(skillsSection).getByText("Freestyle")).toBeInTheDocument();
    expect(within(skillsSection).getByText("Breathing")).toBeInTheDocument();
  });
});

// ── Edit affordances (ADR 032) ────────────────────────────────────────────────

describe("SwimmerProgressContent — Edit affordances (ADR 032)", () => {
  const SESSION_A = "ssss0000-0000-0000-0000-00000000a001";
  const SESSION_B = "ssss0000-0000-0000-0000-00000000a002";

  const historyWithEdit = [
    makePoint({
      id: "p-latest",
      sessionDate: "2026-10-25",
      grade: 4,
      sessionId: SESSION_B,
      edited: true,
      previousValue: 2,
    }),
    makePoint({
      id: "p-prev",
      sessionDate: "2026-10-11",
      grade: 2,
      sessionId: SESSION_A,
    }),
  ];

  const progress: SwimmerProgressResponse = {
    ...emptyProgress,
    headPositionOverall: 4,
    skills: [
      makeSkill({
        id: FREE_SKILL_ID,
        slug: "free-kick",
        name: "Freestyle Kick",
        categoryId: FREE_CAT_ID,
        categoryName: "Freestyle",
        grade: 4,
        history: historyWithEdit,
      }),
    ],
  };

  const scoreHistory: ScoreHistoryResponse = {
    points: [
      makeScorePoint({
        sessionDate: "2026-10-11",
        sessionId: SESSION_A,
        headPositionOverall: 2,
      }),
      makeScorePoint({
        sessionDate: "2026-10-25",
        sessionId: SESSION_B,
        headPositionOverall: 4,
      }),
    ],
    recentChanges: [],
    milestones: [],
    faultTrends: [],
  };

  it("hero chart renders an Edit link for the selected point with a sanitized returnTo", () => {
    renderPage({ progress, scoreHistory });
    // Simulate selecting the latest head-position point by clicking its
    // enlarged hitbox. The tooltip-driven detail line is unselected by default.
    const hitboxes = document.querySelectorAll("circle[pointer-events='all']");
    expect(hitboxes.length).toBeGreaterThan(0);
    fireEvent.pointerDown(hitboxes[hitboxes.length - 1]!);
    const link = screen.getByTestId("hero-trend-edit-link");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain(`/coach/swimmers/${SWIMMER_ID}/evaluate`);
    expect(href).toContain(`editSession=${SESSION_B}`);
    expect(href).toContain(`returnTo=${encodeURIComponent(`/coach/swimmers/${SWIMMER_ID}/progress`)}`);
  });

  it("SkillChart renders hollow-ring points for edited history rows", () => {
    renderPage({ progress, scoreHistory });
    // Expand the skill row so the sparkline + edit list render.
    fireEvent.click(screen.getByRole("button", { name: /expand freestyle kick/i }));
    const edited = screen.getAllByTestId("skill-chart-edited-point");
    expect(edited.length).toBeGreaterThan(0);
  });

  it("SkillChart sr-only table annotates edited rows with '(edited, was N)'", () => {
    renderPage({ progress, scoreHistory });
    fireEvent.click(screen.getByRole("button", { name: /expand freestyle kick/i }));
    expect(screen.getByText(/4 \(edited, was 2\)/)).toBeInTheDocument();
  });

  it("SkillChart renders per-point Edit links that deep-link to editSession + skill slug", () => {
    renderPage({ progress, scoreHistory });
    fireEvent.click(screen.getByRole("button", { name: /expand freestyle kick/i }));
    const links = screen.getAllByTestId("skill-chart-edit-link");
    expect(links.length).toBe(historyWithEdit.length);
    const hrefs = links.map((anchor) => anchor.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href.includes(`editSession=${SESSION_A}`))).toBe(true);
    expect(hrefs.some((href) => href.includes(`editSession=${SESSION_B}`))).toBe(true);
    for (const href of hrefs) {
      expect(href).toContain("skill=free-kick");
      expect(href).toContain(`returnTo=${encodeURIComponent(`/coach/swimmers/${SWIMMER_ID}/progress`)}`);
    }
  });
});
