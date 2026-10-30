import { describe, expect, it } from "vitest";
import { realDateXFor, sessionDateToUtcMillis, stepLinePath } from "@/lib/stepChart";

describe("sessionDateToUtcMillis", () => {
  it("accepts a well-formed YYYY-MM-DD", () => {
    const noonUtc = Date.UTC(2026, 9, 14, 12);
    expect(sessionDateToUtcMillis("2026-10-14")).toBe(noonUtc);
  });

  it("rejects a truncated date string", () => {
    // Historically `Number("")` from the split silently resolved to epoch 0.
    expect(sessionDateToUtcMillis("2026-10")).toBeNull();
  });

  it("rejects an out-of-range month", () => {
    expect(sessionDateToUtcMillis("2026-13-01")).toBeNull();
  });

  it("rejects an out-of-range day", () => {
    expect(sessionDateToUtcMillis("2026-01-32")).toBeNull();
  });

  it("rejects a non-numeric component", () => {
    expect(sessionDateToUtcMillis("2026-ab-14")).toBeNull();
  });

  it("rejects a two-digit year or extra separators", () => {
    expect(sessionDateToUtcMillis("26-10-14")).toBeNull();
    expect(sessionDateToUtcMillis("2026/10/14")).toBeNull();
  });
});

describe("realDateXFor fallback behavior", () => {
  it("centers x when the date list is empty", () => {
    const map = realDateXFor([], 20, 200);
    expect(map("2026-10-14")).toBe(120);
  });

  it("centers x when every seed date fails to parse", () => {
    const map = realDateXFor(["bad", "worse"], 20, 200);
    expect(map("2026-10-14")).toBe(120);
  });

  it("centers x when the queried date fails to parse but others don't", () => {
    const map = realDateXFor(["2026-10-01", "2026-10-10"], 20, 200);
    expect(map("not-a-date")).toBe(120);
  });

  it("spaces real dates proportionally", () => {
    const map = realDateXFor(["2026-10-01", "2026-10-11"], 0, 100);
    expect(map("2026-10-01")).toBe(0);
    expect(map("2026-10-11")).toBe(100);
    expect(map("2026-10-06")).toBe(50);
  });

  it("collapses to center when all dates are equal", () => {
    const map = realDateXFor(["2026-10-01", "2026-10-01"], 10, 100);
    expect(map("2026-10-01")).toBe(60);
  });
});

describe("stepLinePath", () => {
  it("returns empty string with no points", () => {
    expect(stepLinePath([])).toBe("");
  });

  it("emits an M command for a single point", () => {
    expect(stepLinePath([{ x: 10, y: 20 }])).toBe("M 10.00 20.00");
  });

  it("emits L steps that hold y, then move y, for each subsequent point", () => {
    const path = stepLinePath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]);
    // Horizontal to the next x at the previous y, then vertical.
    expect(path).toBe("M 0.00 0.00 L 10.00 0.00 L 10.00 5.00");
  });
});
