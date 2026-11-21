import { describe, expect, it } from "vitest";

import { buildSwimmerLabels, sortSwimmers, type DisambigSwimmer } from "@/components/SwimmerSelect";

function makeSwimmer(overrides: Partial<DisambigSwimmer> & { id: string }): DisambigSwimmer {
  return {
    firstName: "Alex",
    lastName: "Smith",
    age: 12,
    householdName: "Smith",
    birthMonthYear: "2013-01",
    ...overrides,
  };
}

describe("buildSwimmerLabels — no collision", () => {
  it("renders 'First Last · Age N' when the full name is unique", () => {
    const rows = [
      makeSwimmer({ id: "a", firstName: "Alex", lastName: "Smith", age: 12 }),
      makeSwimmer({ id: "b", firstName: "Riley", lastName: "Jones", age: 10 }),
    ];
    const labels = buildSwimmerLabels(rows);
    expect(labels.get("a")).toBe("Alex Smith · Age 12");
    expect(labels.get("b")).toBe("Riley Jones · Age 10");
  });
});

describe("buildSwimmerLabels — same first + last name", () => {
  it("adds '· <Household> family' to every clashing label when households differ", () => {
    const rows = [
      makeSwimmer({ id: "a", firstName: "Alex", lastName: "Smith", age: 12, householdName: "Garcia" }),
      makeSwimmer({ id: "b", firstName: "Alex", lastName: "Smith", age: 10, householdName: "Patel" }),
    ];
    const labels = buildSwimmerLabels(rows);
    expect(labels.get("a")).toBe("Alex Smith · Age 12 · Garcia family");
    expect(labels.get("b")).toBe("Alex Smith · Age 10 · Patel family");
  });

  it("adds birth month + year when household name ALSO collides", () => {
    const rows = [
      makeSwimmer({
        id: "a",
        firstName: "Alex",
        lastName: "Smith",
        age: 12,
        householdName: "Garcia",
        birthMonthYear: "2013-01",
      }),
      makeSwimmer({
        id: "b",
        firstName: "Alex",
        lastName: "Smith",
        age: 12,
        householdName: "Garcia",
        birthMonthYear: "2013-06",
      }),
    ];
    const labels = buildSwimmerLabels(rows);
    expect(labels.get("a")).toBe("Alex Smith · Age 12 · Garcia family · January 2013");
    expect(labels.get("b")).toBe("Alex Smith · Age 12 · Garcia family · June 2013");
  });
});

describe("sortSwimmers", () => {
  it("sorts by first name, then last name", () => {
    const rows = [
      makeSwimmer({ id: "c", firstName: "Zion", lastName: "Alvarez" }),
      makeSwimmer({ id: "a", firstName: "Alex", lastName: "Patel" }),
      makeSwimmer({ id: "b", firstName: "Alex", lastName: "Baker" }),
    ];
    const sorted = sortSwimmers(rows);
    expect(sorted.map((row) => row.id)).toEqual(["b", "a", "c"]);
  });
});
