export type EditState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };
