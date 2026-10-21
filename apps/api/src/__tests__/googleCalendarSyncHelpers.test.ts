// Pure-function tests for the small helpers inside googleCalendarSync.
// The reconcile orchestration is covered by the integration test file —
// these verify the output shapes that reach Google (titles, location
// strings) without needing a live DB.

import { describe, expect, it } from "vitest";
import { __test } from "../services/googleCalendarSync";

const { buildSummary, formatLocation, toGoogleEventId } = __test;

type LessonLocation = Parameters<typeof formatLocation>[0];

function namedPool(overrides: Partial<LessonLocation> = {}): LessonLocation {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Rose Bowl Aquatics",
    address: "360 N Arroyo Blvd",
    city: "Pasadena",
    state: "CA",
    zip: "91103",
    householdId: null,
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LessonLocation;
}

function homePool(overrides: Partial<LessonLocation> = {}): LessonLocation {
  return namedPool({
    name: "Smith home pool",
    address: "123 Private Lane",
    city: "Pasadena",
    state: "CA",
    zip: "91103",
    householdId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  });
}

describe("formatLocation", () => {
  it("includes the full street address for named pools (public venues)", () => {
    const out = formatLocation(namedPool());
    expect(out).toBe("Rose Bowl Aquatics — 360 N Arroyo Blvd, Pasadena, CA 91103");
  });

  it("drops the street address for home pools and keeps only city + state", () => {
    const out = formatLocation(homePool());
    expect(out).toBe("Smith home pool — Pasadena, CA");
    expect(out).not.toContain("123 Private Lane");
    expect(out).not.toContain("91103");
  });

  it("home-pool rule triggers on any non-null householdId regardless of value", () => {
    const out = formatLocation(homePool({ householdId: "99999999-9999-9999-9999-999999999999" }));
    expect(out).not.toContain("123 Private Lane");
  });
});

describe("buildSummary", () => {
  it("single swimmer", () => {
    expect(buildSummary(["Alex"])).toBe("Swim lesson: Alex");
  });
  it("two swimmers uses ampersand", () => {
    expect(buildSummary(["Alex", "Mia"])).toBe("Swim lesson: Alex & Mia");
  });
  it("three or more swimmers uses commas plus a trailing ampersand", () => {
    expect(buildSummary(["Alex", "Mia", "Sam"])).toBe("Swim lesson: Alex, Mia & Sam");
  });
  it("falls back to plain 'Swim lesson' with no swimmers", () => {
    expect(buildSummary([])).toBe("Swim lesson");
  });
});

describe("toGoogleEventId", () => {
  it("strips dashes and lowercases the UUID", () => {
    expect(toGoogleEventId("ABCDEF01-2345-6789-ABCD-EF0123456789")).toBe(
      "abcdef0123456789abcdef0123456789",
    );
    expect(toGoogleEventId("abcdef01-2345-6789-abcd-ef0123456789")).toBe(
      "abcdef0123456789abcdef0123456789",
    );
  });
});
