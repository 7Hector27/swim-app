// Covers the full-width Starts section on the coach progress page:
// tab-status vocabulary for each state, dive-arc geometry for the block-
// and wall-based start kinds, stat-tile change text across first-only /
// faster / slower / farther cases, the session grid rendering gaps,
// and the per-start empty state.

import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type {
  ProgressRatingPoint,
  StartComponentProgress,
  StartProgress,
} from "@swim-app/shared";
import StartsSection from "../content/SwimmerProgressContent/StartsSection";
import StartDiveCard from "../content/SwimmerProgressContent/StartsSection/StartDiveCard";
import {
  bezierPoint,
  BLOCK_ARC_CONTROL,
  BLOCK_ARC_END,
  BLOCK_ARC_START,
  buildDiveArcPlot,
  buildSessionGridLookup,
  diveArcPath,
  distanceLineEndX,
  firstMeasurement,
  isDistanceComponent,
  latestMeasurement,
  measurementChangeText,
  pickInitialStartSlug,
  recentSessionDatesForStart,
  shortUnit,
  startComponentHistoryMap,
  tabStatusLabel,
  WALL_ARC_CONTROL,
  WALL_ARC_END,
  WALL_ARC_START,
} from "../content/SwimmerProgressContent/StartsSection/helpers";

// ── Fixtures ──────────────────────────────────────────────────────────────

function component(overrides: Partial<StartComponentProgress> & { slug: string; name: string }): StartComponentProgress {
  return {
    slug: overrides.slug,
    name: overrides.name,
    current: overrides.current ?? null,
  };
}

function trackStart(options: {
  grade: StartProgress["grade"];
  components: StartComponentProgress[];
}): StartProgress {
  return { slug: "track-start", name: "Track start", grade: options.grade, components: options.components };
}

function backStart(options: {
  grade: StartProgress["grade"];
  components: StartComponentProgress[];
}): StartProgress {
  return { slug: "back-start", name: "Backstroke start", grade: options.grade, components: options.components };
}

function relayStart(options: {
  grade: StartProgress["grade"];
  components: StartComponentProgress[];
}): StartProgress {
  return { slug: "relay-start", name: "Relay start", grade: options.grade, components: options.components };
}

const trackComponents: StartComponentProgress[] = [
  component({
    slug: "track-start-reaction",
    name: "Reaction",
    current: {
      grade: 3,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "0.82",
      measurementUnit: "seconds",
    },
  }),
  component({
    slug: "track-start-acceleration",
    name: "Acceleration",
    current: {
      grade: 2,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
    },
  }),
  component({
    slug: "track-start-height",
    name: "Height",
    current: {
      grade: 3,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
    },
  }),
  component({
    slug: "track-start-distance",
    name: "Distance",
    current: {
      grade: 2,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "7",
      measurementUnit: "feet",
    },
  }),
  component({ slug: "track-start-leg-feet", name: "Legs and feet" }),
  component({ slug: "track-start-head-arm-hand", name: "Head, arms, hands" }),
];

const backComponents: StartComponentProgress[] = [
  component({
    slug: "back-start-reaction",
    name: "Reaction",
    current: {
      grade: 2,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "0.9",
      measurementUnit: "seconds",
    },
  }),
  component({
    slug: "back-start-push",
    name: "Push",
    current: {
      grade: 2,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
    },
  }),
  component({
    slug: "back-start-arch",
    name: "Arch",
    current: {
      grade: 2,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
    },
  }),
  component({
    slug: "back-start-distance",
    name: "Distance",
    current: {
      grade: 2,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "5",
      measurementUnit: "feet",
    },
  }),
  component({ slug: "back-start-entry-alignment", name: "Entry alignment" }),
  // Backstroke start has 5 active catalog components per the Oct 14
  // decisions doc — "Streamline off the wall" was archived (now covered by
  // the shared Streamline skill) and is filtered out of
  // SwimmerProgressResponse.startProgress[].components by the API
  // (progressCalculation.ts: .where(isNull(skills.archivedAt))), so no
  // archived slug ever reaches the UI.
];

