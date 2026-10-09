import { describe, it, expect } from "vitest";
import { calculateAge } from "@swim-app/shared";

describe("calculateAge", () => {
  it("returns the correct age when today is the birthday", () => {
    expect(calculateAge("2000-03-10", "2025-03-10")).toBe(25);
  });

  it("returns 17 the day before turning 18", () => {
    expect(calculateAge("2007-03-11", "2025-03-10")).toBe(17);
  });

  it("returns 18 on the 18th birthday", () => {
    expect(calculateAge("2007-03-10", "2025-03-10")).toBe(18);
  });

  it("handles a Feb 29 birthday correctly in non-leap years", () => {
    // Feb 28 of the 18th year: birthday hasn't occurred yet
    expect(calculateAge("2000-02-29", "2018-02-28")).toBe(17);
    // March 1 of the 18th year: birthday has passed
    expect(calculateAge("2000-02-29", "2018-03-01")).toBe(18);
  });

  it("result does not depend on the server's time zone", () => {
    // Pure string arithmetic — no Date objects are created, so server TZ has no effect.
    // A UTC clock at midnight on 2025-06-14 would show Jun 13 in LA, but this
    // function always returns the same value for the same string inputs.
    expect(calculateAge("2007-06-14", "2025-06-13")).toBe(17);
    expect(calculateAge("2007-06-14", "2025-06-14")).toBe(18);
  });
});
