import { describe, it, expect } from "vitest";
import { parseSwimTime, formatSwimTime } from "../lib/swimTime";

describe("parseSwimTime", () => {
  it("parses m:ss.hh format", () => {
    expect(parseSwimTime("1:02.34")).toBe(6234);
  });
  it("parses ss.hh format", () => {
    expect(parseSwimTime("58.30")).toBe(5830);
  });
  it("parses tenths (single digit fraction)", () => {
    expect(parseSwimTime("58.3")).toBe(5830);
  });
  it("parses 0:ss.hh (zero minutes)", () => {
    expect(parseSwimTime("0:38.40")).toBe(3840);
  });
  it("parses large minute values", () => {
    expect(parseSwimTime("16:33.40")).toBe(99340);
  });
  it("returns null for invalid format", () => {
    expect(parseSwimTime("not-a-time")).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(parseSwimTime("")).toBeNull();
  });
  it("returns null when seconds >= 60 in m:ss.hh", () => {
    expect(parseSwimTime("1:60.00")).toBeNull();
  });
  it("parses exactly 59 seconds (boundary)", () => {
    expect(parseSwimTime("1:59.99")).toBe(11999);
  });
  it("returns null for malformed fraction", () => {
    expect(parseSwimTime("58.")).toBeNull();
  });
  it("returns null for single-digit seconds after colon", () => {
    expect(parseSwimTime("1:3.45")).toBeNull();
  });
});

describe("formatSwimTime", () => {
  it("formats hundredths under 60 seconds", () => {
    expect(formatSwimTime(5830)).toBe("58.30");
  });
  it("formats hundredths with minutes", () => {
    expect(formatSwimTime(6234)).toBe("1:02.34");
  });
  it("zero-pads seconds and hundredths", () => {
    expect(formatSwimTime(6000)).toBe("1:00.00");
  });
  it("formats large values", () => {
    expect(formatSwimTime(99340)).toBe("16:33.40");
  });
});
