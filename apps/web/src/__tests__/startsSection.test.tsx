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
import StartsSection from "../components/StartsSection";
import StartDiveCard from "../components/StartsSection/StartDiveCard";
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
  levelRampColor,
  measurementChangeText,
  pickInitialStartSlug,
  recentSessionDatesForStart,
  shortArcLabel,
  shortUnit,
  startComponentHistoryMap,
  tabStatusLabel,
  WALL_ARC_CONTROL,
  WALL_ARC_END,
  WALL_ARC_START,
} from "../components/StartsSection/helpers";

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
  it("faster: negative seconds delta reads as 'faster than <Name>'s first'", () => {
    expect(measurementChangeText("0.88", "seconds", "0.82", "seconds", "Maya")).toBe(
      "0.06 s faster than Maya's first",
    );
  });

  it("slower: positive seconds delta reads as 'slower than <Name>'s first'", () => {
    expect(measurementChangeText("0.80", "seconds", "0.90", "seconds", "Maya")).toBe(
      "0.1 s slower than Maya's first",
    );
  });

  it("farther: positive feet delta reads as 'farther than <Name>'s first'", () => {
    expect(measurementChangeText("6", "feet", "7", "feet", "Maya")).toBe(
      "1 ft farther than Maya's first",
    );
  });

  it("single measurement: isFirstOnly collapses the copy to 'First measurement'", () => {
    // The caller passes isFirstOnly when first and latest resolve to the
    // same rating in history — one data point, no delta to report.
    expect(
      measurementChangeText("0.82", "seconds", "0.82", "seconds", "Maya", { isFirstOnly: true }),
    ).toBe("First measurement");
  });

  it("no prior data point: falls back to 'First measurement'", () => {
    expect(measurementChangeText(null, null, "0.82", "seconds", "Maya")).toBe(
      "First measurement",
    );
  });

  it("returns null when the latest value is missing (nothing measured yet)", () => {
    expect(measurementChangeText("0.82", "seconds", null, null, "Maya")).toBeNull();
  });

  it("delta=0 (same measurement across two sessions) says 'Same as <Name>'s first N'", () => {
    expect(measurementChangeText("0.82", "seconds", "0.82", "seconds", "Maya")).toBe(
      "Same as Maya's first 0.82 s",
    );
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
      <StartDiveCard start={relayNothing} swimmerSkills={[]} swimmerFirstName="Maya" />,
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
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} swimmerFirstName="Maya" />);
    expect(screen.getByTestId("dive-arc-svg")).toBeInTheDocument();
    expect(screen.getAllByTestId("dive-arc-dot")).toHaveLength(5);
    expect(screen.getByText(/Distance 7 ft/)).toBeInTheDocument();
  });

  it("shows the reaction + entry-distance tiles with the change-vs-first copy", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} swimmerFirstName="Maya" />);
    expect(screen.getByTestId("start-stat-change-reaction")).toHaveTextContent(
      "0.06 s faster than Maya's first",
    );
    expect(screen.getByTestId("start-stat-change-distance")).toHaveTextContent(
      "1 ft farther than Maya's first",
    );
  });

  it("shows a 'Still to grade' tile only while components remain ungraded", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} swimmerFirstName="Maya" />);
    expect(screen.getByTestId("start-stat-tile-stillToGrade")).toHaveTextContent("2");
  });

  it("builds the session grid from the union of all components' dates and marks missing cells empty", () => {
    render(<StartDiveCard start={start} swimmerSkills={swimmerSkills} swimmerFirstName="Maya" />);
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
    render(<StartDiveCard start={start} swimmerSkills={[]} swimmerFirstName="Maya" />);
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
    render(<StartDiveCard start={start} swimmerSkills={leakedStreamline} swimmerFirstName="Maya" />);

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
    render(<StartsSection startProgress={[start]} swimmerSkills={[]} swimmerFirstName="Maya" />);
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
    render(<StartsSection startProgress={[track, back]} swimmerSkills={[]} swimmerFirstName="Maya" />);

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
    render(<StartsSection startProgress={[track, back, relay]} swimmerSkills={[]} swimmerFirstName="Maya" />);
    expect(screen.getByTestId("starts-tab-track-start")).toHaveTextContent("Grade 3");
    // Back-start has 5 active components (streamline archived); 4 are
    // graded in the fixture, so the tab reads "4 of 5".
    expect(screen.getByTestId("starts-tab-back-start")).toHaveTextContent("4 of 5");
    expect(screen.getByTestId("starts-tab-relay-start")).toHaveTextContent("Not started");
  });

  it("tab selection survives a re-render (proxy for a breakpoint resize)", () => {
    // The parent page renders StartsSection once inside a single tree;
    // when the viewport crosses a breakpoint the component rerenders
    // in place rather than remounting. React preserves state across a
    // rerender with the same key, so after flipping tabs manually a
    // fresh render with the same props should keep the selection.
    const track = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    const back = backStart({ grade: { status: "graded", grade: 2 }, components: backComponents });
    const { rerender } = render(<StartsSection startProgress={[track, back]} swimmerSkills={[]} swimmerFirstName="Maya" />);
    // Default lands on track (first with graded component in this fixture).
    expect(screen.getByTestId("starts-tab-track-start").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("starts-tab-back-start"));
    expect(screen.getByTestId("starts-tab-back-start").getAttribute("aria-selected")).toBe("true");

    // Re-render the same component tree (what happens when a CSS
    // media-query boundary is crossed in a real browser — React
    // reconciles, state persists).
    rerender(<StartsSection startProgress={[track, back]} swimmerSkills={[]} swimmerFirstName="Maya" />);
    expect(screen.getByTestId("starts-tab-back-start").getAttribute("aria-selected")).toBe("true");
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

// ── Short arc labels ─────────────────────────────────────────────────────

describe("StartsSection helpers — shortArcLabel", () => {
  it("maps block-start slugs to the brief's short vocabulary", () => {
    expect(shortArcLabel("track-start-reaction")).toBe("Reaction");
    expect(shortArcLabel("track-start-acceleration")).toBe("Acceleration");
    expect(shortArcLabel("track-start-height")).toBe("Height");
    expect(shortArcLabel("track-start-head-arm-hand")).toBe("Entry");
    expect(shortArcLabel("track-start-leg-feet")).toBe("Legs");
    expect(shortArcLabel("track-start-distance")).toBe("Distance");
  });

  it("maps back-start slugs to the four-word backstroke set", () => {
    expect(shortArcLabel("back-start-reaction")).toBe("Reaction");
    expect(shortArcLabel("back-start-push")).toBe("Push");
    expect(shortArcLabel("back-start-arch")).toBe("Arch");
    expect(shortArcLabel("back-start-entry-alignment")).toBe("Entry");
  });
});

describe("StartDiveCard — arc labels", () => {
  // Session grid only renders when at least one component carries
  // history — provide a minimal history so the grid branch is reached.
  const trackHistory = [
    {
      slug: "track-start-reaction",
      history: [point({ id: "r1", sessionDate: "2026-10-25", grade: 3, measurementValue: "0.82", measurementUnit: "seconds" })],
    },
  ];

  it("uses short labels on the SVG and keeps full names in the session grid", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    render(<StartDiveCard start={start} swimmerSkills={trackHistory} swimmerFirstName="Maya" />);
    const labels = screen.getAllByTestId("dive-arc-label");
    const texts = labels.map((label) => label.textContent);
    // Short vocabulary only — no "Head, arms, hands" or "Legs and feet"
    // on the arc.
    expect(texts).toContain("Reaction");
    expect(texts).toContain("Entry");
    expect(texts).toContain("Legs");
    expect(texts.every((text) => text !== null && !text.includes(","))).toBe(true);
    // Full names still appear in the session grid.
    const grid = screen.getByTestId("start-session-grid");
    expect(within(grid).getByText("Head, arms, hands")).toBeInTheDocument();
    expect(within(grid).getByText("Legs and feet")).toBeInTheDocument();
  });

  it("alternates label side per neighbour so labels never collide", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    render(<StartDiveCard start={start} swimmerSkills={[]} swimmerFirstName="Maya" />);
    const labels = screen.getAllByTestId("dive-arc-label");
    // Adjacent labels are on opposite sides. With CSS-px font size and
    // this alternation, labels at 375px wide can't vertically overlap
    // their neighbours.
    for (let index = 1; index < labels.length; index += 1) {
      const prev = labels[index - 1]!.getAttribute("data-label-side");
      const current = labels[index]!.getAttribute("data-label-side");
      expect(prev).not.toBe(current);
    }
  });

  it("uses CSS px font size (not SVG units) so labels stay readable at 375px", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    render(<StartDiveCard start={start} swimmerSkills={[]} swimmerFirstName="Maya" />);
    for (const label of screen.getAllByTestId("dive-arc-label")) {
      expect(label.getAttribute("style") ?? "").toMatch(/font-size:\s*\d+px/);
    }
  });
});

