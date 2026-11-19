// Pass 3 — the pieces that drive the progress page's new stroke-group
// layout: buildScreenGroups (assembles the nine screens from a flat
// SkillProgress[]) and the 6-week stale rule.

import { describe, it, expect } from "vitest";
import { PROGRESS_GROUP_LABELS } from "@swim-app/shared";
import { buildScreenGroups, initialVisibleGroup } from "../lib/screenGroups";
import {
  isStaleBySessionDate,
  pointGradeNumber,
} from "../lib/progressRow";

type FakeSkill = { slug: string; name: string; ratedCount?: number };

function skill(slug: string, name = slug): FakeSkill {
  return { slug, name };
}

describe("buildScreenGroups", () => {
  it("returns nine groups in SCREEN_SLUGS order even when the swimmer has no ratings", () => {
    const groups = buildScreenGroups([] as FakeSkill[]);
    expect(groups).toHaveLength(9);
    expect(groups.map((group) => group.screenSlug)).toEqual([
      "fundamentals",
      "water-confidence",
      "freestyle",
      "backstroke",
      "breaststroke",
      "butterfly",
      "starts",
      "im-turns",
      "racing",
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      PROGRESS_GROUP_LABELS.fundamentals,
      PROGRESS_GROUP_LABELS["water-confidence"],
      PROGRESS_GROUP_LABELS.freestyle,
      PROGRESS_GROUP_LABELS.backstroke,
      PROGRESS_GROUP_LABELS.breaststroke,
      PROGRESS_GROUP_LABELS.butterfly,
      PROGRESS_GROUP_LABELS.starts,
      PROGRESS_GROUP_LABELS["im-turns"],
      PROGRESS_GROUP_LABELS.racing,
    ]);
  });

  it("surfaces a shared skill (push-off) in every group it belongs to with the same object", () => {
    const pushOff = skill("push-off", "Push-off");
    const groups = buildScreenGroups([pushOff]);
    const freestyle = groups.find((group) => group.screenSlug === "freestyle")!;
    const theWall = freestyle.sections.find((section) => section.name === "The wall")!;
    const theStart = freestyle.sections.find((section) => section.name === "Start")!;
    expect(theWall.skills[0]).toBe(pushOff);
    expect(theStart.skills[0]).toBe(pushOff);
  });

  it("returns every section in SCREEN_SECTIONS regardless of which slugs are rated — the row renderer handles unrated placeholders", () => {
    // Freestyle has seven sections (Start, Underwaters, Breakout, The
    // swim, The wall, Finish, Numbers). Rate one skill in just "The
    // swim" and all seven are still present; the row renderer in
    // StrokeGroupsPanel decides which rows to draw. Keeping empty
    // sections in the shape mirrors activeGroupSectionSlugs so the two
    // helpers can't drift.
    const groups = buildScreenGroups([skill("free-catch", "Catch")]);
    const freestyle = groups.find((group) => group.screenSlug === "freestyle")!;
    expect(freestyle.sections.map((section) => section.name)).toEqual([
      "Start",
      "Underwaters",
      "Breakout",
      "The swim",
      "The wall",
      "Finish",
      "Numbers",
    ]);
    const theSwim = freestyle.sections.find((section) => section.name === "The swim")!;
    expect(theSwim.skills.map((item) => item.slug)).toEqual(["free-catch"]);
    // Every other section resolves to zero rated skills.
    for (const section of freestyle.sections) {
      if (section.name === "The swim") continue;
      expect(section.skills).toEqual([]);
    }
  });

  it("initialVisibleGroup picks the first group with any rated skills", () => {
    // Backstroke has a rated skill; everything before it is empty.
    const groups = buildScreenGroups([skill("back-catch")]);
    expect(initialVisibleGroup(groups)).toBe("backstroke");
  });

  it("initialVisibleGroup falls back to fundamentals when nothing is rated", () => {
    expect(initialVisibleGroup(buildScreenGroups([] as FakeSkill[]))).toBe("fundamentals");
  });
});

describe("isStaleBySessionDate — 6-week rule", () => {
  const now = new Date("2026-11-20T00:00:00.000Z");

  it("returns false for an undefined date (skill never rated)", () => {
    expect(isStaleBySessionDate(undefined, now)).toBe(false);
  });

  it("returns false for a rating 41 days old (just inside the window)", () => {
    expect(isStaleBySessionDate("2026-10-10", now)).toBe(false);
  });

  it("returns true for a rating exactly 42 days old (threshold)", () => {
    expect(isStaleBySessionDate("2026-10-09", now)).toBe(true);
  });

  it("returns true for a very old rating", () => {
    expect(isStaleBySessionDate("2025-01-01", now)).toBe(true);
  });

  it("returns false when the session date is today", () => {
    expect(isStaleBySessionDate("2026-11-20", now)).toBe(false);
  });
});

describe("pointGradeNumber", () => {
  it("maps not_legal to 0 so DQ counts against an average", () => {
    expect(pointGradeNumber({ grade: null, notLegal: true, noConcept: false })).toBe(0);
  });

  it("maps no_concept to null so it's excluded from averages", () => {
    expect(pointGradeNumber({ grade: null, notLegal: false, noConcept: true })).toBeNull();
  });

  it("returns the numeric grade otherwise", () => {
    expect(pointGradeNumber({ grade: 4, notLegal: false, noConcept: false })).toBe(4);
  });
});
