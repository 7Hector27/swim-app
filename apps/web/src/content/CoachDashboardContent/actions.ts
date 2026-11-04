"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchCoachSchedule } from "@/lib/api/lessons";
import type { CoachScheduleItem } from "@swim-app/shared";

export type GetCoachScheduleResult =
  | { ok: true; items: CoachScheduleItem[] }
  | { ok: false; error: string };

export async function getCoachScheduleAction(date: string): Promise<GetCoachScheduleResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Session expired. Please sign in again." };
  try {
    const result = await fetchCoachSchedule(token, date);
    if (!result.ok) {
      return { ok: false, error: "Could not load schedule. Please try again." };
    }
    return { ok: true, items: result.data };
  } catch {
    return { ok: false, error: "Could not load schedule. Please try again." };
  }
}
