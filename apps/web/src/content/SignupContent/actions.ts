"use server";

import { isSafeReturnTo, SignUpBodySchema } from "@swim-app/shared";

import { publicEnv } from "@/lib/env";
import { mapZodErrors } from "@/lib/mapZodErrors";
import { mapApiResponse, type SignupState } from "./helpers";

export async function signup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const returnToRaw = formData.get("returnTo");
  const returnTo =
    typeof returnToRaw === "string" && isSafeReturnTo(returnToRaw, publicEnv.siteUrl)
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

  // ADR 036 Phase 8 Part B Stop 3: carry the three policy versions the
  // server-rendered page actually showed. Hidden inputs on
  // SignupContent.tsx carry the TERMS_VERSION / PRIVACY_VERSION /
  // PAYMENTS_REFUND_VERSION constants from @swim-app/shared, so the
  // browser cannot submit a version it did not see.
  const termsVersion = (formData.get("termsVersion") as string | null) ?? "";
  const privacyVersion = (formData.get("privacyVersion") as string | null) ?? "";
  const paymentsRefundVersion =
    (formData.get("paymentsRefundVersion") as string | null) ?? "";

  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: (formData.get("phone") as string | null)?.trim() || null,
    password: passwordRaw,
    birthDate: formData.get("birthDate"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
    acceptedPolicyVersions: {
      terms: termsVersion,
      privacy: privacyVersion,
      payments_refund: paymentsRefundVersion,
    },
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
