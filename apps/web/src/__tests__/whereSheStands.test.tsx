// Covers the four-column WhereSheStands table: header labels, one
// divider per row with none on individual cells, filled stretch tone
// (up / flat / down), the not-rated row, the ring-collapses-to-dot rule
// when first equals current, and the phone arrangement where "Skills
// rated" moves under the group name.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WhereSheStands from "../components/WhereSheStands/WhereSheStands";
import {
  averageToPct,
  averagesEqual,
  buildLanes,
  laneIsRated,
  SCALE_LABELS,
  stretchTone,
  type Lane,
} from "../components/WhereSheStands/helpers";

// ── averageToPct ─────────────────────────────────────────────────────────

describe("averageToPct", () => {
  it("1.0 → 0% (left edge)", () => {
    expect(averageToPct(1)).toBe(0);
  });

  it("5.0 → 100% (right edge)", () => {
    expect(averageToPct(5)).toBe(100);
  });

  it("3.0 → 50% (midpoint)", () => {
    expect(averageToPct(3)).toBe(50);
  });

  it("2.6 → 40%", () => {
    expect(averageToPct(2.6)).toBeCloseTo(40, 5);
  });

  it("clamps values outside 1..5 to the track edges", () => {
    expect(averageToPct(0.3)).toBe(0);
    expect(averageToPct(5.8)).toBe(100);
  });
});

// ── averagesEqual + stretchTone ──────────────────────────────────────────

describe("averagesEqual + stretchTone", () => {
  it("averagesEqual rounds within a tenth so server-side fp noise doesn't split a flat tone", () => {
    expect(averagesEqual(2.5, 2.5)).toBe(true);
    expect(averagesEqual(2.5, 2.52)).toBe(true);
    expect(averagesEqual(2.5, 2.7)).toBe(false);
    expect(averagesEqual(null, 2.5)).toBe(false);
    expect(averagesEqual(2.5, null)).toBe(false);
  });

  const base: Lane = {
    slug: "freestyle",
    name: "Freestyle",
    firstAverage: null,
    firstAssessedCount: 0,
    currentAverage: null,
    currentAssessedCount: 0,
    totalCount: 25,
  };

  it("up: current > first", () => {
    expect(stretchTone({ ...base, firstAverage: 1.5, firstAssessedCount: 1, currentAverage: 2.5, currentAssessedCount: 3 })).toBe("up");
  });

  it("down: current < first", () => {
    expect(stretchTone({ ...base, firstAverage: 3.0, firstAssessedCount: 3, currentAverage: 2.0, currentAssessedCount: 3 })).toBe("down");
  });

  it("flat: current equals first", () => {
    expect(stretchTone({ ...base, firstAverage: 2.5, firstAssessedCount: 2, currentAverage: 2.5, currentAssessedCount: 3 })).toBe("flat");
  });

  it("none: either average is null", () => {
    expect(stretchTone({ ...base, firstAverage: null, currentAverage: 2.5, currentAssessedCount: 3 })).toBe("none");
    expect(stretchTone({ ...base, firstAverage: 2.0, firstAssessedCount: 1, currentAverage: null })).toBe("none");
  });
});

// ── laneIsRated + buildLanes ─────────────────────────────────────────────

describe("laneIsRated + buildLanes", () => {
  const baseLane: Lane = {
    slug: "freestyle",
    name: "Freestyle",
    firstAverage: null,
    firstAssessedCount: 0,
    currentAverage: null,
    currentAssessedCount: 0,
    totalCount: 25,
  };

  it("laneIsRated is false when nothing has ever been rated", () => {
    expect(laneIsRated(baseLane)).toBe(false);
  });

  it("laneIsRated is true when the current evaluation has at least one rated skill", () => {
    expect(laneIsRated({ ...baseLane, currentAssessedCount: 1 })).toBe(true);
  });

  it("buildLanes follows the current snapshot's order and joins by slug", () => {
    const first = [
      { screenSlug: "freestyle", name: "Freestyle", average: 1.8, assessedCount: 5, totalCount: 25 },
    ];
    const current = [
      { screenSlug: "freestyle", name: "Freestyle", average: 2.6, assessedCount: 18, totalCount: 25 },
      { screenSlug: "backstroke", name: "Backstroke", average: 2.1, assessedCount: 24, totalCount: 24 },
    ];
    const lanes = buildLanes(first, current);
    expect(lanes.map((lane) => lane.slug)).toEqual(["freestyle", "backstroke"]);
    expect(lanes[0]).toMatchObject({
      firstAverage: 1.8,
      firstAssessedCount: 5,
      currentAverage: 2.6,
      currentAssessedCount: 18,
      totalCount: 25,
    });
    // Missing from the first snapshot → firstAverage null, assessedCount 0.
    expect(lanes[1]).toMatchObject({ firstAverage: null, firstAssessedCount: 0 });
  });
});

// ── Rendering ────────────────────────────────────────────────────────────

