// Send a test push to the coach's active subscriptions. Called by the
// "Send test notification" button on /account.
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
  // If the proxy fetch fails (bad NEXT_PUBLIC_API_URL, DNS, dev network
  // hiccup), return a readable 502 with a reason instead of letting
  // Next.js serve its default error HTML — the client parses JSON and
  // would otherwise show an opaque "Could not send" with no detail.
  let response: Response;
  try {
    response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/push/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the push server." }, { status: 502 });
  }
  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body, { status: response.status });
}
