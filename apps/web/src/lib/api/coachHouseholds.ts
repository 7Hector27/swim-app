import {
  BalanceHistoryResponseSchema,
  BalanceResponseSchema,
  CashOutBreakdownSchema,
  CashOutResponseSchema,
  CashRefundNeedsAttentionResponseSchema,
  CoachAdjustBalanceResponseSchema,
  CoachHouseholdBalanceListResponseSchema,
  NeedsManualRefundListResponseSchema,
  type BalanceHistoryResponse,
  type BalanceResponse,
  type CashOutBreakdown,
  type CashOutResponse,
  type CashRefundNeedsAttentionResponse,
  type CoachAdjustBalanceBody,
  type CoachAdjustBalanceResponse,
  type CoachHouseholdBalanceListResponse,
  type MarkCashRefundHandledBody,
  type NeedsManualRefundListResponse,
} from "@swim-app/shared";

import { loadError, loadOk, type LoadResult } from "@/lib/loadResult";

export async function fetchCoachFamilies(
  accessToken: string,
): Promise<LoadResult<CoachHouseholdBalanceListResponse>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/balances`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachHouseholdBalanceListResponseSchema.safeParse(body);
    if (!parsed.success) {
      console.warn(
        "fetchCoachFamilies: response did not match CoachHouseholdBalanceListResponseSchema",
      );
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchCoachFamilyBalance(
  accessToken: string,
  householdId: string,
): Promise<LoadResult<BalanceResponse> | { kind: "not_found" }> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/${householdId}/balance`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = BalanceResponseSchema.safeParse(body);
    if (!parsed.success) return loadError("schema");
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchCoachFamilyBalanceHistory(
  accessToken: string,
  householdId: string,
  cursor?: string,
): Promise<LoadResult<BalanceHistoryResponse>> {
  try {
    const url = new URL(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/${householdId}/balance/history`,
    );
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = BalanceHistoryResponseSchema.safeParse(body);
    if (!parsed.success) return loadError("schema");
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

// POST /coach/households/:id/balance/adjust — surfaces the 422
// insufficient_balance body separately so the UI can show the shortfall
// without re-parsing the generic error branch.
export type AdjustBalanceResult =
  | { kind: "ok"; data: CoachAdjustBalanceResponse }
  | {
      kind: "insufficient_balance";
      balanceCents: number;
      priceCents: number;
      shortfallCents: number;
    }
  | { kind: "error"; message: string };

export async function adjustCoachFamilyBalance(
  accessToken: string,
  householdId: string,
  body: CoachAdjustBalanceBody,
): Promise<AdjustBalanceResult> {
  let status = 0;
  let responseBody: unknown = null;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/${householdId}/balance/adjust`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );
    status = response.status;
    try {
      responseBody = await response.json();
    } catch {
      // non-JSON body
    }
  } catch {
    return { kind: "error", message: "Could not reach the server. Please try again." };
  }

  if (status === 201) {
    const parsed = CoachAdjustBalanceResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      return { kind: "error", message: "Unexpected response from server." };
    }
    return { kind: "ok", data: parsed.data };
  }
  if (
    status === 422 &&
    typeof responseBody === "object" &&
    responseBody !== null &&
    (responseBody as { error?: unknown }).error === "insufficient_balance" &&
    typeof (responseBody as { balanceCents?: unknown }).balanceCents === "number" &&
    typeof (responseBody as { priceCents?: unknown }).priceCents === "number" &&
    typeof (responseBody as { shortfallCents?: unknown }).shortfallCents === "number"
  ) {
    const typed = responseBody as {
      balanceCents: number;
      priceCents: number;
      shortfallCents: number;
    };
    return {
      kind: "insufficient_balance",
      balanceCents: typed.balanceCents,
      priceCents: typed.priceCents,
      shortfallCents: typed.shortfallCents,
    };
  }
  return { kind: "error", message: "Could not adjust the balance. Please try again." };
}

// GET /coach/households/:id/balance/cash-out/preview — read-only
// breakdown shown in the refund-leftover modal step one.
export async function fetchCashOutPreview(
  accessToken: string,
  householdId: string,
): Promise<LoadResult<CashOutBreakdown>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/${householdId}/balance/cash-out/preview`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CashOutBreakdownSchema.safeParse(body);
    if (!parsed.success) return loadError("schema");
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

// POST /coach/households/:id/balance/cash-out — executes the refund +
// write-off, returns the breakdown and refund-job summary.
export async function executeCoachFamilyCashOut(
  accessToken: string,
  householdId: string,
): Promise<LoadResult<CashOutResponse>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/${householdId}/balance/cash-out`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CashOutResponseSchema.safeParse(body);
    if (!parsed.success) return loadError("schema");
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

// GET /coach/households/:id/needs-manual-refund — pending needs-manual-
// handling jobs for the one family (powers the family-page banner).
export async function fetchCoachFamilyNeedsManualRefund(
  accessToken: string,
  householdId: string,
): Promise<LoadResult<NeedsManualRefundListResponse>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households/${householdId}/needs-manual-refund`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = NeedsManualRefundListResponseSchema.safeParse(body);
    if (!parsed.success) return loadError("schema");
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

// GET /coach/cash-refunds/needs-attention — global list powering the
// attention section at the top of /coach/families.
export async function fetchCoachNeedsAttention(
  accessToken: string,
): Promise<LoadResult<CashRefundNeedsAttentionResponse>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/cash-refunds/needs-attention`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CashRefundNeedsAttentionResponseSchema.safeParse(body);
    if (!parsed.success) return loadError("schema");
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

// POST /coach/cash-refund-jobs/:jobId/mark-refunded — Jason types a note
// after settling a needs-manual-handling job off platform.
export type MarkCashRefundHandledResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "invalid_state" }
  | { kind: "error"; message: string };

export async function markCashRefundHandled(
  accessToken: string,
  jobId: string,
  body: MarkCashRefundHandledBody,
): Promise<MarkCashRefundHandledResult> {
  let status = 0;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/cash-refund-jobs/${jobId}/mark-refunded`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );
    status = response.status;
  } catch {
    return { kind: "error", message: "Could not reach the server. Please try again." };
  }
  if (status === 200) return { kind: "ok" };
  if (status === 404) return { kind: "not_found" };
  if (status === 422) return { kind: "invalid_state" };
  return { kind: "error", message: "Could not mark this refund as handled. Please try again." };
}
