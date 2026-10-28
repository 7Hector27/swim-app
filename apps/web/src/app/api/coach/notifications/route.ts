// Lists the coach's in-app notifications (newest 20, unread first).
//
// This handler uses supabase.auth.getSession() to extract the access
// token from the SSR cookie — it does NOT verify the token itself. The
// Express API's requireUser middleware verifies the token with
// supabase.auth.getUser() on every request, which is the single
// source of truth for session liveness (revoked / banned / expired).
// See docs/accounts.md.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
