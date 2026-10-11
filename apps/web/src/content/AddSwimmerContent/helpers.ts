import { isApiBody, mapZodErrors } from "@/lib/mapZodErrors";

export type AddSwimmerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

export function mapApiResponse(
  status: number,
  body: unknown,
): Exclude<AddSwimmerState, { status: "idle" }> {
  if (status === 400) {
    return {
      status: "error",
      message:
        "One or more selected clubs are no longer available. Please refresh and try again.",
    };
  }

  if (status === 422 && isApiBody(body) && Array.isArray(body.issues)) {
    return { status: "field_errors", errors: mapZodErrors(body.issues) };
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
