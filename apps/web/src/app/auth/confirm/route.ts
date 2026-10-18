import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isSafeReturnTo } from "@swim-app/shared";

import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (!tokenHash || type !== "email") {
    return NextResponse.redirect(new URL("/login?notice=link-expired", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (error) {
    return NextResponse.redirect(new URL("/login?notice=link-expired", request.url));
  }

  const returnToRaw = request.nextUrl.searchParams.get("returnTo");
  if (returnToRaw && isSafeReturnTo(returnToRaw, publicEnv.siteUrl)) {
    return NextResponse.redirect(new URL(returnToRaw, publicEnv.siteUrl));
  }
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
