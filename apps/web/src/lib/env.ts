import { z } from "zod";

// Validates NEXT_PUBLIC_* vars at module load. Imported from app/layout.tsx
// (server-rendered during `next build`) and next.config.ts so a missing or
// invalid value fails the build with a clear message instead of baking
// `undefined` into fetch URLs or auth redirects.

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string({ required_error: "NEXT_PUBLIC_API_URL is required" })
    .url("NEXT_PUBLIC_API_URL must be a valid URL"),
  NEXT_PUBLIC_SITE_URL: z
    .string({ required_error: "NEXT_PUBLIC_SITE_URL is required" })
    .url("NEXT_PUBLIC_SITE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string({ required_error: "NEXT_PUBLIC_SUPABASE_URL is required" })
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ required_error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required" })
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required"),
});

export interface PublicEnv {
  apiUrl: string;
  siteUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export class EnvValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid web environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  // Pull out just the fields we care about so unrelated process.env noise
  // doesn't widen the schema or leak into the parsed object.
  const result = PublicEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: raw.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SITE_URL: raw.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: raw.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join(".") || "env";
      return `${path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return {
    apiUrl: result.data.NEXT_PUBLIC_API_URL,
    siteUrl: result.data.NEXT_PUBLIC_SITE_URL,
    supabaseUrl: result.data.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: result.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export const publicEnv: PublicEnv = parsePublicEnv(process.env);
