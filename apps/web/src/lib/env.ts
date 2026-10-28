// Server-only. `parsePublicEnv` iterates process.env by dynamic key, which
// Next.js cannot inline into the client bundle — in the browser those
// lookups are undefined and the Zod validator throws EnvValidationError.
// Any client component that needs a NEXT_PUBLIC_* value should receive it
// as a prop from its server page (preferred), or reference the literal
// `process.env.NEXT_PUBLIC_FOO`, which Next DOES inline at build time.
// The `server-only` import turns a stray client import into a build error
// instead of a runtime crash. See CLAUDE.md ("client components never
// import the env validator").
import "server-only";
import { z } from "zod";

// Validates NEXT_PUBLIC_* vars at module load. Imported from app/layout.tsx
// (server-rendered during `next build`) and next.config.ts so a missing or
// invalid value fails the build with a clear message instead of baking
// `undefined` into fetch URLs or auth redirects.

// VAPID public key is base64url (RFC 4648 §5). Match the API's shape check;
// the push service rejects a malformed key at subscribe time either way.
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

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
  // Optional on local (sender is a no-op without API-side VAPID too).
  // Required on dev/prod — the deploy sets it alongside API-side VAPID keys.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z
    .string()
    .regex(BASE64URL_RE, "NEXT_PUBLIC_VAPID_PUBLIC_KEY must be base64url (chars [A-Za-z0-9_-], no padding)")
    .optional(),
});

export interface PublicEnv {
  apiUrl: string;
  siteUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  // Absent when not configured — exactOptionalPropertyTypes requires the
  // property to be missing, not set to undefined.
  vapidPublicKey?: string;
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
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: raw.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
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
    ...(result.data.NEXT_PUBLIC_VAPID_PUBLIC_KEY !== undefined && {
      vapidPublicKey: result.data.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    }),
  };
}

// Validated at import time. Tests should NOT import `publicEnv` directly —
// doing so runs the schema against whatever `process.env` holds at the moment
// the module graph loads, which may be before the test setup assigns
// placeholders. Call `parsePublicEnv(fixture)` from tests instead.
export const publicEnv: PublicEnv = parsePublicEnv(process.env);
