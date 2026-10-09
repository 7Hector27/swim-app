export interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

export interface ApiBody {
  error?: unknown;
  issues?: ZodIssueLike[];
}

export function isApiBody(body: unknown): body is ApiBody {
  return typeof body === "object" && body !== null;
}

export function mapZodErrors(issues: ZodIssueLike[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0]?.toString() ?? "_";
    if (!errors[key]) {
      errors[key] = issue.message;
    }
  }
  return errors;
}
