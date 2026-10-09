import { vi, describe, it, expect, afterEach } from "vitest";
import { calculateAge } from "../lib/calculateAge";
import { todayLA } from "../lib/todayLA";

describe("calculateAge", () => {
  it("birthday today → exact age", () => {
    expect(calculateAge("2007-06-15", "2025-06-15")).toBe(18);
  });

  it("birthday tomorrow → still one year younger", () => {
    expect(calculateAge("2007-06-16", "2025-06-15")).toBe(17);
  });

  it("birthday already passed this year → full age", () => {
    expect(calculateAge("2007-06-14", "2025-06-15")).toBe(18);
  });

  it("handles Feb 29 birthday in non-leap year", () => {
    expect(calculateAge("2000-02-29", "2018-02-28")).toBe(17);
    expect(calculateAge("2000-02-29", "2018-03-01")).toBe(18);
  });
});

describe("calculateAge + todayLA near-midnight", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses LA date: UTC has crossed midnight but LA has not", () => {
    // 2025-01-01T07:00:00Z = Jan 1 7 AM UTC = Dec 31 11 PM LA (UTC-8)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T07:00:00Z"));
    expect(todayLA()).toBe("2024-12-31");
    // Person born 2007-01-01 turns 18 on Jan 1 LA time — not yet
    expect(calculateAge("2007-01-01", todayLA())).toBe(17);
  });

  it("uses LA date: once LA crosses midnight, birthday counts", () => {
    // 2025-01-01T09:00:00Z = Jan 1 9 AM UTC = Jan 1 1 AM LA (UTC-8)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T09:00:00Z"));
    expect(todayLA()).toBe("2025-01-01");
    expect(calculateAge("2007-01-01", todayLA())).toBe(18);
  });
});
