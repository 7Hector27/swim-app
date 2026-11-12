"use server";

import type {
  BalanceHistoryResponse,
  BalanceResponse,
  CheckoutSessionBody,
  PackageTier,
  SwimmerCount,
  LessonDurationMinutes,
} from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";
import {
  createCheckoutSession,
  fetchBalance,
  fetchBalanceHistory,
} from "@/lib/api/balance";

export type CheckoutStartResult =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string }
  // ADR 036 Phase 8 Part B Stop 3 piece 3: the API gates
  // /payments/checkout-session on current policy acceptance. The web
  // caller redirects the browser to /policy-updated?next=<current path>
  // on this kind and never surfaces an error — the parent sees the
  // re-acceptance interstitial instead.
  | { kind: "policy_acceptance_required" };

export async function startPackageCheckoutAction(
  packageTier: PackageTier,
  swimmerCount: SwimmerCount,
  successReturnTo: string = "/account/balance",
): Promise<CheckoutStartResult> {
  return startCheckoutAction({
    kind: "package",
    packageTier,
    swimmerCount,
    successReturnTo,
  });
}

export async function startLessonTopupAction(
  durationMinutes: LessonDurationMinutes,
  swimmerCount: SwimmerCount,
  successReturnTo: string = "/account/balance",
): Promise<CheckoutStartResult> {
  return startCheckoutAction({
    kind: "topup",
    lessonTopup: { durationMinutes, swimmerCount },
    successReturnTo,
  });
}

// Shared helper — passed through the public server actions above so the
// browser can call them without needing to know the CheckoutSessionBody
// shape.
async function startCheckoutAction(
  body: CheckoutSessionBody,
): Promise<CheckoutStartResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { kind: "error", message: "Please sign in and try again." };

  const result = await createCheckoutSession(token, body);
  if (!result.ok) {
    if (result.status === 409) {
      // ADR 036 Phase 8 Part B Stop 3 piece 3: the API gates
      // /payments/checkout-session on current policy acceptance. The
      // client-side caller redirects to /policy-updated instead of
      // surfacing an error.
      return { kind: "policy_acceptance_required" };
    }
    if (result.status === 503) {
      return { kind: "error", message: "Payments are temporarily unavailable. Try again in a moment." };
    }
    return { kind: "error", message: "Could not start checkout. Please try again." };
  }
  return { kind: "redirect", url: result.data.url };
}

export async function fetchMoreHistoryAction(
  cursor: string,
): Promise<{ ok: true; data: BalanceHistoryResponse } | { ok: false; message: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, message: "Please sign in and try again." };
  const page = await fetchBalanceHistory(token, cursor);
  if (!page) return { ok: false, message: "Could not load history." };
  return { ok: true, data: page };
}

export async function startBookingShortfallTopupAction(
  durationMinutes: LessonDurationMinutes,
  swimmerCount: SwimmerCount,
  returnTo: string,
): Promise<CheckoutStartResult> {
  // Same as the balance-page top-up, but returnTo points back at the
  // booking flow so the parent lands where they started. The schema
  // enforces returnTo is a relative path.
  return startCheckoutAction({
    kind: "topup",
    lessonTopup: { durationMinutes, swimmerCount },
    successReturnTo: returnTo,
  });
}

/**
 * Server-side refetch of the authoritative balance. The post-topup
 * polling on the balance page calls this every 2s for up to 10s so
 * "Your balance is refreshing" actually updates without a manual
 * reload while Stripe's webhook is settling. Returns null on any
 * error so the UI falls back to its last-known value.
 */
export async function refreshBalanceAction(): Promise<BalanceResponse | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return fetchBalance(token);
}
