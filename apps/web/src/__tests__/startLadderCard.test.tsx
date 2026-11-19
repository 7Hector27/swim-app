// Covers the four branches the StartLadderCard renders — graded, in
// progress, not started, measured-component display — plus the pure
// helpers that pick the branch and format component rows.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { StartComponentProgress, StartGradeResult } from "@swim-app/shared";
import StartLadderCard from "../components/StartLadderCard";
import {
  componentBarFill,
  componentCounts,
  componentValueLabel,
  formatMeasurementUnit,
  pickBranch,
  startHistoryToLadderPoints,
  statusBadge,
} from "../components/StartLadderCard/helpers";

function makeComponent(overrides: {
  slug: string;
  name: string;
  current?: StartComponentProgress["current"];
}): StartComponentProgress {
  return {
    slug: overrides.slug,
    name: overrides.name,
    current: overrides.current ?? null,
  };
}

const notStartedComponents: StartComponentProgress[] = [
  makeComponent({ slug: "reaction", name: "Reaction" }),
  makeComponent({ slug: "distance", name: "Distance" }),
];

const partialComponents: StartComponentProgress[] = [
  makeComponent({
    slug: "reaction",
    name: "Reaction",
    current: {
      grade: 3,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "0.45",
      measurementUnit: "seconds",
    },
  }),
  makeComponent({ slug: "distance", name: "Distance" }),
  makeComponent({ slug: "height", name: "Height" }),
];

