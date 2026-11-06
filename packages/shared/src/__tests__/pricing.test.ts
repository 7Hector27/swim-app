import { describe, expect, it } from "vitest";

import {
  approximatePrivateHours,
  hourlyRateCents,
  packagePrice,
  priceForLesson,
} from "../lib/pricing";

describe("hourlyRateCents", () => {
  it("returns $120 / $180 / $198 / $216 for 1–4 swimmers", () => {
    expect(hourlyRateCents(1)).toBe(12_000);
    expect(hourlyRateCents(2)).toBe(18_000);
    expect(hourlyRateCents(3)).toBe(19_800);
    expect(hourlyRateCents(4)).toBe(21_600);
  });
});

describe("priceForLesson", () => {
  // Enumerates all 12 supported combinations of duration × swimmer count. Every
  // case must land on an integer-cent value — the only half-dollar price in the
  // system is covered explicitly in its own test below.
  const cases: Array<{ duration: 30 | 45 | 60; swimmers: 1 | 2 | 3 | 4; cents: number }> = [
    { duration: 30, swimmers: 1, cents: 6_000 },
    { duration: 30, swimmers: 2, cents: 9_000 },
    { duration: 30, swimmers: 3, cents: 9_900 },
    { duration: 30, swimmers: 4, cents: 10_800 },
    { duration: 45, swimmers: 1, cents: 9_000 },
    { duration: 45, swimmers: 2, cents: 13_500 },
    { duration: 45, swimmers: 3, cents: 14_850 },
    { duration: 45, swimmers: 4, cents: 16_200 },
    { duration: 60, swimmers: 1, cents: 12_000 },
    { duration: 60, swimmers: 2, cents: 18_000 },
    { duration: 60, swimmers: 3, cents: 19_800 },
    { duration: 60, swimmers: 4, cents: 21_600 },
  ];

  for (const { duration, swimmers, cents } of cases) {
    it(`prices a ${duration}-minute, ${swimmers}-swimmer lesson at ${cents} cents`, () => {
      expect(priceForLesson(duration, swimmers)).toBe(cents);
    });
  }

  it("is the only half-dollar combination: 3 swimmers × 45 min = $148.50", () => {
    expect(priceForLesson(45, 3)).toBe(14_850);
  });

  it("every other combination is a whole-dollar amount", () => {
    for (const { duration, swimmers, cents } of cases) {
      if (duration === 45 && swimmers === 3) continue;
      expect(cents % 100).toBe(0);
    }
  });
});

describe("packagePrice", () => {
  // All 8 package variants (2 tiers × 4 swimmer counts). Each must land on an
  // integer-cent price and bonus — there are no half-cent edge cases here
  // because the 10% / 20% discounts fall on cleanly-divisible hourly rates.
  const cases: Array<{
    tier: "cannonball" | "deep_end";
    swimmers: 1 | 2 | 3 | 4;
    creditCents: number;
    priceCents: number;
    bonusCents: number;
  }> = [
    { tier: "cannonball", swimmers: 1, creditCents: 120_000, priceCents: 108_000, bonusCents: 12_000 },
    { tier: "cannonball", swimmers: 2, creditCents: 180_000, priceCents: 162_000, bonusCents: 18_000 },
    { tier: "cannonball", swimmers: 3, creditCents: 198_000, priceCents: 178_200, bonusCents: 19_800 },
    { tier: "cannonball", swimmers: 4, creditCents: 216_000, priceCents: 194_400, bonusCents: 21_600 },
    { tier: "deep_end", swimmers: 1, creditCents: 240_000, priceCents: 192_000, bonusCents: 48_000 },
    { tier: "deep_end", swimmers: 2, creditCents: 360_000, priceCents: 288_000, bonusCents: 72_000 },
    { tier: "deep_end", swimmers: 3, creditCents: 396_000, priceCents: 316_800, bonusCents: 79_200 },
    { tier: "deep_end", swimmers: 4, creditCents: 432_000, priceCents: 345_600, bonusCents: 86_400 },
  ];

  for (const { tier, swimmers, creditCents, priceCents, bonusCents } of cases) {
    it(`${tier} for ${swimmers} swimmer(s) sells ${creditCents} credit for ${priceCents}`, () => {
      expect(packagePrice(tier, swimmers)).toEqual({ creditCents, priceCents, bonusCents });
    });
  }

  it("credit always equals price + bonus", () => {
    for (const { tier, swimmers } of cases) {
      const result = packagePrice(tier, swimmers);
      expect(result.creditCents).toBe(result.priceCents + result.bonusCents);
    }
  });

  it("cannonball discounts 10% and deep_end discounts 20%", () => {
    for (const swimmers of [1, 2, 3, 4] as const) {
      const canon = packagePrice("cannonball", swimmers);
      expect(canon.bonusCents * 10).toBe(canon.creditCents);
      const deep = packagePrice("deep_end", swimmers);
      expect(deep.bonusCents * 5).toBe(deep.creditCents);
    }
  });
});

describe("approximatePrivateHours", () => {
  it("returns 0 for a zero or negative balance", () => {
    expect(approximatePrivateHours(0)).toBe(0);
    expect(approximatePrivateHours(-100)).toBe(0);
  });

  it("floors to the nearest half-hour of a single-swimmer private lesson", () => {
    // $120 / hr = 12000 cents; $60 / half-hour = 6000 cents.
    expect(approximatePrivateHours(5_999)).toBe(0);
    expect(approximatePrivateHours(6_000)).toBe(0.5);
    expect(approximatePrivateHours(11_999)).toBe(0.5);
    expect(approximatePrivateHours(12_000)).toBe(1);
    expect(approximatePrivateHours(18_000)).toBe(1.5);
    expect(approximatePrivateHours(120_000)).toBe(10);
    // Cannonball-sized balance ($1,200) → 10 hours even.
    expect(approximatePrivateHours(120_000)).toBe(10);
    // A Deep End buyer at $2,400 credit → 20 hours even.
    expect(approximatePrivateHours(240_000)).toBe(20);
  });
});
