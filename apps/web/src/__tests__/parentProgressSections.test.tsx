// Component-level coverage for the rebuilt top-of-page sections:
// CoachFocus (cap at 3, empty state, descriptor presence) and
// SummaryCard (headline + stacked bar).

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type {
  LatestCoachingPriority,
  ParentSkillProgress,
  ProgressCoachingPriority,
  SkillCurrentLevel,
} from "@swim-app/shared";
import CoachFocus from "../content/ParentSwimmerProgressContent/sections/CoachFocus";
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

// ── CoachFocus ───────────────────────────────────────────────────────────

describe("CoachFocus", () => {
  const latest: LatestCoachingPriority = {
    text: "Keep the lead arm out front when breathing to the right.",
    sessionDate: "2026-11-17",
    coachName: "Jason Riley",
  };

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
      <CoachFocus
        latestPriority={latest}
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
      <CoachFocus
        latestPriority={latest}
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

  it("empty state: shows the on-track line when there are no priorities and no latest note", () => {
    render(
      <CoachFocus
        latestPriority={null}
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

  it("hides the note card when there is no latest priority, even with priority cards", () => {
    render(
      <CoachFocus
        latestPriority={null}
        workingOnNext={[priority("a", "A")]}
        swimmerFirstName="Maya"
        skillsBySlug={new Map([["a", skill({ slug: "a", name: "A", current: level(3) })]])}
        catalogIndex={new Map([catalogEntry("a", "A", "Freestyle")])}
      />,
    );
    expect(screen.queryByTestId("parent-coach-focus-note")).toBeNull();
    expect(screen.queryByTestId("parent-coach-focus-byline")).toBeNull();
    // Priority cards still render.
    expect(screen.getByTestId("parent-coach-focus-card")).toBeInTheDocument();
  });

  it("surfaces the coach's name in the byline when the response carries one", () => {
    render(
      <CoachFocus
        latestPriority={latest}
        workingOnNext={[]}
        swimmerFirstName="Lily"
        skillsBySlug={new Map()}
        catalogIndex={new Map()}
      />,
    );
    expect(screen.getByTestId("parent-coach-focus-byline")).toHaveTextContent(/From Coach Jason, Nov 17/);
  });

  it("falls back to 'From your coach, <date>' when coachName is null", () => {
    render(
      <CoachFocus
        latestPriority={{ text: "Keep working.", sessionDate: "2026-10-14", coachName: null }}
        workingOnNext={[]}
        swimmerFirstName="Lily"
        skillsBySlug={new Map()}
        catalogIndex={new Map()}
      />,
    );
    expect(screen.getByTestId("parent-coach-focus-byline")).toHaveTextContent(/From your coach, Oct 14/);
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
