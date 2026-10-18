import { z } from "zod";

// Required vars have no default. Dev-friendly defaults apply when NODE_ENV is
// not "production" so `pnpm dev` still works with a bare .env. In production
// the additional refinements below require explicit values for anything that
// would otherwise fall back to localhost or be silently empty.

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, "SUPABASE_PUBLISHABLE_KEY is required"),
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),
  SITE_URL: z.string().url("SITE_URL must be a valid URL").default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default(""),
  CRON_SECRET: z.string().optional(),
});

export interface ApiEnv {
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  trustProxy: number;
  siteUrl: string;
  corsOrigins: string[];
  cronSecret: string | undefined;
}

export function parseEnv(raw: Record<string, string | undefined>): ApiEnv {
  const result = RawEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(formatZodError(result.error));
  }
  const parsed = result.data;
  const corsOrigins = parsed.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsed.NODE_ENV === "production") {
    const issues: string[] = [];
    if (corsOrigins.length === 0) {
      issues.push(
        "CORS_ORIGINS: must be a non-empty, comma-separated list of allowed origins in production",
      );
    }
    if (LOCALHOST_RE.test(parsed.SITE_URL)) {
      issues.push("SITE_URL: must not point to localhost in production");
    }
    if (!parsed.CRON_SECRET || parsed.CRON_SECRET.length < 16) {
      issues.push("CRON_SECRET: must be set and at least 16 characters in production");
    }
    if (issues.length > 0) {
      throw new EnvValidationError(issues);
    }
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    trustProxy: parsed.TRUST_PROXY,
    siteUrl: parsed.SITE_URL,
    corsOrigins,
    cronSecret: parsed.CRON_SECRET,
  };
}

export class EnvValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "env";
    return `${path}: ${issue.message}`;
  });
}

let cached: ApiEnv | undefined;

export function getEnv(): ApiEnv {
  if (cached) return cached;
  try {
    cached = parseEnv(process.env);
    return cached;
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new EnvValidationError(formatZodError(err));
    }
    throw err;
  }
}

// Testing hook: lets a test reset the cached env so a fresh parse happens.
export function __resetEnvCacheForTests(): void {
  cached = undefined;
}
