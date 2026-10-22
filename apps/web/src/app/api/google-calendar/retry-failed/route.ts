// Thin proxy for the client-side retry button. Pulls the Supabase session
// token server-side so the browser never handles it, forwards the POST to
// the API, and returns the API's status + JSON body unchanged. Mirrors the
// shape of /api/google-calendar/status.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/calendar/retry-failed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
