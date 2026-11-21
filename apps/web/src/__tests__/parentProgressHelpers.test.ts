// Pure-helper tests for the parent progress page: recent-wins
// detection, summary-card math, and the skill-row change / level /
// pips helpers.

import { describe, it, expect } from "vitest";
import type {
  ParentProgressRatingPoint,
  ParentSkillProgress,
  SkillCurrentLevel,
} from "@swim-app/shared";
import {
  buildRecentWins,
  buildSummaryCard,
  rowChangeText,
  rowLevelLabel,
  rowPipCount,
} from "../content/ParentSwimmerProgressContent/helpers";

const CAT_ID = "cccccccc-0000-0000-0000-000000000001";

function point(
  overrides: Partial<ParentProgressRatingPoint> & { id: string; sessionDate: string },
): ParentProgressRatingPoint {
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
    edited: overrides.edited ?? false,
    previousValue: overrides.previousValue ?? null,
  };
}

function skill(options: {
  slug: string;
  name: string;
  current?: SkillCurrentLevel | null;
  ratedPerSide?: boolean;
  currentLeft?: SkillCurrentLevel | null;
  currentRight?: SkillCurrentLevel | null;
  history?: ParentProgressRatingPoint[];
}): ParentSkillProgress {
  return {
    skillId: `${options.slug}-id`,
    slug: options.slug,
    name: options.name,
    categoryId: CAT_ID,
    categoryName: "Freestyle",
    type: "rubric",
    unit: null,
    ratedPerSide: options.ratedPerSide ?? false,
    parentSkillId: null,
    current: options.current ?? null,
    currentLeft: options.currentLeft ?? null,
    currentRight: options.currentRight ?? null,
    history: options.history ?? [],
  };
}

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

// ── Recent wins ──────────────────────────────────────────────────────────

