import {
  AcceptInviteResponseSchema,
  GenerateInviteResponseSchema,
  InviteStatusResponseSchema,
  type AcceptInviteResponse,
  type GenerateInviteResponse,
  type InviteStatusResponse,
} from "@swim-app/shared";

export async function getInviteStatus(token: string): Promise<InviteStatusResponse | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invites/${token}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = InviteStatusResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function generateInvite(accessToken: string): Promise<GenerateInviteResponse | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine/invites`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = GenerateInviteResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function acceptInvite(
  token: string,
  accessToken: string,
): Promise<{ ok: true; data: AcceptInviteResponse } | { ok: false; error: string; code: string }> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invites/${token}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body: unknown = await response.json();
    if (response.ok) {
      const parsed = AcceptInviteResponseSchema.safeParse(body);
      if (parsed.success) return { ok: true, data: parsed.data };
    }
    const errorBody = body as { error?: string; code?: string };
    return {
      ok: false,
      error: errorBody.error ?? "Something went wrong.",
      code: errorBody.code ?? "unknown",
    };
  } catch {
    return { ok: false, error: "Something went wrong.", code: "network" };
  }
}
