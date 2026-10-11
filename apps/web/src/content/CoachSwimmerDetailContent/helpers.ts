export type HideSwimmerState =
  | { status: "idle" }
  | { status: "error"; message: string };

export function mapHideApiResponse(httpStatus: number): HideSwimmerState {
  if (httpStatus === 204) return { status: "idle" };
  if (httpStatus === 404) return { status: "error", message: "Swimmer not found." };
  return { status: "error", message: "Something went wrong. Please try again." };
}
