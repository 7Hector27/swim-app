// Lists the coach's in-app notifications. Query params forwarded to the
// Express handler: `order` (unread_first | chronological), `offset`,
// `limit`. Dropdown asks for unread-first with no offset; the full page
// asks for chronological with offset so Load more stays stable.
//
// This handler uses supabase.auth.getSession() to extract the access
// token from the SSR cookie: it does NOT verify the token itself. The
// Express API's requireUser middleware verifies the token with
// supabase.auth.getUser() on every request, which is the single
// source of truth for session liveness (revoked / banned / expired).
// See docs/accounts.md.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const search = request.nextUrl.searchParams.toString();
  const url = `${process.env.NEXT_PUBLIC_API_URL}/coach/notifications${search ? `?${search}` : ""}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
