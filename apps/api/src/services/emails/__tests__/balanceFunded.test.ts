import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render as renderReactEmail } from "@react-email/render";

import BalanceFunded from "../templates/BalanceFunded";
import type { BalanceFundedEmailPayload } from "../balanceFundedTypes";

// The template is a pure function of its payload. Tests cover the two
// render branches (topup vs package) plus the "no PII in body copy"
// guardrail that applies to every balance-triggered email.

const BASE_PAYLOAD: BalanceFundedEmailPayload = {
  kind: "balance_funded",
  type: "topup",
  amountPaidCents: 6_000,
  bonusCents: 0,
  newBalanceCents: 18_000,
  deepLink: "https://example.test/account/balance",
  coachFirstName: "Jason",
};

async function renderTemplate(
  payload: BalanceFundedEmailPayload,
): Promise<{ html: string; text: string }> {
  const element = BalanceFunded({
    payload,
    siteUrl: "https://example.test",
    replyToEmail: null,
  });
  const [html, text] = await Promise.all([
    renderReactEmail(element),
    renderReactEmail(element, { plainText: true }),
  ]);
  return { html, text };
}

beforeEach(() => {
  process.env.SITE_URL = "https://example.test";
  process.env.NODE_ENV = "test";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T18:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BalanceFunded template — topup", () => {
  it("renders the paid amount + new balance for a straight top-up (no bonus line)", async () => {
    const { html, text } = await renderTemplate({
      ...BASE_PAYLOAD,
      type: "topup",
      amountPaidCents: 6_000,
      bonusCents: 0,
      newBalanceCents: 18_000,
    });
    expect(html).toContain("You paid");
    expect(html).toContain("$60.00");
    expect(html).toContain("New balance:");
    expect(html).toContain("$180.00");
    // No bonus line when bonusCents is zero.
    expect(html).not.toContain("Bonus credit");
    expect(text).toContain("You paid $60.00");
    expect(text).toContain("New balance: $180.00");
  });

  it("subject + preview use the TOTAL added so a top-up with bonus 0 reads as 'paid = added'", async () => {
    // Preview text is embedded in the rendered HTML as a hidden Preview
    // element — safe to assert on the HTML string.
    const { html } = await renderTemplate({
      ...BASE_PAYLOAD,
      type: "topup",
      amountPaidCents: 6_000,
      bonusCents: 0,
      newBalanceCents: 18_000,
    });
    expect(html).toContain("Added $60.00 to your balance.");
  });
});

describe("BalanceFunded template — package", () => {
  it("renders the paid amount AND the bonus credit AND the new balance", async () => {
    const { html, text } = await renderTemplate({
      ...BASE_PAYLOAD,
      type: "package",
      amountPaidCents: 108_000, // Cannonball at 1-swim rate
      bonusCents: 12_000, // 10% discount surfaces as bonus credit
      newBalanceCents: 120_000,
    });
    expect(html).toContain("You paid");
    expect(html).toContain("$1,080.00");
    expect(html).toContain("Bonus credit");
    expect(html).toContain("$120.00");
    expect(html).toContain("New balance:");
    expect(html).toContain("$1,200.00");
    expect(text).toContain("You paid $1,080.00");
    expect(text).toContain("Bonus credit: $120.00");
    expect(text).toContain("New balance: $1,200.00");
  });

  it("subject + preview reflect the TOTAL added (paid + bonus), not just the charge", async () => {
    const { html } = await renderTemplate({
      ...BASE_PAYLOAD,
      type: "package",
      amountPaidCents: 108_000,
      bonusCents: 12_000,
      newBalanceCents: 120_000,
    });
    expect(html).toContain("Added $1,200.00 to your balance.");
  });

  it("suppresses the bonus line when bonusCents is zero (fallback for configs without discount)", async () => {
    const { html } = await renderTemplate({
      ...BASE_PAYLOAD,
      type: "package",
      amountPaidCents: 108_000,
      bonusCents: 0,
      newBalanceCents: 108_000,
    });
    expect(html).not.toContain("Bonus credit");
  });
});

describe("BalanceFunded — no PII beyond what the family already gets", () => {
  it("renders no swimmer first names, no household name, no email address", async () => {
    const { html, text } = await renderTemplate({
      ...BASE_PAYLOAD,
      // The payload itself only carries the coach name + numeric amounts;
      // the template must not invent any identifying strings.
      type: "topup",
      amountPaidCents: 6_000,
      bonusCents: 0,
      newBalanceCents: 18_000,
    });
    expect(html).not.toMatch(/Avery|Alex|Smith|Garcia|Nguyen/);
    expect(text).not.toMatch(/Avery|Alex|Smith|Garcia|Nguyen/);
    expect(text).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("coach name falls back to 'The coach' when coachFirstName is null — no 'undefined' leaks", async () => {
    const { html, text } = await renderTemplate({
      ...BASE_PAYLOAD,
      coachFirstName: null,
    });
    expect(html).not.toContain("undefined");
    expect(text).not.toContain("undefined");
  });
});
