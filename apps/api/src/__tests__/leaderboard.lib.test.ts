import { describe, it, expect } from "vitest";
import {
  applyFilters,
  assignRanks,
  assignMasterRanks,
  highestStandard,
  type RawPb,
  type RawStandard,
} from "../lib/leaderboard";
import type { AgeGroup } from "@swim-app/shared";

// ── Shared fixtures ───────────────────────────────────────────────────────────

function pb(overrides: Partial<RawPb> = {}): RawPb {
  return {
    swimmerId: "swimmer-1",
    eventDistance: 100,
    eventStroke: "free",
    course: "scy",
    timeHundredths: 5000,
    ...overrides,
  };
}

function standard(overrides: Partial<RawStandard> = {}): RawStandard {
  return {
    standardName: "B",
    eventDistance: 100,
    eventStroke: "free",
    course: "scy",
    sex: "female",
    ageGroup: "9-10",
    cutTimeHundredths: 6000,
    ...overrides,
  };
}

type Row = {
  swimmerId: string;
  sex: string;
  ageGroup: AgeGroup;
  eventDistance: number;
  eventStroke: string;
  course: string;
  timeHundredths: number;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    swimmerId: "swimmer-1",
    sex: "female",
    ageGroup: "9-10",
    eventDistance: 100,
    eventStroke: "free",
    course: "scy",
    timeHundredths: 5000,
    ...overrides,
  };
}

// ── applyFilters ──────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  it("returns all rows when query has no filters", () => {
    const rows = [row(), row({ swimmerId: "swimmer-2", sex: "male" })];
    expect(applyFilters(rows, {})).toHaveLength(2);
  });

  it("filters by sex", () => {
    const rows = [row({ sex: "female" }), row({ swimmerId: "swimmer-2", sex: "male" })];
    const result = applyFilters(rows, { sex: "female" });
    expect(result).toHaveLength(1);
    expect(result[0]!.sex).toBe("female");
  });

  it("filters by ageGroup", () => {
    const rows = [row({ ageGroup: "9-10" }), row({ swimmerId: "swimmer-2", ageGroup: "11-12" })];
    const result = applyFilters(rows, { ageGroup: "9-10" });
    expect(result).toHaveLength(1);
    expect(result[0]!.ageGroup).toBe("9-10");
  });

  it("filters by eventDistance", () => {
    const rows = [row({ eventDistance: 100 }), row({ swimmerId: "swimmer-2", eventDistance: 200 })];
    expect(applyFilters(rows, { eventDistance: 100 })).toHaveLength(1);
  });

  it("filters by eventStroke", () => {
    const rows = [row({ eventStroke: "free" }), row({ swimmerId: "swimmer-2", eventStroke: "back" })];
    expect(applyFilters(rows, { eventStroke: "free" })).toHaveLength(1);
  });

  it("filters by course", () => {
    const rows = [row({ course: "scy" }), row({ swimmerId: "swimmer-2", course: "lcm" })];
    expect(applyFilters(rows, { course: "scy" })).toHaveLength(1);
  });

  it("applies multiple filters together", () => {
    const rows = [
      row({ sex: "female", ageGroup: "9-10", course: "scy" }),
      row({ swimmerId: "swimmer-2", sex: "female", ageGroup: "11-12", course: "scy" }),
      row({ swimmerId: "swimmer-3", sex: "male", ageGroup: "9-10", course: "scy" }),
    ];
    const result = applyFilters(rows, { sex: "female", ageGroup: "9-10", course: "scy" });
    expect(result).toHaveLength(1);
    expect(result[0]!.swimmerId).toBe("swimmer-1");
  });
});

// ── assignRanks ───────────────────────────────────────────────────────────────

describe("assignRanks", () => {
  it("assigns rank 1 to a single swimmer", () => {
    const [result] = assignRanks([row()]);
    expect(result!.rank).toBe(1);
  });

  it("ranks by time ascending within a partition", () => {
    const rows = [
      row({ swimmerId: "swimmer-1", timeHundredths: 5100 }),
      row({ swimmerId: "swimmer-2", timeHundredths: 4900 }),
    ];
    const ranked = assignRanks(rows);
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["swimmer-1"]).toBe(2);
    expect(byId["swimmer-2"]).toBe(1);
  });

  it("ties share a rank and the next rank is skipped (1,1,3)", () => {
    const rows = [
      row({ swimmerId: "swimmer-1", timeHundredths: 5000 }),
      row({ swimmerId: "swimmer-2", timeHundredths: 5000 }),
      row({ swimmerId: "swimmer-3", timeHundredths: 5100 }),
    ];
    const ranked = assignRanks(rows);
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["swimmer-1"]).toBe(1);
    expect(byId["swimmer-2"]).toBe(1);
    expect(byId["swimmer-3"]).toBe(3);
  });

  it("partitions by (sex, ageGroup, eventDistance, eventStroke, course)", () => {
    const rows = [
      row({ swimmerId: "f-9-100", sex: "female", ageGroup: "9-10", eventDistance: 100, timeHundredths: 5000 }),
      row({ swimmerId: "m-9-100", sex: "male", ageGroup: "9-10", eventDistance: 100, timeHundredths: 4000 }),
    ];
    const ranked = assignRanks(rows);
    // Both rank 1 — they are in different partitions (female vs male)
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["f-9-100"]).toBe(1);
    expect(byId["m-9-100"]).toBe(1);
  });
});