describe("buildRecentWins", () => {
  it("detects a first time a skill reached level 2 or higher ('new level')", () => {
    const kick = skill({
      slug: "free-kick",
      name: "Kick",
      current: level(4),
      history: [
        point({ id: "k4", sessionDate: "2026-11-10", grade: 4 }),
        point({ id: "k3", sessionDate: "2026-10-28", grade: 3 }),
        point({ id: "k2", sessionDate: "2026-10-14", grade: 2 }),
        point({ id: "k1", sessionDate: "2026-09-30", grade: 1 }),
      ],
    });
    const wins = buildRecentWins([kick]);
    expect(wins.map((win) => win.headline)).toEqual([
      "Kick reached Advanced",
      "Kick reached Competent",
      "Kick reached Developing",
    ]);
  });

  it("detects the first race at level 3+", () => {
    const rotation = skill({
      slug: "free-rotation",
      name: "Rotation",
      current: level(3),
      history: [
        point({ id: "rot-race", sessionDate: "2026-11-03", grade: 3, context: "race" }),
        point({ id: "rot-prac", sessionDate: "2026-10-28", grade: 3, context: "practice" }),
      ],
    });
    const wins = buildRecentWins([rotation]);
    expect(wins).toContainEqual(
      expect.objectContaining({ kind: "raceHeld", skillName: "Rotation", headline: "Rotation held at Competent in a race" }),
    );
  });

  it("detects mastery when a skill first reaches level 5, not a plain 'new level 5'", () => {
    const streamline = skill({
      slug: "streamline",
      name: "Streamline",
      current: level(5),
      history: [point({ id: "s1", sessionDate: "2026-11-10", grade: 5 })],
    });
    const wins = buildRecentWins([streamline]);
    expect(wins).toHaveLength(1);
    expect(wins[0]?.kind).toBe("mastery");
    expect(wins[0]?.headline).toBe("Streamline reached Mastery");
  });

  it("sorts wins newest first and caps the list at maxWins", () => {
    const skills: ParentSkillProgress[] = [
      skill({
        slug: "a",
        name: "A",
        current: level(2),
        history: [point({ id: "a1", sessionDate: "2026-10-01", grade: 2 })],
      }),
      skill({
        slug: "b",
        name: "B",
        current: level(2),
        history: [point({ id: "b1", sessionDate: "2026-11-01", grade: 2 })],
      }),
      skill({
        slug: "c",
        name: "C",
        current: level(2),
        history: [point({ id: "c1", sessionDate: "2026-11-15", grade: 2 })],
      }),
      skill({
        slug: "d",
        name: "D",
        current: level(2),
        history: [point({ id: "d1", sessionDate: "2026-11-20", grade: 2 })],
      }),
    ];
    const wins = buildRecentWins(skills, new Map(), 3);
    expect(wins).toHaveLength(3);
    expect(wins.map((win) => win.skillName)).toEqual(["D", "C", "B"]);
  });

  it("returns an empty array when nothing qualifies (level 1 never, no race, no mastery)", () => {
    const stuck = skill({
      slug: "stuck",
      name: "Stuck",
      current: level(1),
      history: [
        point({ id: "s3", sessionDate: "2026-11-10", grade: 1 }),
        point({ id: "s2", sessionDate: "2026-10-28", grade: 1 }),
        point({ id: "s1", sessionDate: "2026-10-14", grade: 1 }),
      ],
    });
    expect(buildRecentWins([stuck])).toEqual([]);
  });

  it("decorates shared-name skills with their stroke via the catalog index", () => {
    const freeTempo = skill({
      slug: "free-tempo",
      name: "Tempo",
      current: level(3),
      history: [point({ id: "ft", sessionDate: "2026-11-10", grade: 3 })],
    });
    const backTempo = skill({
      slug: "back-tempo",
      name: "Tempo",
      current: level(3),
      history: [point({ id: "bt", sessionDate: "2026-11-10", grade: 3 })],
    });
    const catalog = new Map([
      ["free-tempo", { skillId: "ft", slug: "free-tempo", rawName: "Tempo", displayName: "Tempo (freestyle)", sentenceName: "Freestyle tempo", categoryId: "x", categoryName: "Freestyle", type: "rubric" as const, unit: null, ratedPerSide: false, parentSkillId: null }],
      ["back-tempo", { skillId: "bt", slug: "back-tempo", rawName: "Tempo", displayName: "Tempo (backstroke)", sentenceName: "Backstroke tempo", categoryId: "x", categoryName: "Backstroke", type: "rubric" as const, unit: null, ratedPerSide: false, parentSkillId: null }],
    ]);
    const wins = buildRecentWins([freeTempo, backTempo], catalog);
    // Wins use the sentence form so the stroke sits at the head of the
    // headline: "Freestyle tempo reached Competent" rather than the
    // parenthetical "Tempo (freestyle)" suffix used elsewhere.
    expect(wins.map((win) => win.headline)).toEqual([
      "Freestyle tempo reached Competent",
      "Backstroke tempo reached Competent",
    ]);
  });

  it("dedupes wins by headline — two wins never share identical copy", () => {
    // Two skills with the same raw name and NO catalog decoration; the
    // current fallback uses raw name, so both would fire the same win
    // text without the dedupe guard. Dedupe keeps the first occurrence
    // (newest-first sort → the later one).
    const tempoA = skill({
      slug: "a-tempo",
      name: "Tempo",
      current: level(3),
      history: [point({ id: "a", sessionDate: "2026-11-10", grade: 3 })],
    });
    const tempoB = skill({
      slug: "b-tempo",
      name: "Tempo",
      current: level(3),
      history: [point({ id: "b", sessionDate: "2026-11-10", grade: 3 })],
    });
    const wins = buildRecentWins([tempoA, tempoB]);
    expect(wins).toHaveLength(1);
    expect(wins[0]?.headline).toBe("Tempo reached Competent");
  });

  it("never fires a win for a level drop", () => {
    const dropper = skill({
      slug: "drop",
      name: "Drop",
      current: level(2),
      history: [
        point({ id: "d2", sessionDate: "2026-11-10", grade: 2 }),
        point({ id: "d3", sessionDate: "2026-10-28", grade: 3 }),
        point({ id: "d2b", sessionDate: "2026-10-14", grade: 2 }),
      ],
    });
    const wins = buildRecentWins([dropper]);
    // First 2 was at d2b, first 3 was at d3. Both positive events fire.
    // The regression from 3 → 2 does not fire — no "dropped" win exists.
    expect(wins.map((win) => win.headline)).toEqual([
      "Drop reached Competent",
      "Drop reached Developing",
    ]);
  });
});

// ── Summary card ────────────────────────────────────────────────────────

