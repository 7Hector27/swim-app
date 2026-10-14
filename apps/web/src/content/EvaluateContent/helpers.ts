export type EvaluateState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "saved"; sessionId: string; ratingIds: string[] };

export function mapSubmitResponse(httpStatus: number, body: unknown): EvaluateState {
  if (httpStatus === 201) {
    const parsed = body as { sessionId?: unknown; ratingIds?: unknown };
    if (
      typeof parsed.sessionId === "string" &&
      Array.isArray(parsed.ratingIds) &&
      parsed.ratingIds.every((id: unknown) => typeof id === "string")
    ) {
      return { status: "saved", sessionId: parsed.sessionId, ratingIds: parsed.ratingIds as string[] };
    }
    return { status: "error", message: "Something went wrong. Please try again." };
  }
  if (httpStatus === 422) return { status: "error", message: "Some inputs are invalid. Please check and retry." };
  if (httpStatus === 404) return { status: "error", message: "Swimmer not found." };
  return { status: "error", message: "Something went wrong. Please try again." };
}
