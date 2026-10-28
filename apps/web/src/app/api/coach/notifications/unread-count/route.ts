// Unread count — polled every 60s by the coach dashboard bell.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/notifications/unread-count`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
