import { cache } from "react";

import { MeResponseSchema } from "@swim-app/shared";
import type { MeResponse } from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";

type MeStatusResult =
  | { ok: true; profile: MeResponse }
  | { ok: false; status: number; errorCode?: string };

export type MeResult =
  | { ok: true; profile: MeResponse; accessToken: string }
  | { ok: false; status: number; errorCode?: string };

export function mapMeStatus(status: number, body: unknown): MeStatusResult {
  if (status === 200) {
    const parsed = MeResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 502 };
    return { ok: true, profile: parsed.data };
  }
  // 403 bodies carry an `error` code the UI needs to branch on — currently
  // "email_not_confirmed" (requireUser gate per ADR audit item 10) vs. the
  // generic "Forbidden" for missing-profile / age-not-attested. Surface it
  // as errorCode so requireAuth can route accordingly.
  if (status === 403 && typeof body === "object" && body !== null) {
    const errorField = (body as { error?: unknown }).error;
    if (typeof errorField === "string") {
      return { ok: false, status, errorCode: errorField };
    }
  }
  return { ok: false, status };
}

export const fetchMe = cache(async function fetchMe(): Promise<MeResult> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, status: 401 };

  let status: number;
  let body: unknown = null;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    status = response.status;
    if (status === 200 || status === 403) {
      // 403s carry an `error` code body (see mapMeStatus). Reading it on
      // non-200 is cheap and safe; the same clone / json() path handles
      // both success and the typed-error case.
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
  } catch {
    return { ok: false, status: 503 };
  }

  const result = mapMeStatus(status, body);
  if (result.ok) return { ...result, accessToken: token };
  return result;
});
