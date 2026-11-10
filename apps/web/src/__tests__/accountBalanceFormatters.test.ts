import { describe, it, expect } from "vitest";

import {
  formatApproxHours,
  formatDollars,
  formatSignedDollars,
} from "@/content/AccountBalanceContent/formatters";

describe("formatDollars", () => {
  it("formats zero as $0.00", () => {
    expect(formatDollars(0)).toBe("$0.00");
  });

  it("pads the cents portion to two digits", () => {
    expect(formatDollars(5)).toBe("$0.05");
    expect(formatDollars(60)).toBe("$0.60");
    expect(formatDollars(600)).toBe("$6.00");
  });

  it("thousand-separates the dollars portion", () => {
    expect(formatDollars(120_000)).toBe("$1,200.00");
    expect(formatDollars(1_234_567)).toBe("$12,345.67");
  });

  it("prefixes a minus sign on negative amounts", () => {
    expect(formatDollars(-6_000)).toBe("-$60.00");
  });
});

describe("formatSignedDollars", () => {
  it("prefixes + on positive amounts (money arriving)", () => {
    expect(formatSignedDollars(10_800)).toBe("+$108.00");
  });

  it("formats negative amounts with the minus sign from formatDollars", () => {
    expect(formatSignedDollars(-6_000)).toBe("-$60.00");
  });

  it("renders zero without a sign", () => {
    expect(formatSignedDollars(0)).toBe("$0.00");
  });

  it("makes a package_purchase look like money arriving (positive, +)", () => {
    // Regression guard: a package_purchase row's amount_cents is positive
    // (the balance credit), so the history row shows +$X.XX — never -$X.XX.
    const packagePurchaseCents = 10_800;
    expect(formatSignedDollars(packagePurchaseCents).startsWith("+$")).toBe(true);
  });
});

describe("formatApproxHours", () => {
  it("renders 0 as '≈ 0 hours'", () => {
    expect(formatApproxHours(0)).toBe("≈ 0 hours");
  });

  it("uses singular 'hour' at exactly 1", () => {
    expect(formatApproxHours(1)).toBe("≈ 1 hour");
  });

  it("renders whole numbers without a decimal", () => {
    expect(formatApproxHours(3)).toBe("≈ 3 hours");
  });

  it("renders halves with one decimal place", () => {
    expect(formatApproxHours(3.5)).toBe("≈ 3.5 hours");
  });
});
