// Marks every unread notification as read for the current coach.
//
// Uses getSession() only to extract the token; the Express API verifies
// it with getUser() on every request (see docs/accounts.md).

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/notifications/read-all`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
