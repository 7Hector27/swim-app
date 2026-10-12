"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type AcceptState =
  | { status: "idle" }
  | { status: "error"; error: string; code: string };

export async function acceptInviteAction(
  token: string,
  _prev: AcceptState,
  _formData: FormData,
): Promise<AcceptState> {
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) redirect(`/login?returnTo=/invite/${token}`);

  let body: { error?: string; code?: string } = {};
  let ok = false;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/invites/${token}/accept`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    ok = response.ok;
    if (!ok) {
      body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    }
  } catch {
    return { status: "error", error: "Something went wrong. Please try again.", code: "network" };
  }

  if (ok) redirect("/dashboard");

  return {
    status: "error",
    error: body.error ?? "Something went wrong. Please try again.",
    code: body.code ?? "unknown",
  };
}
