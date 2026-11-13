import { describe, it, expect } from "vitest";

import { clampSwimmerCount } from "@/content/BookCalendarContent/helpers";

describe("clampSwimmerCount", () => {
  it("floors counts below 1 to 1", () => {
    expect(clampSwimmerCount(0)).toBe(1);
    expect(clampSwimmerCount(-5)).toBe(1);
  });

  it("caps counts above 4 to 4", () => {
    expect(clampSwimmerCount(5)).toBe(4);
    expect(clampSwimmerCount(99)).toBe(4);
  });

  it("passes 1, 2, 3, 4 through unchanged", () => {
    expect(clampSwimmerCount(1)).toBe(1);
    expect(clampSwimmerCount(2)).toBe(2);
    expect(clampSwimmerCount(3)).toBe(3);
    expect(clampSwimmerCount(4)).toBe(4);
  });
});