// ── Level-ramp contrast ──────────────────────────────────────────────────

describe("StartsSection helpers — levelRampColor contrast", () => {
  // Levels 1-2 use a very light accent wash — text must stay in the dark
  // text-token so it reads on the light background. Levels 4-5 are
  // saturated accent — text flips to on-accent so it reads against a
  // dark fill in both themes.
  it("uses --color-text for levels 1 and 2 (light wash), on-accent for 4 and 5 (saturated)", () => {
    expect(levelRampColor(1).color).toContain("--color-text");
    expect(levelRampColor(2).color).toContain("--color-text");
    expect(levelRampColor(4).color).toContain("--color-on-accent");
    expect(levelRampColor(5).color).toContain("--color-on-accent");
  });

  it("level 3 sits mid-ramp and keeps dark text (the mix is still light enough)", () => {
    const three = levelRampColor(3);
    expect(three.background).toMatch(/var\(--color-accent\)|color-mix/);
    // 55% accent + 45% surface-soft is still light enough for dark text
    // in light mode, and the accent variable flips in dark mode so the
    // mix flips with it — --color-text stays readable in both themes.
    expect(three.color).toContain("--color-text");
    expect(three.color).not.toContain("--color-on-accent");
  });

  it("null (not graded): transparent background with secondary text, so the dashed outline carries the state", () => {
    expect(levelRampColor(null).background).toBe("transparent");
    expect(levelRampColor(null).color).toContain("--color-text-secondary");
  });
});