const relayNothing = relayStart({
  grade: { status: "in_progress", missing: ["relay-start-reaction"] },
  components: [component({ slug: "relay-start-reaction", name: "Reaction" })],
});

function point(overrides: Partial<ProgressRatingPoint> & { id: string; sessionDate: string }): ProgressRatingPoint {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? `sess-${overrides.id}`,
    sessionDate: overrides.sessionDate,
    ratedAt: `${overrides.sessionDate}T18:00:00.000Z`,
    grade: overrides.grade ?? 3,
    notLegal: overrides.notLegal ?? false,
    noConcept: overrides.noConcept ?? false,
    side: overrides.side ?? null,
    capacityValue: overrides.capacityValue ?? null,
    capacityUnit: overrides.capacityUnit ?? null,
    measurementValue: overrides.measurementValue ?? null,
    measurementUnit: overrides.measurementUnit ?? null,
    context: overrides.context ?? "practice",
    faultTags: overrides.faultTags ?? [],
    edited: overrides.edited ?? false,
    previousValue: overrides.previousValue ?? null,
  };
}

// ── Tab status ────────────────────────────────────────────────────────────

describe("StartsSection helpers — tabStatusLabel", () => {
  it("returns 'Grade N' when the start has a calculated grade", () => {
    expect(tabStatusLabel(trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents }))).toBe("Grade 3");
  });

  it("returns 'Not legal' when the start is DQ'd", () => {
    expect(tabStatusLabel(trackStart({ grade: { status: "not_legal" }, components: trackComponents }))).toBe("Not legal");
  });

  it("returns 'No concept' when the start is NC'd", () => {
    expect(tabStatusLabel(trackStart({ grade: { status: "no_concept" }, components: trackComponents }))).toBe("No concept");
  });

  it("returns 'Not started' when in_progress and no component has been rated", () => {
    expect(tabStatusLabel(relayNothing)).toBe("Not started");
  });

  it("returns 'N of M' when in_progress and at least one component is rated", () => {
    // trackComponents has 4 out of 6 rated (reaction, acceleration, height, distance);
    // legs-feet and head-arm-hand are not rated.
    expect(
      tabStatusLabel(
        trackStart({ grade: { status: "in_progress", missing: ["track-start-leg-feet", "track-start-head-arm-hand"] }, components: trackComponents }),
      ),
    ).toBe("4 of 6");
  });
});

describe("StartsSection helpers — pickInitialStartSlug", () => {
  it("picks the first start with any graded component", () => {
    const notStartedTrack = trackStart({
      grade: { status: "in_progress", missing: ["track-start-reaction"] },
      components: [component({ slug: "track-start-reaction", name: "Reaction" })],
    });
    const gradedBack = backStart({ grade: { status: "graded", grade: 2 }, components: backComponents });
    expect(pickInitialStartSlug([notStartedTrack, gradedBack])).toBe("back-start");
  });

  it("falls back to the first start when none have any graded component", () => {
    const notStartedTrack = trackStart({
      grade: { status: "in_progress", missing: ["track-start-reaction"] },
      components: [component({ slug: "track-start-reaction", name: "Reaction" })],
    });
    expect(pickInitialStartSlug([notStartedTrack, relayNothing])).toBe("track-start");
  });

  it("returns null when there are no starts", () => {
    expect(pickInitialStartSlug([])).toBeNull();
  });
});

// ── Arc geometry ──────────────────────────────────────────────────────────

