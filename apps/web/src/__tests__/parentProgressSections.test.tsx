// Component-level coverage for the rebuilt top-of-page sections. The
// coach's focus area now splits across two production components:
// CoachNoteCard renders the latest priority's text + byline, and
// CoachFocusList renders the capped three-card Working on next grid.
// Tests here drive those production components directly; the earlier
// combined CoachFocus component has been deleted.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type {
  LatestCoachingPriority,
  ParentSkillProgress,
  ProgressCoachingPriority,
  SkillCurrentLevel,
} from "@swim-app/shared";
import CoachFocusList from "../content/ParentSwimmerProgressContent/sections/CoachFocusList";
import CoachNoteCard from "../content/ParentSwimmerProgressContent/sections/CoachNoteCard";
import SummaryCard from "../content/ParentSwimmerProgressContent/sections/SummaryCard";
import { buildSummaryCard } from "../content/ParentSwimmerProgressContent/helpers";
import type { CatalogIndexEntry } from "../lib/screenGroups";

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

function skill(options: {
  slug: string;
  name: string;
  current?: SkillCurrentLevel | null;
  levelDescriptors?: Record<string, string>;
}): ParentSkillProgress {
  return {
    skillId: `${options.slug}-id`,
    slug: options.slug,
    name: options.name,
    categoryId: "cat",
    categoryName: "Freestyle",
    type: "rubric",
    unit: null,
    ratedPerSide: false,
    parentSkillId: null,
    current: options.current ?? null,
    currentLeft: null,
    currentRight: null,
    history: [],
    ...(options.levelDescriptors && { levelDescriptors: options.levelDescriptors }),
  };
}

function catalogEntry(slug: string, displayName: string, categoryName: string): [string, CatalogIndexEntry] {
  return [
    slug,
    {
      skillId: `${slug}-id`,
      slug,
      rawName: displayName,
      displayName,
      sentenceName: displayName,
      categoryId: "cat",
      categoryName,
      type: "rubric",
      unit: null,
      ratedPerSide: false,
      parentSkillId: null,
    },
  ];
}

function priority(slug: string, name: string): ProgressCoachingPriority {
  return { targetSlug: slug, targetName: name, chain: [] };
}

// ── CoachFocusList ───────────────────────────────────────────────────────

describe("CoachFocusList", () => {
  it("caps the Working on next list at 3 cards, in the order the server returned them", () => {
    const priorities: ProgressCoachingPriority[] = [
      priority("free-core-stability", "Core stability"),
      priority("free-pull", "Pull"),
      priority("free-breath-right", "Breath timing, right side"),
      priority("free-rotation", "Rotation"),
      priority("free-head-position", "Head position"),
    ];
    const skillsBySlug = new Map(
      priorities.map((entry) => [entry.targetSlug, skill({ slug: entry.targetSlug, name: entry.targetName, current: level(2) })]),
    );
    const catalog = new Map(priorities.map((entry) => catalogEntry(entry.targetSlug, entry.targetName, "Freestyle")));
    render(
      <CoachFocusList
        workingOnNext={priorities}
        swimmerFirstName="Lily"
        skillsBySlug={skillsBySlug}
        catalogIndex={catalog}
      />,
    );
    const cards = screen.getAllByTestId("parent-coach-focus-card");
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("Core stability");
    expect(cards[1]).toHaveTextContent("Pull");
    expect(cards[2]).toHaveTextContent("Breath timing, right side");
  });

  it("renders a Next: line only when the skill has a descriptor for the next level", () => {
    const withDescriptor = skill({
      slug: "free-catch",
      name: "Catch",
      current: level(3),
      levelDescriptors: { "4": "Efficient at race pace on most strokes." },
    });
    const withoutDescriptor = skill({
      slug: "free-pull",
      name: "Pull",
      current: level(2),
    });
    const skillsBySlug = new Map<string, ParentSkillProgress>([
      ["free-catch", withDescriptor],
      ["free-pull", withoutDescriptor],
    ]);
    const catalog = new Map<string, CatalogIndexEntry>([
      catalogEntry("free-catch", "Catch", "Freestyle"),
      catalogEntry("free-pull", "Pull", "Freestyle"),
    ]);
    render(
      <CoachFocusList
        workingOnNext={[priority("free-catch", "Catch"), priority("free-pull", "Pull")]}
        swimmerFirstName="Lily"
        skillsBySlug={skillsBySlug}
        catalogIndex={catalog}
      />,
    );
    const cards = screen.getAllByTestId("parent-coach-focus-card");
    expect(within(cards[0]!).getByTestId("parent-coach-focus-next")).toHaveTextContent(
      "Advanced — Efficient at race pace on most strokes.",
    );
    expect(within(cards[1]!).queryByTestId("parent-coach-focus-next")).toBeNull();
  });

  it("empty state: shows the on-track line when there are no priorities", () => {
    render(
      <CoachFocusList
        workingOnNext={[]}
        swimmerFirstName="Maya"
        skillsBySlug={new Map()}
        catalogIndex={new Map()}
      />,
    );
    expect(screen.getByTestId("parent-coach-focus-empty")).toHaveTextContent(
      "Nothing flagged right now. Maya is on track.",
    );
  });
});

// ── CoachNoteCard ────────────────────────────────────────────────────────