// ── assignMasterRanks ─────────────────────────────────────────────────────────

describe("assignMasterRanks", () => {
  type MasterRow = Row & { standard: "B" | "BB" | "A" | "AA" | "AAA" | "AAAA" };

  function masterRow(overrides: Partial<MasterRow> = {}): MasterRow {
    return { ...row(), standard: "B", ...overrides };
  }

  it("higher standard ranks above lower standard", () => {
    const rows = [
      masterRow({ swimmerId: "swimmer-1", standard: "B", timeHundredths: 5000 }),
      masterRow({ swimmerId: "swimmer-2", standard: "AA", timeHundredths: 5200 }),
    ];
    const ranked = assignMasterRanks(rows);
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["swimmer-2"]).toBe(1); // AA > B
    expect(byId["swimmer-1"]).toBe(2);
  });

  it("within the same standard, faster time ranks higher", () => {
    const rows = [
      masterRow({ swimmerId: "swimmer-1", standard: "A", timeHundredths: 5100 }),
      masterRow({ swimmerId: "swimmer-2", standard: "A", timeHundredths: 4900 }),
    ];
    const ranked = assignMasterRanks(rows);
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["swimmer-2"]).toBe(1);
    expect(byId["swimmer-1"]).toBe(2);
  });

  it("ties on standard + time share a rank and the next rank is skipped", () => {
    const rows = [
      masterRow({ swimmerId: "swimmer-1", standard: "BB", timeHundredths: 5000 }),
      masterRow({ swimmerId: "swimmer-2", standard: "BB", timeHundredths: 5000 }),
      masterRow({ swimmerId: "swimmer-3", standard: "BB", timeHundredths: 5100 }),
    ];
    const ranked = assignMasterRanks(rows);
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["swimmer-1"]).toBe(1);
    expect(byId["swimmer-2"]).toBe(1);
    expect(byId["swimmer-3"]).toBe(3);
  });

  it("same standard but different times are not tied", () => {
    const rows = [
      masterRow({ swimmerId: "swimmer-1", standard: "AAA", timeHundredths: 4800 }),
      masterRow({ swimmerId: "swimmer-2", standard: "AAA", timeHundredths: 4900 }),
    ];
    const ranked = assignMasterRanks(rows);
    const byId = Object.fromEntries(ranked.map((r) => [r.swimmerId, r.rank]));
    expect(byId["swimmer-1"]).toBe(1);
    expect(byId["swimmer-2"]).toBe(2);
  });
});

// ── highestStandard ───────────────────────────────────────────────────────────

describe("highestStandard", () => {
  const thisPb = pb({ timeHundredths: 5000 });

  it("returns null when no standards exist", () => {
    expect(highestStandard(thisPb, "female", "9-10", [])).toBeNull();
  });

  it("returns null when time does not meet the cut", () => {
    const standards = [standard({ cutTimeHundredths: 4000 })]; // must be <= 4000
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBeNull();
  });

  it("returns the standard when time meets the cut exactly", () => {
    const standards = [standard({ standardName: "A", cutTimeHundredths: 5000 })];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBe("A");
  });

  it("returns the standard when time is faster than the cut", () => {
    const standards = [standard({ standardName: "B", cutTimeHundredths: 6000 })];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBe("B");
  });

  it("returns the highest qualifying standard when multiple apply", () => {
    const standards = [
      standard({ standardName: "B", cutTimeHundredths: 6000 }),
      standard({ standardName: "BB", cutTimeHundredths: 5500 }),
      standard({ standardName: "A", cutTimeHundredths: 5000 }),
      standard({ standardName: "AA", cutTimeHundredths: 4800 }), // too fast, doesn't qualify
    ];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBe("A");
  });

  it("ignores standards for a different sex", () => {
    const standards = [standard({ sex: "male", cutTimeHundredths: 6000 })];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBeNull();
  });

  it("ignores standards for a different age group", () => {
    const standards = [standard({ ageGroup: "11-12", cutTimeHundredths: 6000 })];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBeNull();
  });

  it("ignores standards for a different event", () => {
    const standards = [standard({ eventDistance: 200, cutTimeHundredths: 6000 })];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBeNull();
  });

  it("ignores standards for a different course", () => {
    const standards = [standard({ course: "lcm", cutTimeHundredths: 6000 })];
    expect(highestStandard(thisPb, "female", "9-10", standards)).toBeNull();
  });
});