describe("StartsSection helpers — bezierPoint", () => {
  it("returns the start point at t=0 and the end point at t=1", () => {
    expect(bezierPoint(BLOCK_ARC_START, BLOCK_ARC_CONTROL, BLOCK_ARC_END, 0)).toEqual(BLOCK_ARC_START);
    expect(bezierPoint(BLOCK_ARC_START, BLOCK_ARC_CONTROL, BLOCK_ARC_END, 1)).toEqual(BLOCK_ARC_END);
  });

  it("is monotonic in x along both block and wall arcs", () => {
    const blockXs = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => bezierPoint(BLOCK_ARC_START, BLOCK_ARC_CONTROL, BLOCK_ARC_END, t).x);
    for (let index = 1; index < blockXs.length; index += 1) {
      expect(blockXs[index]!).toBeGreaterThan(blockXs[index - 1]!);
    }
    const wallXs = [0, 0.25, 0.5, 0.75, 1].map((t) => bezierPoint(WALL_ARC_START, WALL_ARC_CONTROL, WALL_ARC_END, t).x);
    for (let index = 1; index < wallXs.length; index += 1) {
      expect(wallXs[index]!).toBeGreaterThan(wallXs[index - 1]!);
    }
  });
});

describe("StartsSection helpers — diveArcPath", () => {
  it("builds a quadratic Bezier string using the block anchors", () => {
    expect(diveArcPath("block")).toBe(
      `M${BLOCK_ARC_START.x} ${BLOCK_ARC_START.y} Q ${BLOCK_ARC_CONTROL.x} ${BLOCK_ARC_CONTROL.y} ${BLOCK_ARC_END.x} ${BLOCK_ARC_END.y}`,
    );
  });

  it("builds a different path for wall-based starts", () => {
    expect(diveArcPath("wall")).toBe(
      `M${WALL_ARC_START.x} ${WALL_ARC_START.y} Q ${WALL_ARC_CONTROL.x} ${WALL_ARC_CONTROL.y} ${WALL_ARC_END.x} ${WALL_ARC_END.y}`,
    );
  });
});

describe("StartsSection helpers — isDistanceComponent", () => {
  it("recognizes distance components across all three starts", () => {
    expect(isDistanceComponent("track-start-distance")).toBe(true);
    expect(isDistanceComponent("back-start-distance")).toBe(true);
    expect(isDistanceComponent("relay-start-distance")).toBe(true);
  });

  it("returns false for non-distance slugs", () => {
    expect(isDistanceComponent("track-start-reaction")).toBe(false);
    expect(isDistanceComponent("back-start-streamline")).toBe(false);
  });
});

describe("StartsSection helpers — buildDiveArcPlot", () => {
  it("track start: 5 non-distance dots on the block arc plus a distance drawing", () => {
    const plot = buildDiveArcPlot(trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents }));
    expect(plot.kind).toBe("block");
    expect(plot.dots).toHaveLength(5);
    expect(plot.dots.map((dot) => dot.slug)).toEqual([
      "track-start-reaction",
      "track-start-acceleration",
      "track-start-height",
      "track-start-leg-feet",
      "track-start-head-arm-hand",
    ]);
    // Reaction sits at t=0 (the block edge), head-arm-hand at t=1 (the water).
    expect(plot.dots[0]?.x).toBe(BLOCK_ARC_START.x);
    expect(plot.dots[0]?.y).toBe(BLOCK_ARC_START.y);
    expect(plot.dots[4]?.x).toBe(BLOCK_ARC_END.x);
    expect(plot.dots[4]?.y).toBe(BLOCK_ARC_END.y);
    expect(plot.distance?.valueFeet).toBe(7);
    expect(plot.distance?.valueLabel).toBe("7 ft");
  });

  it("backstroke start: dots land on the wall arc", () => {
    // Back-start has 5 catalog components post-archival; subtracting the
    // distance component leaves 4 dots on the arc.
    const plot = buildDiveArcPlot(backStart({ grade: { status: "graded", grade: 2 }, components: backComponents }));
    expect(plot.kind).toBe("wall");
    expect(plot.dots).toHaveLength(4);
    expect(plot.dots[0]?.x).toBe(WALL_ARC_START.x);
    expect(plot.dots[0]?.y).toBe(WALL_ARC_START.y);
    expect(plot.dots[3]?.x).toBe(WALL_ARC_END.x);
    expect(plot.dots[3]?.y).toBe(WALL_ARC_END.y);
  });

  it("passes through ungraded components as level null so the SVG draws a dashed dot", () => {
    const plot = buildDiveArcPlot(trackStart({
      grade: { status: "in_progress", missing: ["track-start-leg-feet", "track-start-head-arm-hand"] },
      components: trackComponents,
    }));
    const legsFeet = plot.dots.find((dot) => dot.slug === "track-start-leg-feet");
    expect(legsFeet?.level).toBeNull();
  });
});

