"use server";

import { isSafeReturnTo, SignUpBodySchema } from "@swim-app/shared";

import { mapZodErrors } from "@/lib/mapZodErrors";
import { mapApiResponse, type SignupState } from "./helpers";

const SITE_ORIGIN = process.env["NEXT_PUBLIC_SITE_URL"] ?? "http://localhost:3000";

export async function signup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" && isSafeReturnTo(returnToRaw, SITE_ORIGIN)
      ? returnToRaw
      : undefined;

  const passwordRaw = formData.get("password");
  const confirmPasswordRaw = formData.get("confirmPassword");

  if (
    typeof passwordRaw === "string" &&
    typeof confirmPasswordRaw === "string" &&
    passwordRaw !== confirmPasswordRaw
  ) {
    return {
      status: "field_errors",
      errors: { confirmPassword: "Passwords don't match." },
    };
  }

  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: (formData.get("phone") as string | null)?.trim() || null,
    password: passwordRaw,
    birthDate: formData.get("birthDate"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
    ...(returnTo !== undefined && { returnTo }),
  };

  const parsed = SignUpBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "field_errors", errors: mapZodErrors(parsed.error.issues) };
  }

  let responseBody: unknown = null;
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed.data),
  });

  if (response.status !== 201) {
    try {
      responseBody = await response.json();
    } catch {
      // non-JSON body
    }
  }

  return mapApiResponse(response.status, responseBody);
}
