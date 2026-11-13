import {
  BalanceHistoryResponseSchema,
  BalanceResponseSchema,
  CheckoutSessionResponseSchema,
  type BalanceHistoryResponse,
  type BalanceResponse,
  type CheckoutSessionBody,
  type CheckoutSessionResponse,
} from "@swim-app/shared";

export async function fetchBalance(token: string): Promise<BalanceResponse | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/me/balance`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    const parsed = BalanceResponseSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function fetchBalanceHistory(
  token: string,
  cursor?: string,
): Promise<BalanceHistoryResponse | null> {
  try {
    const url = new URL(`${process.env.NEXT_PUBLIC_API_URL}/me/balance/history`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    const parsed = BalanceHistoryResponseSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Insufficient-funds response shape from POST /lessons and POST /lessons/batch.
export interface InsufficientBalanceBody {
  error: "insufficient_balance";
  balanceCents: number;
  priceCents: number;
  shortfallCents: number;
}

export type CreateCheckoutResult =
  | { ok: true; data: CheckoutSessionResponse }
  | { ok: false; status: number };

export async function createCheckoutSession(
  token: string,
  body: CheckoutSessionBody,
): Promise<CreateCheckoutResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/payments/checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 201) return { ok: false, status: response.status };
    const json: unknown = await response.json();
    const parsed = CheckoutSessionResponseSchema.safeParse(json);
    if (!parsed.success) return { ok: false, status: 502 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 503 };
  }
}