const RATED_LANES: Lane[] = [
  {
    slug: "freestyle",
    name: "Freestyle",
    firstAverage: 1.8,
    firstAssessedCount: 5,
    currentAverage: 2.6,
    currentAssessedCount: 18,
    totalCount: 25,
  },
  {
    slug: "backstroke",
    name: "Backstroke",
    firstAverage: 3.0,
    firstAssessedCount: 10,
    currentAverage: 2.0,
    currentAssessedCount: 12,
    totalCount: 24,
  },
  {
    slug: "butterfly",
    name: "Butterfly",
    firstAverage: 2.0,
    firstAssessedCount: 1,
    currentAverage: 2.0,
    currentAssessedCount: 4,
    totalCount: 25,
  },
  {
    slug: "im-turns",
    name: "IM turns",
    firstAverage: null,
    firstAssessedCount: 0,
    currentAverage: null,
    currentAssessedCount: 0,
    totalCount: 5,
  },
];

describe("WhereSheStands — header + table structure", () => {
  it("returns null when no lanes are passed", () => {
    const { container } = render(<WhereSheStands lanes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("header row includes 'Group', 'Average', and 'Skills rated' column labels", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const header = screen.getByTestId("wss-header-row");
    expect(within(header).getByText("Group")).toBeInTheDocument();
    expect(within(header).getByText("Average")).toBeInTheDocument();
    expect(within(header).getByText("Skills rated")).toBeInTheDocument();
  });

  it("scale-label row uses '1 Emerging', '3 Competent', '5 Mastery' (not the bare digits)", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const scale = screen.getByTestId("wss-scale-labels");
    expect(scale.textContent ?? "").toContain(SCALE_LABELS[0]);
    expect(scale.textContent ?? "").toContain(SCALE_LABELS[1]);
    expect(scale.textContent ?? "").toContain(SCALE_LABELS[2]);
    // No bare "1 2 3 4 5" sequence.
    expect(scale.textContent ?? "").not.toMatch(/^\s*1\s+2\s+3\s+4\s+5\s*$/);
  });
});

describe("WhereSheStands — one divider per row, none on cells", () => {
  it("every row EXCEPT the last carries a single bottom-border; no <td>/<th> carries its own border", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const table = screen.getByTestId("where-she-stands").querySelector("table")!;
    const rows = Array.from(table.querySelectorAll("tr"));
    // Header + 4 data rows. The last data row has no border.
    expect(rows).toHaveLength(5);
    for (let index = 0; index < rows.length - 1; index += 1) {
      const style = rows[index]!.getAttribute("style") ?? "";
      expect(style, `row ${index} should carry a bottom border`).toMatch(/border-bottom:\s*1px solid/);
    }
    // Last row carries no bottom border.
    const lastStyle = rows[rows.length - 1]!.getAttribute("style") ?? "";
    expect(lastStyle).not.toMatch(/border-bottom:/);
    // No cell carries its own border — the row owns the divider so it
    // runs unbroken across the column gaps.
    const cells = table.querySelectorAll("td, th");
    for (const cell of cells) {
      const cellStyle = cell.getAttribute("style") ?? "";
      expect(cellStyle).not.toMatch(/border(-bottom|-top)?:\s*1px/);
    }
  });
});

describe("WhereSheStands — stretch fill tone", () => {
  function getTrack(slug: string): HTMLElement {
    const row = document.querySelector(`[data-testid="wss-lane-row"][data-slug="${slug}"]`);
    expect(row, `missing lane ${slug}`).not.toBeNull();
    return within(row as HTMLElement).getByTestId("wss-track");
  }

  it("up: the stretch between first and current fills with the accent color", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const track = getTrack("freestyle");
    expect(track.getAttribute("data-tone")).toBe("up");
    const stretch = within(track).getByTestId("wss-track-stretch");
    expect(stretch.getAttribute("style") ?? "").toContain("background-color: var(--color-accent)");
  });

  it("down: the stretch fills with a neutral color and both markers stay visible", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const track = getTrack("backstroke");
    expect(track.getAttribute("data-tone")).toBe("down");
    const stretch = within(track).getByTestId("wss-track-stretch");
    expect(stretch.getAttribute("style") ?? "").toContain("background-color: var(--color-text-secondary)");
    expect(within(track).getByTestId("wss-marker-ring")).toBeInTheDocument();
    expect(within(track).getByTestId("wss-marker-dot")).toBeInTheDocument();
  });

  it("flat: first equals current → only the dot is drawn, no ring and no stretch", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const track = getTrack("butterfly");
    expect(track.getAttribute("data-tone")).toBe("flat");
    expect(within(track).queryByTestId("wss-marker-ring")).toBeNull();
    expect(within(track).queryByTestId("wss-track-stretch")).toBeNull();
    expect(within(track).getByTestId("wss-marker-dot")).toBeInTheDocument();
  });
});

