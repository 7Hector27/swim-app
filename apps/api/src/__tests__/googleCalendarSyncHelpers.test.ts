// Pure-function tests for the small helpers inside googleCalendarSync.
// The reconcile orchestration is covered by the integration test file —
// these verify the output shapes that reach Google (titles, location
// strings) without needing a live DB.

import { describe, expect, it } from "vitest";
import { __test } from "../services/googleCalendarSync";

const { buildSummary, formatLocation, toGoogleEventId, startOfTodayLA } = __test;

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

describe("startOfTodayLA", () => {
  // Each case passes a UTC `now` and asserts the exact UTC instant that
  // corresponds to LA midnight of that LA calendar date. DST facts:
  //   - PST = UTC-08:00 (LA midnight = 08:00 UTC same date)
  //   - PDT = UTC-07:00 (LA midnight = 07:00 UTC same date)
  //   - In 2026, DST starts Sun Mar 8 (02:00 PST → 03:00 PDT) and ends
  //     Sun Nov 1 (02:00 PDT → 01:00 PST). Both transitions happen at
  //     LA 02:00, so LA midnight on both transition dates sits on the
  //     pre-transition side (Mar 8 is PST at 00:00, Nov 1 is PDT at 00:00).
  it("PDT regular day (summer): LA midnight = 07:00 UTC", () => {
    // 2026-06-15T12:00:00Z = LA 05:00 PDT, calendar date 2026-06-15.
    const result = startOfTodayLA(new Date("2026-06-15T12:00:00Z"));
    expect(result.toISOString()).toBe("2026-06-15T07:00:00.000Z");
  });

  it("PST regular day (winter): LA midnight = 08:00 UTC", () => {
    // 2026-01-15T12:00:00Z = LA 04:00 PST, calendar date 2026-01-15.
    const result = startOfTodayLA(new Date("2026-01-15T12:00:00Z"));
    expect(result.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("DST spring-forward day (Mar 8, 2026): LA midnight = 08:00 UTC (still PST)", () => {
    // Any UTC instant on the LA calendar date of 2026-03-08 should map
    // to the same LA midnight. Check both before and after the LA 02:00
    // PST → 03:00 PDT transition (which happens at 10:00 UTC).
    const beforeSpring = startOfTodayLA(new Date("2026-03-08T09:00:00Z")); // LA 01:00 PST
    const afterSpring = startOfTodayLA(new Date("2026-03-08T11:00:00Z")); // LA 04:00 PDT
    expect(beforeSpring.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(afterSpring.toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });

  it("DST fall-back day (Nov 1, 2026): LA midnight = 07:00 UTC (still PDT)", () => {
    // DST ends at LA 02:00 PDT = 09:00 UTC. At LA midnight the offset
    // is still PDT (-07:00). Check both before and after the transition.
    const beforeFall = startOfTodayLA(new Date("2026-11-01T08:00:00Z")); // LA 01:00 PDT
    const afterFall = startOfTodayLA(new Date("2026-11-01T11:00:00Z")); // LA 03:00 PST
    expect(beforeFall.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(afterFall.toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("returns a Date whose LA wall-clock reading is 00:00 of today's LA date", () => {
    // Belt-and-suspenders: round-trip the result back through Intl in LA
    // and confirm the clock reads midnight.
    for (const now of [
      new Date("2026-01-15T12:00:00Z"),
      new Date("2026-06-15T12:00:00Z"),
      new Date("2026-03-08T09:00:00Z"),
      new Date("2026-11-01T08:00:00Z"),
    ]) {
      const laMidnight = startOfTodayLA(now);
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Los_Angeles",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(laMidnight);
      const hour = parts.find((part) => part.type === "hour")!.value;
      const minute = parts.find((part) => part.type === "minute")!.value;
      const second = parts.find((part) => part.type === "second")!.value;
      expect(`${hour}:${minute}:${second}`).toBe("00:00:00");
    }
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
