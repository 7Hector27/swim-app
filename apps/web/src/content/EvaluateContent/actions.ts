"use server";

import { redirect } from "next/navigation";
import { CreateSessionBodySchema } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";
import type { EvaluateState } from "./helpers";
import { mapSubmitResponse } from "./helpers";

export async function submitEvaluation(
  swimmerId: string,
  _prev: EvaluateState,
  formData: FormData,
): Promise<EvaluateState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const rawJson = formData.get("bodyJson");
  if (typeof rawJson !== "string") {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const parsed = CreateSessionBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Some inputs are invalid. Please check and retry." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/sessions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );

  const body: unknown = await response.json().catch(() => null);
  return mapSubmitResponse(response.status, body);
}
