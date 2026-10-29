import { describe, it, expect } from "vitest";
import {
  parseSwimTime,
  formatSwimTime,
  parseDigitsToSwimTime,
  deviationFromBest,
} from "../lib/swimTime";

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

describe("parseDigitsToSwimTime", () => {
  it("fills SS.HH from four digits", () => {
    expect(parseDigitsToSwimTime("3215")).toEqual({
      timeString: "32.15",
      timeHundredths: 3215,
    });
  });

  it("fills M:SS.HH from five digits", () => {
    expect(parseDigitsToSwimTime("10234")).toEqual({
      timeString: "1:02.34",
      timeHundredths: 6234,
    });
  });

  it("fills M:SS.HH from six digits (multi-digit minutes)", () => {
    expect(parseDigitsToSwimTime("163340")).toEqual({
      timeString: "16:33.40",
      timeHundredths: 99340,
    });
  });

  it("fills short input (3 digits -> single-digit seconds)", () => {
    expect(parseDigitsToSwimTime("123")).toEqual({
      timeString: "01.23",
      timeHundredths: 123,
    });
  });

  it("fills very short input by padding to hundredths", () => {
    expect(parseDigitsToSwimTime("5")).toEqual({
      timeString: "00.05",
      timeHundredths: 5,
    });
  });

  it("rejects seconds >= 60", () => {
    // "6000" would read as 60.00 → invalid
    expect(parseDigitsToSwimTime("6000")).toBeNull();
  });

  it("rejects non-digit input", () => {
    expect(parseDigitsToSwimTime("1:02.34")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseDigitsToSwimTime("")).toBeNull();
  });

  it("handles leading zeros", () => {
    expect(parseDigitsToSwimTime("00012")).toEqual({
      timeString: "00.12",
      timeHundredths: 12,
    });
  });
});

describe("deviationFromBest", () => {
  it("returns 0 when times are equal", () => {
    expect(deviationFromBest(5000, 5000)).toBe(0);
  });

  it("returns positive for a slower time", () => {
    // 5500 vs 5000 => 10% slower
    expect(deviationFromBest(5500, 5000)).toBeCloseTo(0.1, 5);
  });

  it("returns negative for a faster time", () => {
    // 4500 vs 5000 => 10% faster
    expect(deviationFromBest(4500, 5000)).toBeCloseTo(-0.1, 5);
  });

  it("crosses the 20% faster threshold", () => {
    // 3999 vs 5000 => 20.02% faster
    expect(deviationFromBest(3999, 5000)).toBeLessThan(-0.2);
  });

  it("crosses the 20% slower threshold", () => {
    // 6001 vs 5000 => 20.02% slower
    expect(deviationFromBest(6001, 5000)).toBeGreaterThan(0.2);
  });

  it("returns 0 when reference is 0 (avoids divide-by-zero)", () => {
    expect(deviationFromBest(5000, 0)).toBe(0);
  });
});