describe("StartsSection helpers — distanceLineEndX", () => {
  it("returns the segment start when the value is null or zero", () => {
    expect(distanceLineEndX(null)).toBe(92);
    expect(distanceLineEndX(0)).toBe(92);
  });

  it("scales linearly within [0, 15] feet", () => {
    const halfway = distanceLineEndX(7.5);
    expect(halfway).toBeGreaterThan(92);
    expect(halfway).toBeLessThan(660);
    expect(distanceLineEndX(15)).toBe(660);
  });

  it("clamps at 15 ft so the line never overflows the water band", () => {
    expect(distanceLineEndX(25)).toBe(660);
  });
});

// ── Measurement change text ───────────────────────────────────────────────

describe("StartsSection helpers — measurementChangeText", () => {
  it("faster: negative seconds delta reads as 'faster than her first'", () => {
    expect(measurementChangeText("0.88", "seconds", "0.82", "seconds")).toBe(
      "0.06 s faster than her first",
    );
  });

  it("slower: positive seconds delta reads as 'slower than her first'", () => {
    expect(measurementChangeText("0.80", "seconds", "0.90", "seconds")).toBe(
      "0.1 s slower than her first",
    );
  });

  it("farther: positive feet delta reads as 'farther than her first'", () => {
    expect(measurementChangeText("6", "feet", "7", "feet")).toBe(
      "1 ft farther than her first",
    );
  });

  it("first-value only: no first measurement yet falls back to '<val>, first measurement'", () => {
    expect(measurementChangeText(null, null, "0.82", "seconds")).toBe(
      "0.82 s, first measurement",
    );
  });

  it("returns null when the latest value is missing (nothing measured yet)", () => {
    expect(measurementChangeText("0.82", "seconds", null, null)).toBeNull();
  });
});

describe("StartsSection helpers — firstMeasurement / latestMeasurement", () => {
  // Progress history ships newest-first; the helpers walk the right end of the
  // array for firstMeasurement and the left end for latestMeasurement.
  const history: ProgressRatingPoint[] = [
    point({ id: "p3", sessionDate: "2026-10-25", measurementValue: "0.82", measurementUnit: "seconds" }),
    point({ id: "p2", sessionDate: "2026-10-18", measurementValue: null, measurementUnit: null }),
    point({ id: "p1", sessionDate: "2026-10-11", measurementValue: "0.90", measurementUnit: "seconds" }),
  ];

  it("firstMeasurement picks the chronologically earliest point with a value", () => {
    expect(firstMeasurement(history)?.id).toBe("p1");
  });

  it("latestMeasurement picks the chronologically newest point with a value", () => {
    expect(latestMeasurement(history)?.id).toBe("p3");
  });

  it("returns null when no point carries a measurement", () => {
    expect(firstMeasurement([point({ id: "x", sessionDate: "2026-10-01" })])).toBeNull();
    expect(latestMeasurement([point({ id: "x", sessionDate: "2026-10-01" })])).toBeNull();
  });
});

// ── Session grid ──────────────────────────────────────────────────────────

