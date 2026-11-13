import { describe, expect, it } from "vitest";

import { balanceDisplayType } from "../lib/balanceDisplayType";
import { BalanceEntryTypeSchema } from "../schemas/payments";

describe("balanceDisplayType", () => {
  it("returns a non-empty label for every BalanceEntryType", () => {
    for (const entryType of BalanceEntryTypeSchema.options) {
      const label = balanceDisplayType({ entryType, reason: null });
      expect(label, `missing label for ${entryType}`).toBeTruthy();
      // The label must never leak the raw DB enum value — those read
      // like `cash_refund` / `balance_writeoff` and would surface in the
      // parent-facing history otherwise.
      expect(label).not.toBe(entryType);
    }
  });

  it("appends the reason for coach adjustments when present", () => {
    expect(
      balanceDisplayType({ entryType: "coach_adjustment", reason: "late cancel" }),
    ).toBe("Jason adjusted · late cancel");
    expect(
      balanceDisplayType({ entryType: "coach_adjustment", reason: null }),
    ).toBe("Jason adjusted");
  });

  it("labels cash_refund and balance_writeoff in plain language", () => {
    expect(balanceDisplayType({ entryType: "cash_refund", reason: null })).toBe(
      "Refunded to your card",
    );
    expect(
      balanceDisplayType({ entryType: "balance_writeoff", reason: null }),
    ).toBe("Unused bonus credit forfeited");
  });
});
