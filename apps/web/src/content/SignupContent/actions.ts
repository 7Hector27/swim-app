"use server";

import { SignUpBodySchema } from "@swim-app/shared";

import { mapApiResponse, mapZodErrors, type SignupState } from "./helpers";

export async function signup(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: (formData.get("phone") as string | null)?.trim() || null,
    password: formData.get("password"),
    birthDate: formData.get("birthDate"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
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