describe("StartsSection helpers — recentSessionDatesForStart + buildSessionGridLookup", () => {
  const skillHistory = new Map<string, ProgressRatingPoint[]>([
    [
      "track-start-reaction",
      [
        point({ id: "r3", sessionDate: "2026-10-25", grade: 3 }),
        point({ id: "r2", sessionDate: "2026-10-11", grade: 2 }),
        point({ id: "r1", sessionDate: "2026-09-27", grade: 2 }),
      ],
    ],
    [
      "track-start-acceleration",
      [point({ id: "a1", sessionDate: "2026-10-18", grade: 2 })],
    ],
    // "track-start-height" has never been rated — shouldn't add a column, and
    // the row renders as all gaps for whatever columns exist.
  ]);

  const components: StartComponentProgress[] = [
    component({ slug: "track-start-reaction", name: "Reaction" }),
    component({ slug: "track-start-acceleration", name: "Acceleration" }),
    component({ slug: "track-start-height", name: "Height" }),
  ];

  it("returns the union of all component session dates, newest-first, capped at maxSessions", () => {
    const dates = recentSessionDatesForStart(components, skillHistory, 6);
    expect(dates).toEqual(["2026-10-25", "2026-10-18", "2026-10-11", "2026-09-27"]);
  });

  it("lookup gives a cell per (component, date) where the component was rated that day", () => {
    const lookup = buildSessionGridLookup(components, skillHistory);
    const reaction = lookup.get("track-start-reaction");
    expect(reaction?.get("2026-10-25")?.grade).toBe(3);
    expect(reaction?.get("2026-10-18")).toBeUndefined();            // gap
    expect(reaction?.get("2026-10-11")?.grade).toBe(2);
    expect(reaction?.get("2026-09-27")?.grade).toBe(2);
    const acceleration = lookup.get("track-start-acceleration");
    expect(acceleration?.get("2026-10-18")?.grade).toBe(2);
    expect(acceleration?.get("2026-10-25")).toBeUndefined();        // gap
    const height = lookup.get("track-start-height");
    expect(height?.size).toBe(0);                                   // all gaps
  });
});

// ── Component history map ─────────────────────────────────────────────────

describe("StartsSection helpers — startComponentHistoryMap", () => {
  it("slices progress.skills down to just this start's components", () => {
    const skills = [
      { slug: "track-start-reaction", history: [point({ id: "r1", sessionDate: "2026-10-01" })] },
      { slug: "free-kick", history: [point({ id: "x", sessionDate: "2026-10-01" })] },
    ];
    const components = [component({ slug: "track-start-reaction", name: "Reaction" })];
    const map = startComponentHistoryMap(skills, components);
    expect(map.has("track-start-reaction")).toBe(true);
    expect(map.has("free-kick")).toBe(false);
  });
});

// ── Component-level: full dive card ──────────────────────────────────────

describe("StartDiveCard — empty state", () => {
  it("renders the 'Not started yet' one-liner when no component is graded", () => {
    render(
      <StartDiveCard start={relayNothing} swimmerSkills={[]} />,
    );
    expect(screen.getByTestId("start-dive-card-empty-relay-start")).toBeInTheDocument();
    expect(screen.getByText(/Not started yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Grade it from the Starts section of an evaluation/i)).toBeInTheDocument();
    expect(screen.queryByTestId("dive-arc-svg")).toBeNull();
    expect(screen.queryByTestId("start-session-grid")).toBeNull();
  });
});

