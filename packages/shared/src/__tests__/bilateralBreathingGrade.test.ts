import { describe, it, expect } from "vitest";
import { calculateBilateralBreathingGrade } from "../lib/bilateralBreathingGrade";

describe("calculateBilateralBreathingGrade", () => {
  it("returns the weaker (lower) grade when both sides are present", () => {
    expect(calculateBilateralBreathingGrade(3, 5)).toBe(3);
    expect(calculateBilateralBreathingGrade(5, 3)).toBe(3);
    expect(calculateBilateralBreathingGrade(2, 2)).toBe(2);
  });

  it("returns null when left side is not assessed", () => {
    expect(calculateBilateralBreathingGrade(null, 4)).toBeNull();
  });

  it("returns null when right side is not assessed", () => {
    expect(calculateBilateralBreathingGrade(4, null)).toBeNull();
  });

  it("returns null when both sides are not assessed", () => {
    expect(calculateBilateralBreathingGrade(null, null)).toBeNull();
  });

  it("handles grade 1 on both sides", () => {
    expect(calculateBilateralBreathingGrade(1, 1)).toBe(1);
  });

  it("handles grade 5 on both sides (mastery)", () => {
    expect(calculateBilateralBreathingGrade(5, 5)).toBe(5);
  });
});
