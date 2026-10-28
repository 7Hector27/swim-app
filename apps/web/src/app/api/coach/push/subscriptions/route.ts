// Thin proxy for the browser's push subscription registration. The
// service worker POSTs here same-origin (so the session cookie carries),
// and we hop the bearer token server-side to the Express API. This also
// serves the account page's "list my devices" fetch.
//
// GET → list active subscriptions for the current coach.
// POST → register / revive a subscription (idempotent).
//
// Uses getSession() only to extract the token; the Express API verifies
// it with getUser() on every request (see docs/accounts.md).

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/push/subscriptions`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const payload: unknown = await request.json().catch(() => null);
  // Node normalizes header keys to lowercase on read, so read with the
  // lowercase name once into a local. Forward with the canonical casing
  // Express expects. If the browser omitted a UA, do not add the header.
  const userAgent = request.headers.get("user-agent");
  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (userAgent) forwardHeaders["User-Agent"] = userAgent;

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/push/subscriptions`, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body: unknown =
    response.status === 201 ? null : await response.json().catch(() => null);
  if (response.status === 201) {
    return new NextResponse(null, { status: 201 });
  }
  return NextResponse.json(body, { status: response.status });
}
