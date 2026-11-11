"use server";

import type {
  BalanceHistoryResponse,
  BalanceResponse,
  CashOutBreakdown,
  CashOutResponse,
  CoachAdjustBalanceBody,
  MarkCashRefundHandledBody,
} from "@swim-app/shared";

import {
  adjustCoachFamilyBalance,
  executeCoachFamilyCashOut,
  fetchCashOutPreview,
  fetchCoachFamilyBalance,
  fetchCoachFamilyBalanceHistory,
  markCashRefundHandled,
  type AdjustBalanceResult,
  type MarkCashRefundHandledResult,
} from "@/lib/api/coachHouseholds";
import { createClient } from "@/lib/supabase/server";

async function token(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type FamilyHistoryActionResult =
  | { ok: true; data: BalanceHistoryResponse }
  | { ok: false; message: string };

export async function fetchMoreFamilyHistoryAction(
  householdId: string,
  cursor: string,
): Promise<FamilyHistoryActionResult> {
  const t = await token();
  if (!t) return { ok: false, message: "Please sign in and try again." };
  const next = await fetchCoachFamilyBalanceHistory(
    t,
    householdId,
    cursor === "" ? undefined : cursor,
  );
  if (!next.ok) return { ok: false, message: "Could not load more history." };
  return { ok: true, data: next.data };
}

export type FamilyBalanceActionResult =
  | { ok: true; data: BalanceResponse }
  | { ok: false };

export async function refreshFamilyBalanceAction(
  householdId: string,
): Promise<FamilyBalanceActionResult> {
  const t = await token();
  if (!t) return { ok: false };
  const result = await fetchCoachFamilyBalance(t, householdId);
  if ("kind" in result) return { ok: false };
  if (!result.ok) return { ok: false };
  return { ok: true, data: result.data };
}

export async function submitCoachAdjustmentAction(
  householdId: string,
  body: CoachAdjustBalanceBody,
): Promise<AdjustBalanceResult> {
  const t = await token();
  if (!t) return { kind: "error", message: "Please sign in and try again." };
  return adjustCoachFamilyBalance(t, householdId, body);
}

// ── Cash-out (ADR 036 Phase 8 Part B) ───────────────────────────────────

export type FetchCashOutPreviewResult =
  | { ok: true; data: CashOutBreakdown }
  | { ok: false; message: string };

export async function fetchCashOutPreviewAction(
  householdId: string,
): Promise<FetchCashOutPreviewResult> {
  const t = await token();
  if (!t) return { ok: false, message: "Please sign in and try again." };
  const result = await fetchCashOutPreview(t, householdId);
  if (!result.ok) return { ok: false, message: "Could not load the refund preview." };
  return { ok: true, data: result.data };
}

export type ExecuteCashOutActionResult =
  | { ok: true; data: CashOutResponse }
  | { ok: false; message: string };

export async function executeCashOutAction(
  householdId: string,
): Promise<ExecuteCashOutActionResult> {
  const t = await token();
  if (!t) return { ok: false, message: "Please sign in and try again." };
  const result = await executeCoachFamilyCashOut(t, householdId);
  if (!result.ok) return { ok: false, message: "Could not issue the refund. Please try again." };
  return { ok: true, data: result.data };
}

export async function markCashRefundHandledAction(
  jobId: string,
  body: MarkCashRefundHandledBody,
): Promise<MarkCashRefundHandledResult> {
  const t = await token();
  if (!t) return { kind: "error", message: "Please sign in and try again." };
  return markCashRefundHandled(t, jobId, body);
}