describe("StartDiveCard — graded track start", () => {
  const start = trackStart({
    grade: { status: "in_progress", missing: ["track-start-leg-feet", "track-start-head-arm-hand"] },
    components: trackComponents,
  });

  const swimmerSkills = [
    {
      slug: "track-start-reaction",
      history: [
        point({ id: "r2", sessionDate: "2026-10-25", grade: 3, measurementValue: "0.82", measurementUnit: "seconds" }),
        point({ id: "r1", sessionDate: "2026-10-11", grade: 2, measurementValue: "0.88", measurementUnit: "seconds" }),
      ],
    },
    {
      slug: "track-start-distance",
      history: [
        point({ id: "d2", sessionDate: "2026-10-25", grade: 2, measurementValue: "7", measurementUnit: "feet" }),
        point({ id: "d1", sessionDate: "2026-10-11", grade: 1, measurementValue: "6", measurementUnit: "feet" }),
      ],
    },
  ];

  it("renders the dive SVG with 5 arc dots plus the distance drawing", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} />);
    expect(screen.getByTestId("dive-arc-svg")).toBeInTheDocument();
    expect(screen.getAllByTestId("dive-arc-dot")).toHaveLength(5);
    expect(screen.getByText(/Distance 7 ft/)).toBeInTheDocument();
  });

  it("shows the reaction + entry-distance tiles with the change-vs-first copy", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} />);
    expect(screen.getByTestId("start-stat-change-reaction")).toHaveTextContent(
      "0.06 s faster than her first",
    );
    expect(screen.getByTestId("start-stat-change-distance")).toHaveTextContent(
      "1 ft farther than her first",
    );
  });

  it("shows a 'Still to grade' tile only while components remain ungraded", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} />);
    expect(screen.getByTestId("start-stat-tile-stillToGrade")).toHaveTextContent("2");
  });

  it("builds the session grid from the union of all components' dates and marks missing cells empty", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} />);
    const grid = screen.getByTestId("start-session-grid");
    // Reaction was rated on both dates — two value cells for reaction.
    const reactionCells = within(grid).getAllByTestId("start-session-grid-cell").filter(
      (cell) => cell.getAttribute("data-component") === "track-start-reaction",
    );
    expect(reactionCells).toHaveLength(2);
    // Acceleration, Height, Legs-and-feet, Head-arm-hand have no ratings in
    // the fixture, so every one of their cells is empty (dashed).
    const emptyCells = within(grid).getAllByTestId("start-session-grid-empty");
    expect(emptyCells.length).toBeGreaterThan(0);
  });
});

describe("StartDiveCard — backstroke start uses the wall arc", () => {
  it("places dots on the wall path (start x = wall anchor)", () => {
    const start = backStart({ grade: { status: "graded", grade: 2 }, components: backComponents });
    render(<StartDiveCard start={start} swimmerSkills={[]} />);
    const dots = screen.getAllByTestId("dive-arc-dot");
    // 5 components − 1 distance = 4 arc dots.
    expect(dots).toHaveLength(4);
    // Slugs are drawn in catalog order; the first non-distance slug is
    // back-start-reaction and lands on the arc's start anchor.
    expect(dots[0]?.getAttribute("data-component")).toBe("back-start-reaction");
  });
});

