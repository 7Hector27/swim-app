import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render as renderReactEmail } from "@react-email/render";

import BalanceAdjusted from "../templates/BalanceAdjusted";
import type { BalanceAdjustedEmailPayload } from "../balanceAdjustedTypes";

const BASE_PAYLOAD: BalanceAdjustedEmailPayload = {
  kind: "balance_adjusted",
  amountCents: 5_000, // $50 credit
  newBalanceCents: 15_000,
  reason: "Thanks for the referral",
  deepLink: "https://example.test/account/balance",
  coachFirstName: "Jason",
};

async function renderTemplate(
  payload: BalanceAdjustedEmailPayload,
): Promise<{ html: string; text: string }> {
  const element = BalanceAdjusted({
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

describe("BalanceAdjusted template — credit (positive amount)", () => {
  it("renders 'Jason added $X to your balance.' + new balance + reason", async () => {
    const { html, text } = await renderTemplate(BASE_PAYLOAD);
    expect(text).toMatch(/Jason added \$50\.00 to your balance\./);
    expect(text).toContain("New balance: $150.00");
    expect(text).toContain("Thanks for the referral");
    expect(html).toContain("Balance credit.");
  });

  it("subject + preview use the signed direction so the family knows credit vs debit at a glance", async () => {
    const { html } = await renderTemplate(BASE_PAYLOAD);
    expect(html).toContain("Jason added $50.00 to your balance.");
  });
});

describe("BalanceAdjusted template — debit (negative amount)", () => {
  it("renders 'Jason removed $X from your balance.' with the absolute value", async () => {
    const { html, text } = await renderTemplate({
      ...BASE_PAYLOAD,
      amountCents: -3_000,
      newBalanceCents: 7_000,
      reason: "Refund correction",
    });
    expect(text).toMatch(/Jason removed \$30\.00 from your balance\./);
    expect(text).toContain("New balance: $70.00");
    expect(text).toContain("Refund correction");
    expect(html).toContain("Balance adjustment.");
    // Never render the raw minus-prefixed amount — the sign is implicit
    // in "removed from your balance".
    expect(text).not.toContain("-$30.00");
    // Phase 7 fix 3: the stricter "debited" phrasing was replaced with
    // plain-language "removed".
    expect(text).not.toContain("debited");
  });
});

describe("BalanceAdjusted — reason is shown verbatim (with no extra PII)", () => {
  it("renders the coach's reason exactly as typed, preserving linebreaks", async () => {
    const { text } = await renderTemplate({
      ...BASE_PAYLOAD,
      reason: "Line one\nLine two",
    });
    expect(text).toContain("Line one");
    expect(text).toContain("Line two");
  });

  it("renders no swimmer names, no household name, no email addresses", async () => {
    const { html, text } = await renderTemplate(BASE_PAYLOAD);
    expect(html).not.toMatch(/Avery|Alex|Smith|Garcia|Nguyen/);
    expect(text).not.toMatch(/Avery|Alex|Smith|Garcia|Nguyen/);
    expect(text).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it("falls back to 'The coach' when coachFirstName is null — no 'undefined' leaks", async () => {
    const { html, text } = await renderTemplate({
      ...BASE_PAYLOAD,
      coachFirstName: null,
    });
    expect(html).not.toContain("undefined");
    expect(text).not.toContain("undefined");
    expect(text).toMatch(/The coach added/);
  });
});
