import { apiFetch } from "./apiFetch";

import {
  AvailabilityConfigSchema,
  AvailabilityOverrideSchema,
  AvailabilityPreviewResponseSchema,
  BlockedTimeSchema,
  CopyNextYearResponseSchema,
  OverrideDeleteResponseSchema,
  OverrideMutationResponseSchema,
  SeasonDeleteResponseSchema,
  SeasonMutationResponseSchema,
  SeasonWithIsCurrentSchema,
  type AvailabilityConfig,
  type AvailabilityOverride,
  type AvailabilityPreviewResponse,
  type BlockedTime,
  type CopyNextYearResponse,
  type CreateOverrideBody,
  type CreateSeasonBody,
  type OverrideDeleteResponse,
  type OverrideMutationResponse,
  type PatchAvailabilityConfigBody,
  type PatchOverrideBody,
  type PatchSeasonBody,
  type SeasonDeleteResponse,
  type SeasonMutationResponse,
  type SeasonWithIsCurrent,
} from "@swim-app/shared";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code?: string; conflictingSeasonName?: string };

async function parseError(response: Response): Promise<{ status: number; code?: string; conflictingSeasonName?: string }> {
  try {
    const body: unknown = await response.json();
    const b = body as { error?: unknown; conflictingSeasonName?: unknown } | null;
    const code = typeof b?.error === "string" ? b.error : undefined;
    const conflictingSeasonName = typeof b?.conflictingSeasonName === "string" ? b.conflictingSeasonName : undefined;
    if (code !== undefined) return { status: response.status, code, ...(conflictingSeasonName !== undefined && { conflictingSeasonName }) };
  } catch {
    // non-JSON body
  }
  return { status: response.status };
}

function authHeaders(accessToken: string, json = false): HeadersInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

// ── Availability config (default hours) ──────────────────────────────────────

export async function fetchAvailabilityConfig(
  accessToken: string,
): Promise<AvailabilityConfig | null> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/availability-config`,
      { headers: authHeaders(accessToken), cache: "no-store" },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = AvailabilityConfigSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function patchAvailabilityConfig(
  accessToken: string,
  body: PatchAvailabilityConfigBody,
): Promise<ApiResult<AvailabilityConfig>> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/availability-config`,
      {
        method: "PATCH",
        headers: authHeaders(accessToken, true),
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = AvailabilityConfigSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ── Seasons ──────────────────────────────────────────────────────────────────

export async function fetchSeasons(accessToken: string): Promise<SeasonWithIsCurrent[]> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/seasons`, {
      headers: authHeaders(accessToken),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = SeasonWithIsCurrentSchema.array().safeParse(body);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export async function createSeason(
  accessToken: string,
  body: CreateSeasonBody,
): Promise<ApiResult<SeasonMutationResponse>> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/seasons`, {
      method: "POST",
      headers: authHeaders(accessToken, true),
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = SeasonMutationResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function patchSeason(
  accessToken: string,
  id: string,
  body: PatchSeasonBody,
): Promise<ApiResult<SeasonMutationResponse>> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/seasons/${id}`, {
      method: "PATCH",
      headers: authHeaders(accessToken, true),
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = SeasonMutationResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function deleteSeason(
  accessToken: string,
  id: string,
): Promise<ApiResult<SeasonDeleteResponse>> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/seasons/${id}`, {
      method: "DELETE",
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = SeasonDeleteResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function copyNextYear(
  accessToken: string,
): Promise<ApiResult<CopyNextYearResponse>> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/seasons/copy-next-year`,
      { method: "POST", headers: authHeaders(accessToken) },
    );
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = CopyNextYearResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ── Overrides ────────────────────────────────────────────────────────────────

export async function fetchOverrides(accessToken: string): Promise<AvailabilityOverride[]> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/overrides`, {
      headers: authHeaders(accessToken),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = AvailabilityOverrideSchema.array().safeParse(body);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export async function createOverride(
  accessToken: string,
  body: CreateOverrideBody,
): Promise<ApiResult<OverrideMutationResponse>> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/overrides`, {
      method: "POST",
      headers: authHeaders(accessToken, true),
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = OverrideMutationResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function patchOverride(
  accessToken: string,
  id: string,
  body: PatchOverrideBody,
): Promise<ApiResult<OverrideMutationResponse>> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/overrides/${id}`, {
      method: "PATCH",
      headers: authHeaders(accessToken, true),
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = OverrideMutationResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function deleteOverride(
  accessToken: string,
  id: string,
): Promise<ApiResult<OverrideDeleteResponse>> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/overrides/${id}`, {
      method: "DELETE",
      headers: authHeaders(accessToken),
    });
    if (!response.ok) return { ok: false, ...(await parseError(response)) };
    const data: unknown = await response.json();
    const parsed = OverrideDeleteResponseSchema.safeParse(data);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ── Blocked times (read-only in this editor) ─────────────────────────────────

export async function fetchBlockedTimes(accessToken: string): Promise<BlockedTime[]> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/blocked-times`, {
      headers: authHeaders(accessToken),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = BlockedTimeSchema.array().safeParse(body);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

// ── Week preview ─────────────────────────────────────────────────────────────

export async function fetchAvailabilityPreview(
  accessToken: string,
  from: string,
  days: number,
): Promise<AvailabilityPreviewResponse> {
  try {
    const url = `${process.env.NEXT_PUBLIC_API_URL}/coach/availability-preview?from=${from}&days=${days}`;
    const response = await apiFetch(url, { headers: authHeaders(accessToken), cache: "no-store" });
    if (!response.ok) return { days: [] };
    const body: unknown = await response.json();
    const parsed = AvailabilityPreviewResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : { days: [] };
  } catch {
    return { days: [] };
  }
}
