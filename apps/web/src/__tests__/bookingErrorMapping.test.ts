import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createCoachLesson } from "@/lib/api/coachBooking";

// These tests verify the "map by error code, not status" rule for the
// POST /coach/lessons wrapper. A 422 with error="insufficient_balance"
// must land on the insufficient_balance kind, and a 422 with
// error="slot_unavailable" must land on slot_unavailable — regardless
// of body-shape order or extra fields.

const COACH_BODY = {
  householdId: "11111111-1111-1111-1111-111111111111",
  swimmerIds: ["22222222-2222-2222-2222-222222222222"],
  locationId: "33333333-3333-3333-3333-333333333333",
  startsAt: "2026-11-02T23:00:00.000Z",
  durationMinutes: 30 as const,
  overrideWindow: false,
  acknowledgedWarnings: {
    outsideHours: false,
    maxAdvanceExceeded: false,
    travelBufferViolated: false,
    dailyCapExceeded: false,
    blockedTimeOverlap: false,
  },
  chargeType: "balance" as const,
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
});

function mockFetchJsonOnce(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as typeof fetch;
}

describe("createCoachLesson — map by error code, not status", () => {
  it("422 + error='insufficient_balance' returns kind='insufficient_balance' with numeric fields", async () => {
    mockFetchJsonOnce(422, {
      error: "insufficient_balance",
      balanceCents: 1000,
      priceCents: 6000,
      shortfallCents: 5000,
    });
    const result = await createCoachLesson("tok", COACH_BODY);
    expect(result).toEqual({
      kind: "insufficient_balance",
      balanceCents: 1000,
      priceCents: 6000,
      shortfallCents: 5000,
    });
  });

  it("422 + error='slot_unavailable' still returns kind='slot_unavailable'", async () => {
    mockFetchJsonOnce(422, { error: "slot_unavailable" });
    const result = await createCoachLesson("tok", COACH_BODY);
    expect(result.kind).toBe("slot_unavailable");
  });

  it("422 + unknown error code falls through to a generic error (not mislabeled as slot_unavailable)", async () => {
    mockFetchJsonOnce(422, { error: "something_else" });
    const result = await createCoachLesson("tok", COACH_BODY);
    expect(result.kind).toBe("error");
  });
});
