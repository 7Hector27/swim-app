"use server";

import type { MarkCashRefundHandledBody } from "@swim-app/shared";

import {
  markCashRefundHandled,
  type MarkCashRefundHandledResult,
} from "@/lib/api/coachHouseholds";
import { createClient } from "@/lib/supabase/server";

async function token(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Clears one entry from the global "Refunds needing attention" list at
// the top of /coach/families. Shares the same route as the per-family
// banner's Mark-as-refunded action — Jason sees an identical modal on
// both surfaces.
export async function markCashRefundHandledAction(
  jobId: string,
  body: MarkCashRefundHandledBody,
): Promise<MarkCashRefundHandledResult> {
  const t = await token();
  if (!t) return { kind: "error", message: "Please sign in and try again." };
  return markCashRefundHandled(t, jobId, body);
}
