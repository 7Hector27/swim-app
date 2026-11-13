import { isApiBody, mapZodErrors } from "@/lib/mapZodErrors";

export type SignupState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

const AGE_ERROR =
  "You must be 18 or older to create an account. Ask a parent or guardian to sign up.";

export { AGE_ERROR };

export function mapApiResponse(
  status: number,
  body: unknown,
): Exclude<SignupState, { status: "idle" }> {
  if (status === 201) return { status: "success" };
  if (status === 403)
    return { status: "field_errors", errors: { birthDate: AGE_ERROR } };

  // ADR 036 Phase 8 Part B Stop 3: stale policy versions surface a
  // one-line "refresh and try again" error so the user retries against
  // the newly-rendered page carrying the current constants.
  if (
    status === 422 &&
    typeof body === "object" &&
    body !== null &&
    (body as { error?: string }).error === "stale_policy_versions"
  ) {
    return {
      status: "error",
      message: "The policies were updated — refresh and try again.",
    };
  }

  if (isApiBody(body) && status === 422 && Array.isArray(body.issues)) {
    return { status: "field_errors", errors: mapZodErrors(body.issues) };
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