const fullyGradedComponents: StartComponentProgress[] = [
  makeComponent({
    slug: "reaction",
    name: "Reaction",
    current: {
      grade: 4,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "0.42",
      measurementUnit: "seconds",
    },
  }),
  makeComponent({
    slug: "distance",
    name: "Distance",
    current: {
      grade: 3,
      notLegal: false,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: "9.5",
      measurementUnit: "feet",
    },
  }),
  makeComponent({
    slug: "height",
    name: "Height",
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
];

describe("StartLadderCard helpers — pickBranch", () => {
  it("returns graded when the start has a calculated grade", () => {
    expect(pickBranch({ status: "graded", grade: 3 }, fullyGradedComponents)).toBe("graded");
  });

  it("returns graded when the start is Not legal", () => {
    expect(pickBranch({ status: "not_legal" }, fullyGradedComponents)).toBe("graded");
  });

  it("returns noConcept when the start is No concept", () => {
    expect(pickBranch({ status: "no_concept" }, fullyGradedComponents)).toBe("noConcept");
  });

  it("returns inProgress when the start is in progress and at least one component is rated", () => {
    expect(pickBranch({ status: "in_progress", missing: ["distance", "height"] }, partialComponents))
      .toBe("inProgress");
  });

  it("returns notStarted when the start is in progress and no component is rated yet", () => {
    expect(pickBranch({ status: "in_progress", missing: ["reaction", "distance"] }, notStartedComponents))
      .toBe("notStarted");
  });
});

describe("StartLadderCard helpers — componentCounts", () => {
  it("counts components with any current rating", () => {
    expect(componentCounts(partialComponents)).toEqual({ graded: 1, total: 3 });
    expect(componentCounts(fullyGradedComponents)).toEqual({ graded: 3, total: 3 });
    expect(componentCounts(notStartedComponents)).toEqual({ graded: 0, total: 2 });
  });
});

describe("StartLadderCard helpers — statusBadge", () => {
  it("formats the four start-grade states with the vocabulary the brief preserves", () => {
    expect(statusBadge({ status: "graded", grade: 4 })).toEqual({ label: "Grade 4", tone: "accent" });
    expect(statusBadge({ status: "not_legal" })).toEqual({ label: "Not legal", tone: "danger" });
    expect(statusBadge({ status: "no_concept" })).toEqual({ label: "No concept", tone: "muted" });
    expect(statusBadge({ status: "in_progress", missing: [] })).toEqual({ label: "In progress", tone: "neutral" });
  });
});

describe("StartLadderCard helpers — startHistoryToLadderPoints", () => {
  // Input is oldest-first (what startSeries() returns); the ladder expects
  // newest-first (it reverses internally via buildLadderSeries). The helper
  // must produce newest-first for the ladder to draw oldest-to-newest.
  it("maps graded status to a numeric grade and reverses to newest-first", () => {
    const history: Array<{ sessionDate: string; grade: StartGradeResult; sessionId?: string }> = [
      { sessionDate: "2026-10-01", grade: { status: "graded", grade: 2 }, sessionId: "s1" },
      { sessionDate: "2026-10-08", grade: { status: "graded", grade: 3 }, sessionId: "s2" },
      { sessionDate: "2026-10-15", grade: { status: "graded", grade: 4 }, sessionId: "s3" },
    ];
    const ladder = startHistoryToLadderPoints(history);
    expect(ladder.map((point) => point.sessionDate)).toEqual(["2026-10-15", "2026-10-08", "2026-10-01"]);
    expect(ladder.map((point) => point.grade)).toEqual([4, 3, 2]);
  });

  it("maps not_legal to a notLegal: true point and no_concept to noConcept: true", () => {
    const history: Array<{ sessionDate: string; grade: StartGradeResult; sessionId?: string }> = [
      { sessionDate: "2026-10-01", grade: { status: "not_legal" }, sessionId: "s1" },
      { sessionDate: "2026-10-08", grade: { status: "no_concept" }, sessionId: "s2" },
    ];
    const ladder = startHistoryToLadderPoints(history);
    const nc = ladder.find((point) => point.sessionDate === "2026-10-08");
    const nl = ladder.find((point) => point.sessionDate === "2026-10-01");
    expect(nc?.noConcept).toBe(true);
    expect(nc?.grade).toBeNull();
    expect(nl?.notLegal).toBe(true);
    expect(nl?.grade).toBeNull();
  });

  it("skips in_progress entries entirely (nothing to plot that session)", () => {
    const history: Array<{ sessionDate: string; grade: StartGradeResult; sessionId?: string }> = [
      { sessionDate: "2026-10-01", grade: { status: "in_progress", missing: ["reaction"] }, sessionId: "s1" },
      { sessionDate: "2026-10-08", grade: { status: "graded", grade: 3 }, sessionId: "s2" },
    ];
    const ladder = startHistoryToLadderPoints(history);
    expect(ladder).toHaveLength(1);
    expect(ladder[0]?.sessionDate).toBe("2026-10-08");
  });
});

describe("StartLadderCard helpers — formatMeasurementUnit", () => {
  it("renders the units called out in the brief", () => {
    expect(formatMeasurementUnit("seconds")).toBe("s");
    expect(formatMeasurementUnit("feet")).toBe("ft");
  });

  it("renders stroke-rate units as readable shorthand", () => {
    expect(formatMeasurementUnit("stroke_cycles_per_minute")).toBe("spm");
    expect(formatMeasurementUnit("kicks_per_minute")).toBe("kpm");
  });

  it("returns an empty string when there is no unit", () => {
    expect(formatMeasurementUnit(null)).toBe("");
  });
});

describe("StartLadderCard helpers — componentValueLabel", () => {
  it("formats a measured component as number + short unit", () => {
    const current = fullyGradedComponents[0]?.current ?? null;
    expect(componentValueLabel(current)).toBe("0.42s");
  });

  it("returns null for rubric-only components (no measurement, no capacity)", () => {
    const current = fullyGradedComponents[2]?.current ?? null;
    expect(componentValueLabel(current)).toBeNull();
  });

  it("returns null when the component isn't rated yet", () => {
    expect(componentValueLabel(null)).toBeNull();
  });
});

describe("StartLadderCard helpers — componentBarFill", () => {
  it("returns the numeric grade for a standard rating", () => {
    const current = fullyGradedComponents[0]?.current ?? null;
    expect(componentBarFill(current)).toBe(4);
  });

  it("returns null for DQ / NC / unrated so the row can render a status badge instead", () => {
    expect(componentBarFill(null)).toBeNull();
    expect(componentBarFill({
      grade: null,
      notLegal: true,
      noConcept: false,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
    })).toBeNull();
    expect(componentBarFill({
      grade: null,
      notLegal: false,
      noConcept: true,
      capacityValue: null,
      capacityUnit: null,
      measurementValue: null,
      measurementUnit: null,
    })).toBeNull();
  });
});

// ── Component-level tests ────────────────────────────────────────────────

describe("StartLadderCard — graded branch", () => {
  it("renders a LevelLadder for the start's grade history and a component list underneath", () => {
    render(
      <StartLadderCard
        name="Track Start"
        grade={{ status: "graded", grade: 4 }}
        components={fullyGradedComponents}
        history={[
          { sessionDate: "2026-10-01", grade: { status: "graded", grade: 2 } },
          { sessionDate: "2026-10-08", grade: { status: "graded", grade: 3 } },
          { sessionDate: "2026-10-15", grade: { status: "graded", grade: 4 } },
        ]}
      />,
    );
    // The card is in the "graded" branch, the shared ladder renders inside
    // it, and the component list appears alongside.
    expect(screen.getByTestId("start-ladder-card-graded")).toBeInTheDocument();
    expect(screen.getByTestId("level-ladder")).toBeInTheDocument();
    expect(screen.getByTestId("start-ladder-components")).toBeInTheDocument();
    expect(screen.getByTestId("start-ladder-status-badge")).toHaveTextContent("Grade 4");
  });

  it("measured components surface their value with the right unit shorthand", () => {
    render(
      <StartLadderCard
        name="Track Start"
        grade={{ status: "graded", grade: 3 }}
        components={fullyGradedComponents}
        history={[]}
      />,
    );
    const componentList = screen.getByTestId("start-ladder-components");
    // Reaction → 0.42s, Distance → 9.5ft, Height → rubric-only (no value)
    expect(within(componentList).getByText("0.42s")).toBeInTheDocument();
    expect(within(componentList).getByText("9.5ft")).toBeInTheDocument();
  });
});

describe("StartLadderCard — in-progress branch", () => {
  it("renders the compact card with 'N of M components graded' and no ladder", () => {
    render(
      <StartLadderCard
        name="Track Start"
        grade={{ status: "in_progress", missing: ["distance", "height"] }}
        components={partialComponents}
        history={[]}
      />,
    );
    expect(screen.getByTestId("start-ladder-card-inProgress")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 components graded")).toBeInTheDocument();
    expect(screen.queryByTestId("level-ladder")).toBeNull();
    // Component list still renders so the parent / coach can see which
    // ones are still missing.
    expect(screen.getByTestId("start-ladder-components")).toBeInTheDocument();
    expect(screen.getByTestId("start-ladder-status-badge")).toHaveTextContent("In progress");
  });
});

describe("StartLadderCard — not-started branch", () => {
  it("renders the one-liner and no ladder / no component list", () => {
    render(
      <StartLadderCard
        name="Relay Start"
        grade={{ status: "in_progress", missing: ["reaction", "distance"] }}
        components={notStartedComponents}
        history={[]}
      />,
    );
    expect(screen.getByTestId("start-ladder-card-notStarted")).toBeInTheDocument();
    expect(screen.getByText(/Not started yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("level-ladder")).toBeNull();
    expect(screen.queryByTestId("start-ladder-components")).toBeNull();
  });
});
