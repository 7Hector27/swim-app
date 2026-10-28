// GET and PATCH for coach notification preferences.

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
    `${process.env.NEXT_PUBLIC_API_URL}/coach/notifications/preferences`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const payload: unknown = await request.json().catch(() => null);
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/notifications/preferences`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