// The decisions doc (Oct 14) archived `back-start-streamline`. The coach
// API filters archived skills out of progress.startProgress[].components,
// so the UI never receives it — and therefore never surfaces it. These
// tests assert that the component list → arc / tiles / grid pipeline
// never resurrects an archived slug from any derived data (grade's
// `missing` list, session-date union, still-to-grade count) when the
// input components match the real post-archival catalog.
describe("StartsSection — archived back-start-streamline never surfaces", () => {
  it("renders exactly the 5 active back-start components (no streamline anywhere)", () => {
    const start = backStart({
      grade: { status: "in_progress", missing: ["back-start-entry-alignment"] },
      components: backComponents,
    });
    // Include a stray back-start-streamline rating in the per-skill
    // history to simulate a leak through a different code path. The grid
    // + component list drive off `start.components`, so even with the
    // leaked history, the streamline row should not render.
    const leakedStreamline = [
      {
        slug: "back-start-streamline",
        history: [point({ id: "s1", sessionDate: "2026-10-01", grade: 3 })],
      },
    ];
    render(<StartDiveCard start={start} swimmerSkills={leakedStreamline} />);

    // Arc: 4 dots, none for streamline.
    const arcDots = screen.getAllByTestId("dive-arc-dot");
    expect(arcDots).toHaveLength(4);
    for (const dot of arcDots) {
      expect(dot.getAttribute("data-component")).not.toBe("back-start-streamline");
    }

    // Session grid: no row for streamline (no cells and no empty slots
    // tagged with the archived slug).
    const gridCells = screen.queryAllByTestId("start-session-grid-cell");
    const gridEmpty = screen.queryAllByTestId("start-session-grid-empty");
    for (const cell of [...gridCells, ...gridEmpty]) {
      expect(cell.getAttribute("data-component")).not.toBe("back-start-streamline");
    }

    // Still-to-grade tile: counts only against the 5 active components —
    // one ungraded (entry-alignment), not two.
    expect(screen.getByTestId("start-stat-tile-stillToGrade")).toHaveTextContent("1");
  });

  it("'N of M' tab reads against the active catalog count, not an inflated 6", () => {
    // Match the real post-archival shape: 5 components total, 4 of them
    // graded (reaction, push, arch, distance). The tab status reads
    // "4 of 5", not "4 of 6".
    const start = backStart({
      grade: { status: "in_progress", missing: ["back-start-entry-alignment"] },
      components: backComponents,
    });
    render(<StartsSection startProgress={[start]} swimmerSkills={[]} />);
    expect(screen.getByTestId("starts-tab-back-start")).toHaveTextContent("4 of 5");
  });
});

// ── Orchestrator ──────────────────────────────────────────────────────────

describe("StartsSection — tabs + default selection", () => {
  it("defaults to the first start with any graded component and switches on click", () => {
    const track = trackStart({
      grade: { status: "in_progress", missing: ["track-start-reaction"] },
      components: [component({ slug: "track-start-reaction", name: "Reaction" })],
    });
    const back = backStart({ grade: { status: "graded", grade: 2 }, components: backComponents });
    render(<StartsSection startProgress={[track, back]} swimmerSkills={[]} />);

    // Default selection goes to the first start with a graded component
    // — the back start — not the leftmost tab.
    const backTab = screen.getByTestId("starts-tab-back-start");
    const trackTab = screen.getByTestId("starts-tab-track-start");
    expect(backTab.getAttribute("aria-selected")).toBe("true");
    expect(trackTab.getAttribute("aria-selected")).toBe("false");
    // Click switches the active card.
    fireEvent.click(trackTab);
    expect(trackTab.getAttribute("aria-selected")).toBe("true");
  });

  it("renders each tab's status text alongside the start name", () => {
    const track = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    const back = backStart({
      grade: { status: "in_progress", missing: ["back-start-entry-alignment"] },
      components: backComponents,
    });
    const relay = relayNothing;
    render(<StartsSection startProgress={[track, back, relay]} swimmerSkills={[]} />);
    expect(screen.getByTestId("starts-tab-track-start")).toHaveTextContent("Grade 3");
    // Back-start has 5 active components (streamline archived); 4 are
    // graded in the fixture, so the tab reads "4 of 5".
    expect(screen.getByTestId("starts-tab-back-start")).toHaveTextContent("4 of 5");
    expect(screen.getByTestId("starts-tab-relay-start")).toHaveTextContent("Not started");
  });
});

// Keep shortUnit assertions tight — it's used all over the card.
describe("StartsSection helpers — shortUnit", () => {
  it("abbreviates each measurement unit", () => {
    expect(shortUnit("seconds")).toBe("s");
    expect(shortUnit("feet")).toBe("ft");
    expect(shortUnit("stroke_count")).toBe("strokes");
    expect(shortUnit("stroke_cycles_per_minute")).toBe("spm");
    expect(shortUnit("kicks_per_minute")).toBe("kpm");
    expect(shortUnit(null)).toBe("");
  });
});