// ── Surface-token contrast ───────────────────────────────────────────────

// Parses `style="background-color: var(--color-X)"` out of a rendered
// element's style attribute. JSDOM preserves CSS var() references verbatim
// (it can't resolve custom-property values), which is actually convenient
// here — we assert the token name, not a resolved hex.
//
// The leading `(?:^|;\\s*)` anchor matters: searching for "color" without
// it would also match "background-color" (it ends in "-color"), so a
// background-color token would leak into assertions about the `color`
// property.
function readStyleToken(element: Element, cssProp: string): string | null {
  const style = element.getAttribute("style") ?? "";
  const regex = new RegExp(`(?:^|;\\s*)${cssProp}:\\s*var\\((--color-[\\w-]+)\\)`);
  const match = style.match(regex);
  return match?.[1] ?? null;
}

const LIGHT_SURFACE_TOKENS = new Set(["--color-background", "--color-surface-soft"]);
const DARK_SURFACE_TOKENS = new Set(["--color-card", "--color-section", "--color-ink"]);
const LIGHT_SAFE_TEXT_TOKENS = new Set([
  "--color-text",
  "--color-text-secondary",
  "--color-heading",
  "--color-on-accent",     // fine on accent backgrounds
  "--color-on-danger",     // fine on danger backgrounds
]);

