import { z } from "zod";

// Required vars have no default. Dev-friendly defaults apply when NODE_ENV is
// not "production" so `pnpm dev` still works with a bare .env. In production
// the additional refinements below require explicit values for anything that
// would otherwise fall back to localhost or be silently empty.
//
// Two parse surfaces: `parseEnv` validates everything the HTTP server needs
// (Supabase keys, CORS, cron, etc.); `parseDbEnv` validates only the DB
// connection string. DB-only scripts (migrate, seed, catalog sync) and
// `db/client.ts` go through the smaller surface so operators can run
// migrations without setting unrelated API vars.

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;

const DbEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

export interface DbEnv {
  databaseUrl: string;
}

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
  // Google Calendar integration (ADR 027). All four are optional at parse time;
  // when any is missing the integration reports "not configured" and the UI
  // hides the connect card. Prod-only refinements below enforce real values.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_OAUTH_STATE_SECRET: z.string().optional(),
});

export interface GoogleOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  // Decoded 32-byte AES-256 key. Base64 input; validated length at parse time.
  tokenEncryptionKey: Buffer;
  stateSecret: string;
}

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
  // Non-null when all five Google env vars are set and pass validation.
  // Routes and services treat `undefined` as "integration disabled, hide UI".
  googleOAuth: GoogleOAuthEnv | undefined;
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

  const googleOAuth = parseGoogleOAuthEnv(parsed);

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
    if (!parsed.CRON_SECRET || parsed.CRON_SECRET.length < 32) {
      issues.push("CRON_SECRET: must be set and at least 32 characters in production");
    }
    // In production the Google integration is required. If any of the five
    // vars is missing or malformed, surface a specific error instead of
    // silently disabling the integration.
    issues.push(...validateGoogleOAuthForProduction(parsed));
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
    googleOAuth,
  };
}

type RawParsedEnv = z.infer<typeof RawEnvSchema>;

// Returns the decoded key only if the input is valid base64 and decodes to
// exactly 32 bytes; otherwise undefined. Caller decides what to do with that.
function tryDecodeEncryptionKey(input: string): Buffer | undefined {
  try {
    const buf = Buffer.from(input, "base64");
    // Reject inputs that silently truncate: re-encoding must match (ignoring
    // padding). This also catches arbitrary non-base64 text, which Node
    // otherwise accepts and returns garbage for.
    if (buf.length !== 32) return undefined;
    const roundTrip = buf.toString("base64").replace(/=+$/, "");
    const normalized = input.replace(/=+$/, "");
    if (roundTrip !== normalized) return undefined;
    return buf;
  } catch {
    return undefined;
  }
}

// Non-production: return the parsed oauth config if ALL five vars are
// present and valid; otherwise undefined and the integration is disabled.
// In production the caller runs validateGoogleOAuthForProduction first and
// throws, so by the time we reach here all five are guaranteed valid.
function parseGoogleOAuthEnv(parsed: RawParsedEnv): GoogleOAuthEnv | undefined {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_TOKEN_ENCRYPTION_KEY, GOOGLE_OAUTH_STATE_SECRET } = parsed;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REDIRECT_URI || !GOOGLE_TOKEN_ENCRYPTION_KEY || !GOOGLE_OAUTH_STATE_SECRET) {
    return undefined;
  }
  const key = tryDecodeEncryptionKey(GOOGLE_TOKEN_ENCRYPTION_KEY);
  if (!key) return undefined;
  if (GOOGLE_OAUTH_STATE_SECRET.length < 32) return undefined;
  return {
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
    tokenEncryptionKey: key,
    stateSecret: GOOGLE_OAUTH_STATE_SECRET,
  };
}

function validateGoogleOAuthForProduction(parsed: RawParsedEnv): string[] {
  const issues: string[] = [];
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_TOKEN_ENCRYPTION_KEY, GOOGLE_OAUTH_STATE_SECRET } = parsed;
  if (!GOOGLE_OAUTH_CLIENT_ID) issues.push("GOOGLE_OAUTH_CLIENT_ID: required in production");
  if (!GOOGLE_OAUTH_CLIENT_SECRET) issues.push("GOOGLE_OAUTH_CLIENT_SECRET: required in production");
  if (!GOOGLE_OAUTH_REDIRECT_URI) {
    issues.push("GOOGLE_OAUTH_REDIRECT_URI: required in production");
  } else if (!GOOGLE_OAUTH_REDIRECT_URI.startsWith("https://") || LOCALHOST_RE.test(GOOGLE_OAUTH_REDIRECT_URI)) {
    issues.push("GOOGLE_OAUTH_REDIRECT_URI: must be an https URL and not point to localhost in production");
  }
  if (!GOOGLE_TOKEN_ENCRYPTION_KEY) {
    issues.push("GOOGLE_TOKEN_ENCRYPTION_KEY: required in production");
  } else if (!tryDecodeEncryptionKey(GOOGLE_TOKEN_ENCRYPTION_KEY)) {
    issues.push("GOOGLE_TOKEN_ENCRYPTION_KEY: must be base64 that decodes to exactly 32 bytes (generate with `openssl rand -base64 32`)");
  }
  if (!GOOGLE_OAUTH_STATE_SECRET) {
    issues.push("GOOGLE_OAUTH_STATE_SECRET: required in production");
  } else if (GOOGLE_OAUTH_STATE_SECRET.length < 32) {
    issues.push("GOOGLE_OAUTH_STATE_SECRET: must be at least 32 characters in production");
  }
  return issues;
}

export class EnvValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "env";
    return `${path}: ${issue.message}`;
  });
}

export function parseDbEnv(raw: Record<string, string | undefined>): DbEnv {
  const result = DbEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(formatZodError(result.error));
  }
  return { databaseUrl: result.data.DATABASE_URL };
}

let cached: ApiEnv | undefined;
let cachedDb: DbEnv | undefined;

export function getEnv(): ApiEnv {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

export function getDbEnv(): DbEnv {
  if (cachedDb) return cachedDb;
  cachedDb = parseDbEnv(process.env);
  return cachedDb;
}

// Testing hook: lets a test reset the cached env so a fresh parse happens.
export function __resetEnvCacheForTests(): void {
  cached = undefined;
  cachedDb = undefined;
}