describe("buildSummaryCard — headline", () => {
  it("N === 0: '<Name> is getting started'", () => {
    const data = buildSummaryCard([], [], "Maya");
    expect(data.headline).toBe("Maya is getting started");
  });

  it("N === 1: singular 'skill'", () => {
    const skills = [
      skill({
        slug: "a",
        name: "A",
        current: level(3),
        history: [
          point({ id: "a3", sessionDate: "2026-11-01", grade: 3 }),
          point({ id: "a1", sessionDate: "2026-09-30", grade: 1 }),
        ],
      }),
    ];
    const data = buildSummaryCard(skills, ["2026-09-30", "2026-11-01"], "Maya");
    expect(data.headline).toBe("Maya has moved up in 1 skill");
  });

  it("N > 1: plural 'skills'", () => {
    const skills = [
      skill({
        slug: "a",
        name: "A",
        current: level(3),
        history: [point({ id: "a3", sessionDate: "2026-11-01", grade: 3 }), point({ id: "a1", sessionDate: "2026-09-30", grade: 1 })],
      }),
      skill({
        slug: "b",
        name: "B",
        current: level(4),
        history: [point({ id: "b4", sessionDate: "2026-11-01", grade: 4 }), point({ id: "b2", sessionDate: "2026-09-30", grade: 2 })],
      }),
    ];
    const data = buildSummaryCard(skills, ["2026-09-30", "2026-11-01"], "Lily");
    expect(data.headline).toBe("Lily has moved up in 2 skills");
  });

  it("counts a sided skill where the lower side improved", () => {
    // Left went 2 → 3, right went 2 → 4. Lower side first = 2 (either),
    // lower side latest = min(3, 4) = 3 → 1-grade improvement, counted.
    const breathing = skill({
      slug: "breathing",
      name: "Breathing",
      ratedPerSide: true,
      currentLeft: level(3),
      currentRight: level(4),
      history: [
        point({ id: "l-now", sessionDate: "2026-11-01", grade: 3, side: "left" }),
        point({ id: "r-now", sessionDate: "2026-11-01", grade: 4, side: "right" }),
        point({ id: "l-start", sessionDate: "2026-09-30", grade: 2, side: "left" }),
        point({ id: "r-start", sessionDate: "2026-09-30", grade: 2, side: "right" }),
      ],
    });
    const data = buildSummaryCard([breathing], ["2026-09-30", "2026-11-01"], "Maya");
    expect(data.headline).toBe("Maya has moved up in 1 skill");
  });

  it("does not count a sided skill when only the upper side improved", () => {
    // Left stayed at 2, right went 2 → 4. Lower side both ends = 2, no
    // change — the growth-edge side didn't move so the headline does
    // not credit it.
    const stuck = skill({
      slug: "stuck",
      name: "Stuck",
      ratedPerSide: true,
      currentLeft: level(2),
      currentRight: level(4),
      history: [
        point({ id: "l-now", sessionDate: "2026-11-01", grade: 2, side: "left" }),
        point({ id: "r-now", sessionDate: "2026-11-01", grade: 4, side: "right" }),
        point({ id: "l-start", sessionDate: "2026-09-30", grade: 2, side: "left" }),
        point({ id: "r-start", sessionDate: "2026-09-30", grade: 2, side: "right" }),
      ],
    });
    const data = buildSummaryCard([stuck], ["2026-09-30", "2026-11-01"], "Maya");
    expect(data.headline).toBe("Maya is getting started");
  });
});

describe("buildSummaryCard — stacked bar + screen-reader text", () => {
  it("counts current level across non-rollup rated skills, excluding DQ / NC", () => {
    const skills = [
      skill({ slug: "a", name: "A", current: level(2) }),
      skill({ slug: "b", name: "B", current: level(2) }),
      skill({ slug: "c", name: "C", current: level(4) }),
      skill({ slug: "dq", name: "DQ only", current: level(null, { notLegal: true }) }),
      skill({ slug: "nc", name: "NC only", current: level(null, { noConcept: true }) }),
      skill({ slug: "unrated", name: "Unrated" }),
    ];
    const data = buildSummaryCard(skills, ["2026-10-01"], "Maya");
    // Three counted: 2 skills at level 2, 1 skill at level 4. Others
    // excluded.
    expect(data.total).toBe(3);
    expect(data.levelCounts).toEqual([
      { level: 1, count: 0 },
      { level: 2, count: 2 },
      { level: 3, count: 0 },
      { level: 4, count: 1 },
      { level: 5, count: 0 },
    ]);
  });

  it("excludes rollup-type skills from the distribution", () => {
    const skills = [
      skill({ slug: "a", name: "A", current: level(3) }),
      { ...skill({ slug: "rollup", name: "Rollup", current: level(5) }), type: "rollup" as const },
    ];
    const data = buildSummaryCard(skills, ["2026-10-01"], "Maya");
    expect(data.total).toBe(1);
    expect(data.levelCounts[2]?.count).toBe(1);        // level 3
    expect(data.levelCounts[4]?.count).toBe(0);        // level 5 skipped
  });

  it("builds a sentence-form text alternative that lists every level", () => {
    const skills = [
      skill({ slug: "a", name: "A", current: level(2) }),
      skill({ slug: "b", name: "B", current: level(2) }),
      skill({ slug: "c", name: "C", current: level(4) }),
    ];
    const data = buildSummaryCard(skills, ["2026-10-01"], "Maya");
    expect(data.levelsScreenReaderText).toBe(
      "0 skills at Emerging, 2 at Developing, 0 at Competent, 1 at Advanced, 0 at Mastery",
    );
  });

  it("empty-state: total is 0, lesson line is null", () => {
    const data = buildSummaryCard([], [], "Maya");
    expect(data.total).toBe(0);
    expect(data.lessonLine).toBeNull();
  });

  it("formats the lesson byline with the latest date and season-start month", () => {
    const skills = [skill({ slug: "a", name: "A", current: level(3) })];
    const data = buildSummaryCard(skills, ["2026-09-30", "2026-11-17"], "Lily");
    expect(data.lessonLine).toBe("Last lesson graded Nov 17 · 2 evaluations since Sep");
  });
});

