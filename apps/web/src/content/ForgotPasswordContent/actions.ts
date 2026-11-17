"use server";

import { ForgotPasswordBodySchema } from "@swim-app/shared";

export interface ForgotPasswordState {
  status: "idle" | "submitted" | "error";
  // Always set to the same generic copy on submitted/error so the UI
  // cannot leak account existence. Keep this string as the single source
  // of truth; ForgotPasswordContent reads it verbatim.
  message: string | null;
}

const GENERIC_SUBMITTED_MESSAGE =
  "If there's an account for that email, we've sent a reset link.";
const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again in a moment.";

export async function forgotPassword(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = ForgotPasswordBodySchema.safeParse({
    email: formData.get("email"),
  });

  // Invalid-email path: still return the generic submitted message. Any
  // branch that confirms or denies a specific email leaks existence.
  if (!parsed.success) {
    return { status: "submitted", message: GENERIC_SUBMITTED_MESSAGE };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    },
  );

  // The API always returns 200 for a well-formed request; the only
  // other interesting case is 429 (rate limited). Collapse every non-
  // network-error path into the same generic response so timing and
  // wording stay identical.
  if (response.status >= 500) {
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
  return { status: "submitted", message: GENERIC_SUBMITTED_MESSAGE };
}
