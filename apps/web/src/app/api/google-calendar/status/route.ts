// Thin Next.js API route that proxies the client-side polling to the API,
// pulling the current user's Supabase session token server-side so the
// browser never has to handle it. Used by GoogleCalendarCard's syncing
// banner to poll every 3s during a backfill.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/calendar/status`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = response.status === 200 ? await response.json() : null;
  return NextResponse.json(body, { status: response.status });
}