describe("CoachNoteCard", () => {
  const latest: LatestCoachingPriority = {
    text: "Keep the lead arm out front when breathing to the right.",
    sessionDate: "2026-11-17",
    coachFirstName: "Jason",
  };

  it("returns null when there is no latest priority (the page conditionally renders it)", () => {
    const { container } = render(<CoachNoteCard latestPriority={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("surfaces the coach's first name in the byline when the response carries one", () => {
    render(<CoachNoteCard latestPriority={latest} />);
    // The API already returns just the first name; the byline reads
    // "From Coach Jason · Nov 17". Middot separator before the date.
    expect(screen.getByTestId("parent-coach-focus-byline")).toHaveTextContent("From Coach Jason · Nov 17");
  });

  it("falls back to 'From your coach' (no date) when coachFirstName is null", () => {
    render(
      <CoachNoteCard
        latestPriority={{ text: "Keep working.", sessionDate: "2026-10-14", coachFirstName: null }}
      />,
    );
    // Nameless fallback drops the date along with the name — without
    // an author the date-bearing byline stops reading as attribution.
    const byline = screen.getByTestId("parent-coach-focus-byline");
    expect(byline).toHaveTextContent("From your coach");
    expect(byline).not.toHaveTextContent("·");
    expect(byline).not.toHaveTextContent("Oct 14");
  });
});

// ── SummaryCard ──────────────────────────────────────────────────────────

describe("SummaryCard", () => {
  it("renders the headline, lesson line, and stacked bar with per-level counts", () => {
    const skills = [
      skill({ slug: "a", name: "A", current: level(2) }),
      skill({ slug: "b", name: "B", current: level(2) }),
      skill({ slug: "c", name: "C", current: level(4) }),
    ];
    const data = buildSummaryCard(skills, ["2026-09-30", "2026-11-17"], "Lily");
    render(<SummaryCard data={data} firstName="Lily" />);
    expect(screen.getByTestId("parent-summary-headline")).toHaveTextContent("Lily is getting started");
    expect(screen.getByTestId("parent-summary-lesson-line")).toHaveTextContent(
      "Last lesson graded Nov 17 · 2 evaluations since Sep",
    );
    const bar = screen.getByTestId("parent-summary-stacked-bar");
    // Three visible segments (levels 1/3/5 are zero).
    expect(within(bar).getByTestId("parent-summary-segment-2")).toHaveAttribute("data-count", "2");
    expect(within(bar).getByTestId("parent-summary-segment-4")).toHaveAttribute("data-count", "1");
    expect(within(bar).queryByTestId("parent-summary-segment-1")).toBeNull();
    // Text alternative lists every level.
    expect(bar).toHaveAttribute(
      "aria-label",
      "0 skills at Emerging, 2 at Developing, 0 at Competent, 1 at Advanced, 0 at Mastery",
    );
  });

  it("hides the stacked bar when there are no rated non-rollup skills", () => {
    const data = buildSummaryCard([], [], "Maya");
    render(<SummaryCard data={data} firstName="Maya" />);
    expect(screen.queryByTestId("parent-summary-stacked-bar")).toBeNull();
    expect(screen.queryByTestId("parent-summary-lesson-line")).toBeNull();
  });

  it("stacked bar shows the level name when the segment is wide, count only when narrower, nothing at the tail", () => {
    // Fixture: one dominant level (50 at Developing), one mid (5 at
    // Competent), one tiny tail (1 at Advanced). Across a 100-unit
    // bar that's 89% / 9% / 2% — crosses both thresholds.
    const skills: ParentSkillProgress[] = [
      ...Array.from({ length: 50 }, (_, index) =>
        skill({ slug: `d-${index}`, name: `D${index}`, current: level(2) }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        skill({ slug: `c-${index}`, name: `C${index}`, current: level(3) }),
      ),
      skill({ slug: "a-1", name: "A1", current: level(4) }),
    ];
    const data = buildSummaryCard(skills, ["2026-11-01"], "Lily");
    render(<SummaryCard data={data} firstName="Lily" />);
    const dev = screen.getByTestId("parent-summary-segment-2");
    const com = screen.getByTestId("parent-summary-segment-3");
    const adv = screen.getByTestId("parent-summary-segment-4");
    // Developing segment at ~89% fits the full "50 Developing" phrase.
    expect(dev.getAttribute("data-shows")).toBe("name-and-count");
    expect(dev).toHaveTextContent("50 Developing");
    // Competent segment at ~9% is too narrow for the name but still
    // fits the count.
    expect(com.getAttribute("data-shows")).toBe("count");
    expect(com).toHaveTextContent("5");
    expect(com).not.toHaveTextContent("Competent");
    // Advanced segment at ~2% is too narrow even for the count; the
    // segment renders empty visually. The aria-label still carries the
    // full distribution.
    expect(adv.getAttribute("data-shows")).toBe("none");
    expect(adv.textContent ?? "").toBe("");
    const bar = screen.getByTestId("parent-summary-stacked-bar");
    expect(bar.getAttribute("aria-label") ?? "").toContain("1 at Advanced");
  });

  it("hero headline flips to 'is getting started' when nothing has leveled up", () => {
    const skills = [
      // Rated but never changed → not counted as leveled up.
      skill({ slug: "a", name: "A", current: level(2) }),
    ];
    const data = buildSummaryCard(skills, ["2026-11-01"], "Maya");
    render(<SummaryCard data={data} firstName="Maya" />);
    expect(screen.getByTestId("parent-summary-headline")).toHaveTextContent("Maya is getting started");
  });
});
