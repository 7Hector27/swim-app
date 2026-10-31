"use server";

import { createClient } from "@/lib/supabase/server";
import type {
  AvailabilityConfig,
  AvailabilityPreviewResponse,
  CreateOverrideBody,
  CreateSeasonBody,
  CopyNextYearResponse,
  OverrideDeleteResponse,
  OverrideMutationResponse,
  PatchAvailabilityConfigBody,
  PatchOverrideBody,
  PatchSeasonBody,
  SeasonDeleteResponse,
  SeasonMutationResponse,
  SeasonWithIsCurrent,
} from "@swim-app/shared";
import type { ApiResult } from "@/lib/api/coachAvailability";
import {
  copyNextYear,
  createOverride,
  createSeason,
  deleteOverride,
  deleteSeason,
  fetchAvailabilityPreview,
  fetchSeasonDeleteImpact,
  fetchSeasons,
  patchAvailabilityConfig,
  patchOverride,
  patchSeason,
} from "@/lib/api/coachAvailability";

async function getToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function fetchSeasonsAction(): Promise<SeasonWithIsCurrent[]> {
  const token = await getToken();
  if (!token) return [];
  return fetchSeasons(token);
}

export async function createSeasonAction(
  body: CreateSeasonBody,
): Promise<ApiResult<SeasonMutationResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return createSeason(token, body);
}

export async function patchSeasonAction(
  id: string,
  body: PatchSeasonBody,
): Promise<ApiResult<SeasonMutationResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return patchSeason(token, id, body);
}

export async function deleteSeasonAction(
  id: string,
): Promise<ApiResult<SeasonDeleteResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return deleteSeason(token, id);
}

export async function fetchSeasonDeleteImpactAction(
  id: string,
): Promise<ApiResult<SeasonDeleteResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return fetchSeasonDeleteImpact(token, id);
}

export async function copyNextYearAction(): Promise<ApiResult<CopyNextYearResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return copyNextYear(token);
}

export async function createOverrideAction(
  body: CreateOverrideBody,
): Promise<ApiResult<OverrideMutationResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return createOverride(token, body);
}

export async function patchOverrideAction(
  id: string,
  body: PatchOverrideBody,
): Promise<ApiResult<OverrideMutationResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return patchOverride(token, id, body);
}

export async function deleteOverrideAction(
  id: string,
): Promise<ApiResult<OverrideDeleteResponse>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return deleteOverride(token, id);
}

export async function fetchAvailabilityPreviewAction(
  from: string,
  days: number,
): Promise<AvailabilityPreviewResponse> {
  const token = await getToken();
  if (!token) return { days: [] };
  return fetchAvailabilityPreview(token, from, days);
}

export async function patchAvailabilityConfigAction(
  body: PatchAvailabilityConfigBody,
): Promise<ApiResult<AvailabilityConfig>> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, code: "session_expired" };
  return patchAvailabilityConfig(token, body);
}
