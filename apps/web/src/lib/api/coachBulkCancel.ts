import {
  BulkCancelConfirmResponseSchema,
  BulkCancelPreviewResponseSchema,
  type BulkCancelConfirmBody,
  type BulkCancelConfirmResponse,
  type BulkCancelPreviewBody,
  type BulkCancelPreviewResponse,
} from "@swim-app/shared";

export interface PreviewResult {
  ok: true;
  data: BulkCancelPreviewResponse;
}

export interface PreviewError {
  ok: false;
  error: string;
}

export async function postBulkCancelPreview(
  accessToken: string,
  body: BulkCancelPreviewBody,
): Promise<PreviewResult | PreviewError> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/bulk-cancel/preview`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return { ok: false, error: `request_failed_${response.status}` };
    }
    const json: unknown = await response.json();
    const parsed = BulkCancelPreviewResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "shape_mismatch" };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: "network" };
  }
}

export interface ConfirmResult {
  ok: true;
  data: BulkCancelConfirmResponse;
}

export interface ConfirmError {
  ok: false;
  error: string;
}

export async function postBulkCancelConfirm(
  accessToken: string,
  body: BulkCancelConfirmBody,
): Promise<ConfirmResult | ConfirmError> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/bulk-cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const json: unknown = await response.json().catch(() => null);
      const detail =
        json && typeof json === "object" && json !== null && "error" in json
          ? String((json as { error: unknown }).error)
          : `request_failed_${response.status}`;
      return { ok: false, error: detail };
    }
    const json: unknown = await response.json();
    const parsed = BulkCancelConfirmResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, error: "shape_mismatch" };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: "network" };
  }
}
