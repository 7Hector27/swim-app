import { describe, it, expect } from "vitest";
import { dstStartDate } from "../lib/availabilityWarnings";

describe("dstStartDate (second Sunday of March)", () => {
  it("returns 2024-03-10 for 2024", () => {
    expect(dstStartDate(2024)).toBe("2024-03-10");
  });

  it("returns 2025-03-09 for 2025", () => {
    expect(dstStartDate(2025)).toBe("2025-03-09");
  });

  it("returns 2026-03-08 for 2026", () => {
    expect(dstStartDate(2026)).toBe("2026-03-08");
  });

  it("returns 2027-03-14 for 2027", () => {
    expect(dstStartDate(2027)).toBe("2027-03-14");
  });
});
