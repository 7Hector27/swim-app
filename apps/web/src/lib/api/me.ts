import { cache } from "react";

import { MeResponseSchema } from "@swim-app/shared";
import type { MeResponse } from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";
import { apiFetch } from "./apiFetch";

type MeStatusResult = { ok: true; profile: MeResponse } | { ok: false; status: number };

export type MeResult =
  | { ok: true; profile: MeResponse; accessToken: string }
  | { ok: false; status: number };

export function mapMeStatus(status: number, body: unknown): MeStatusResult {
  if (status === 200) {
    const parsed = MeResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 502 };
    return { ok: true, profile: parsed.data };
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
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    status = response.status;
    if (status === 200) {
      body = await response.json();
    }
  } catch {
    return { ok: false, status: 503 };
  }

  const result = mapMeStatus(status, body);
  if (result.ok) return { ...result, accessToken: token };
  return result;
});
