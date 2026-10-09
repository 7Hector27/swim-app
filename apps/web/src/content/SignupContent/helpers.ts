import { mapZodErrors } from "@/lib/mapZodErrors";

export type SignupState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "age_blocked" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

interface ApiBody {
  error?: unknown;
  issues?: ZodIssueLike[];
}

function isApiBody(body: unknown): body is ApiBody {
  return typeof body === "object" && body !== null;
}

export function mapApiResponse(
  status: number,
  body: unknown,
): Exclude<SignupState, { status: "idle" }> {
  if (status === 201) return { status: "success" };
  if (status === 403) return { status: "age_blocked" };

  if (isApiBody(body) && status === 422 && Array.isArray(body.issues)) {
    return { status: "field_errors", errors: mapZodErrors(body.issues) };
  }

  return { status: "error", message: "Something went wrong. Please try again." };
}