describe("StartsSection — never pairs dark surfaces with dark text", () => {
  // Rendered twice through the same assertion block — in jsdom, token
  // names in a style attribute don't change between themes (both themes
  // reference the same variable names; only the resolved values differ).
  // So the "token pair" invariant holds across both themes automatically.
  // We still call setAttribute so a reader can see the intended theme
  // split, and so any future code path that reads data-theme sees it
  // correctly.
  it("tabs use a light surface and a light-safe text color", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    document.documentElement.setAttribute("data-theme", "light");
    const { rerender } = render(<StartsSection startProgress={[start]} swimmerSkills={[]} swimmerFirstName="Maya" />);
    assertTabsSafe();

    document.documentElement.setAttribute("data-theme", "dark");
    rerender(<StartsSection startProgress={[start]} swimmerSkills={[]} swimmerFirstName="Maya" />);
    assertTabsSafe();

    document.documentElement.removeAttribute("data-theme");

    function assertTabsSafe() {
      for (const tab of screen.getAllByRole("tab")) {
        const bg = readStyleToken(tab, "background-color");
        const text = readStyleToken(tab, "color");
        // The active tab uses --color-accent as the surface, which is
        // allowed because text is forced to --color-on-accent.
        const bgAllowed = bg === "--color-accent" || (bg !== null && LIGHT_SURFACE_TOKENS.has(bg));
        expect(bgAllowed, `tab backgroundColor was ${bg}`).toBe(true);
        expect(bg && DARK_SURFACE_TOKENS.has(bg), `tab uses dark surface token ${bg}`).toBe(false);
        if (bg === "--color-accent") {
          expect(text).toBe("--color-on-accent");
        } else {
          expect(text, `tab text token ${text} not light-safe`).not.toBeNull();
          expect(LIGHT_SAFE_TEXT_TOKENS.has(text ?? "")).toBe(true);
        }
      }
    }
  });

  it("dive card + stat tiles use light surfaces, never --color-card", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    render(<StartDiveCard start={start} swimmerSkills={[]} swimmerFirstName="Maya" />);

    const card = screen.getByTestId("start-dive-card-track-start");
    const cardBg = readStyleToken(card, "background-color");
    expect(cardBg && DARK_SURFACE_TOKENS.has(cardBg), `dive card uses dark surface token ${cardBg}`).toBe(false);
    expect(cardBg !== null && LIGHT_SURFACE_TOKENS.has(cardBg)).toBe(true);

    for (const tile of screen.getAllByTestId(/start-stat-tile-/)) {
      const tileBg = readStyleToken(tile, "background-color");
      expect(tileBg && DARK_SURFACE_TOKENS.has(tileBg), `stat tile uses dark surface token ${tileBg}`).toBe(false);
      expect(tileBg !== null && LIGHT_SURFACE_TOKENS.has(tileBg)).toBe(true);
    }
  });

  it("session-grid row labels declare a light-safe text token", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    const minimalHistory = [
      {
        slug: "track-start-reaction",
        history: [point({ id: "r1", sessionDate: "2026-10-25", grade: 3 })],
      },
    ];
    render(<StartDiveCard start={start} swimmerSkills={minimalHistory} swimmerFirstName="Maya" />);
    const grid = screen.getByTestId("start-session-grid");
    // Each component name span sits as a grid child — it's the element
    // whose style declares the color. We find it by text and read the
    // style off it directly.
    for (const component of trackComponents) {
      const label = within(grid).getByText(component.name);
      const color = readStyleToken(label, "color");
      expect(color, `grid row ${component.name} color token missing`).not.toBeNull();
      expect(LIGHT_SAFE_TEXT_TOKENS.has(color ?? "")).toBe(true);
    }
  });

  it("arc labels declare a light-safe text token via their style attribute", () => {
    const start = trackStart({ grade: { status: "graded", grade: 3 }, components: trackComponents });
    render(<StartDiveCard start={start} swimmerSkills={[]} swimmerFirstName="Maya" />);
    for (const label of screen.getAllByTestId("dive-arc-label")) {
      // Inline style uses `fill` (not `color`) for SVG text.
      const fill = readStyleToken(label, "fill");
      expect(fill, `arc label fill token missing`).not.toBeNull();
      expect(LIGHT_SAFE_TEXT_TOKENS.has(fill ?? "")).toBe(true);
    }
  });
});
