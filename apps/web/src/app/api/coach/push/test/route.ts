// Send a test push to the coach's active subscriptions. Called by the
// "Send test notification" button on /account.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/push/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
