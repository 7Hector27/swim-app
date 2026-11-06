// Server-side reader for the ADR 034 deletion preview. The /account page
// pre-fetches this for a parent so the Delete account section can render
// its per-case copy without an extra client round-trip on expand.

import {
  DeletionPreviewResponseSchema,
  type DeletionPreviewResponse,
} from "@swim-app/shared";

export async function fetchDeletionPreview(
  accessToken: string,
): Promise<DeletionPreviewResponse | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/me/deletion/preview`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: "{}",
        cache: "no-store",
      },
    );
    if (response.status !== 200) return null;
    const body: unknown = await response.json();
    const parsed = DeletionPreviewResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