// ── Skill-row text + pips ────────────────────────────────────────────────

describe("rowChangeText", () => {
  it("'up N' when latest exceeds first", () => {
    const kick = skill({
      slug: "k",
      name: "Kick",
      current: level(4),
      history: [
        point({ id: "k4", sessionDate: "2026-11-10", grade: 4 }),
        point({ id: "k2", sessionDate: "2026-09-30", grade: 2 }),
      ],
    });
    expect(rowChangeText(kick)).toBe("up 2");
  });

  it("'holding steady' when latest equals first", () => {
    const pull = skill({
      slug: "p",
      name: "Pull",
      current: level(2),
      history: [
        point({ id: "p2", sessionDate: "2026-11-10", grade: 2 }),
        point({ id: "p2b", sessionDate: "2026-09-30", grade: 2 }),
      ],
    });
    expect(rowChangeText(pull)).toBe("holding steady");
  });

  it("'down N' when latest is lower than first", () => {
    const regressed = skill({
      slug: "r",
      name: "R",
      current: level(2),
      history: [
        point({ id: "r2", sessionDate: "2026-11-10", grade: 2 }),
        point({ id: "r4", sessionDate: "2026-09-30", grade: 4 }),
      ],
    });
    expect(rowChangeText(regressed)).toBe("down 2");
  });

  it("sided skills show left/right levels", () => {
    const sided = skill({
      slug: "s",
      name: "S",
      ratedPerSide: true,
      currentLeft: level(3),
      currentRight: level(2),
    });
    expect(rowChangeText(sided)).toBe("left 3, right 2");
  });

  it("single rating returns null (no history to compare)", () => {
    const first = skill({
      slug: "f",
      name: "F",
      current: level(3),
      history: [point({ id: "f1", sessionDate: "2026-11-10", grade: 3 })],
    });
    expect(rowChangeText(first)).toBeNull();
  });
});

describe("rowLevelLabel + rowPipCount", () => {
  it("renders the current level's name and matching pip count", () => {
    const s = skill({ slug: "s", name: "S", current: level(4) });
    expect(rowLevelLabel(s)).toBe("Advanced");
    expect(rowPipCount(s)).toBe(4);
  });

  it("DQ / NC surface as labels and no pip fill", () => {
    const dq = skill({ slug: "dq", name: "DQ", current: level(null, { notLegal: true }) });
    expect(rowLevelLabel(dq)).toBe("DQ");
    expect(rowPipCount(dq)).toBeNull();
    const nc = skill({ slug: "nc", name: "NC", current: level(null, { noConcept: true }) });
    expect(rowLevelLabel(nc)).toBe("No concept");
    expect(rowPipCount(nc)).toBeNull();
  });

  it("unrated skill reads 'Not rated' with no pip fill", () => {
    const u = skill({ slug: "u", name: "U" });
    expect(rowLevelLabel(u)).toBe("Not rated");
    expect(rowPipCount(u)).toBeNull();
  });

  it("sided skill: pip count shows the lower side (growth edge)", () => {
    const sided = skill({
      slug: "s",
      name: "S",
      ratedPerSide: true,
      currentLeft: level(4),
      currentRight: level(2),
    });
    expect(rowPipCount(sided)).toBe(2);
  });
});