describe("WhereSheStands — not-rated lane", () => {
  it("renders a dotted track and 'Not rated yet' spanning the last two columns on tablet+", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const row = document.querySelector('[data-testid="wss-lane-row"][data-slug="im-turns"]');
    expect(row).not.toBeNull();
    expect(row!.getAttribute("data-rated")).toBe("false");
    expect(within(row as HTMLElement).getByTestId("wss-track-not-rated")).toBeInTheDocument();
    const desktopNotRated = within(row as HTMLElement).getByTestId("wss-lane-not-rated-desktop");
    expect(desktopNotRated.getAttribute("colspan")).toBe("2");
    expect(desktopNotRated).toHaveTextContent("Not rated yet");
    // Phone-only not-rated cell also exists so the message still shows
    // when Skills rated is hidden. One of the two is visible per viewport.
    expect(within(row as HTMLElement).getByTestId("wss-lane-not-rated-phone")).toHaveTextContent("Not rated yet");
    expect(within(row as HTMLElement).queryByTestId("wss-marker-ring")).toBeNull();
    expect(within(row as HTMLElement).queryByTestId("wss-marker-dot")).toBeNull();
  });
});

describe("WhereSheStands — compact (narrow-container) arrangement", () => {
  it("Skills rated moves under the group name below the 520px container threshold", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const freestyle = document.querySelector('[data-testid="wss-lane-row"][data-slug="freestyle"]')!;
    const phone = within(freestyle as HTMLElement).getByTestId("wss-lane-rated-phone");
    expect(phone).toHaveTextContent("18 of 25");
    // The subtitle hides once the card itself crosses 520px (container
    // query), not when the viewport does — matches the responsive rule.
    expect(phone.className).toContain("@min-[520px]/wss:hidden");
    // "6 of 7" must never line-break in the middle of the count.
    expect(phone.className).toContain("whitespace-nowrap");
    // The Skills rated column cell appears only above the same threshold.
    const desktop = within(freestyle as HTMLElement).getByTestId("wss-lane-rated-desktop");
    expect(desktop.className).toContain("hidden");
    expect(desktop.className).toContain("@min-[520px]/wss:table-cell");
  });

  it("Skills rated column header is driven by the same container-query threshold", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const skillsHeader = screen.getByText("Skills rated").closest("th")!;
    expect(skillsHeader.className).toContain("hidden");
    expect(skillsHeader.className).toContain("@min-[520px]/wss:table-cell");
  });
});

// ── Containment + overflow ───────────────────────────────────────────────

describe("WhereSheStands — container-query layout + inner scroll", () => {
  it("the card is a named container (@container/wss) so children query its width, not the viewport", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const card = screen.getByTestId("where-she-stands");
    expect(card.className).toContain("@container/wss");
  });

  it("the table sits in a horizontally-scrollable wrapper with a min-width so the card never forces page-wide horizontal scroll", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const wrapper = screen.getByTestId("wss-scroll-wrapper");
    expect(wrapper.className).toContain("overflow-x-auto");
    const table = wrapper.querySelector("table")!;
    expect(table.className).toContain("min-w-[280px]");
    expect(table.className).toContain("w-full");
  });

  it("the legend lives OUTSIDE the scroll wrapper so it's never clipped by overflow", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const wrapper = screen.getByTestId("wss-scroll-wrapper");
    const legend = screen.getByTestId("wss-legend");
    expect(wrapper.contains(legend)).toBe(false);
    expect(screen.getByTestId("where-she-stands").contains(legend)).toBe(true);
  });

  it("scale labels render both the digit-only and full forms so the container query can swap between them", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const scale = screen.getByTestId("wss-scale-labels");
    const digitOnly = Array.from(scale.querySelectorAll("span"))
      .filter((span) => span.className.includes("@min-[440px]/wss:hidden"))
      .map((span) => span.textContent);
    expect(digitOnly).toEqual(["1", "3", "5"]);
    const fullOnly = Array.from(scale.querySelectorAll("span"))
      .filter((span) => span.className.includes("@min-[440px]/wss:inline"))
      .map((span) => span.textContent);
    expect(fullOnly).toEqual([SCALE_LABELS[0], SCALE_LABELS[1], SCALE_LABELS[2]]);
  });
});

describe("WhereSheStands — legend", () => {
  it("renders the legend inside the card with 'First evaluation' + 'Now'", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const legend = screen.getByTestId("wss-legend");
    expect(legend).toHaveTextContent("First evaluation");
    expect(legend).toHaveTextContent("Now");
  });
});

describe("WhereSheStands — aria-label", () => {
  it("describes each lane's average + rated count (and not-rated lanes)", () => {
    render(<WhereSheStands lanes={RATED_LANES} />);
    const section = screen.getByTestId("where-she-stands");
    const aria = section.getAttribute("aria-label") ?? "";
    expect(aria).toContain("Freestyle: average 2.6, 18 of 25 skills rated");
    expect(aria).toContain("Backstroke: average 2.0, 12 of 24 skills rated");
    expect(aria).toContain("IM turns: not rated yet");
  });
});
