import { z } from "zod";

// Required vars have no default. Dev-friendly defaults apply when APP_ENV is
// `local` so `pnpm dev` still works with a bare .env. Deployed environments
// (`APP_ENV=dev` and `APP_ENV=prod`) share the strict validation surface —
// CORS, non-localhost SITE_URL, CRON_SECRET, Google OAuth, and (per ADR 028)
// transactional email configuration.
//
// We deliberately do NOT key behavior on NODE_ENV. Railway's dev service runs
// NODE_ENV=production too (that's how Railway selects the production build
// flavor of the Node runtime and of library bundles); inferring environment
// from NODE_ENV would conflate the dev deploy with prod. See ADR 028.
//
// Two parse surfaces: `parseEnv` validates everything the HTTP server needs;
// `parseDbEnv` validates only the DB connection string. DB-only scripts
// (migrate, seed, catalog sync) and `db/client.ts` go through the smaller
// surface so operators can run migrations without setting unrelated API vars.

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;

// Loose RFC 5322 check: either `local@domain` or `Display Name <local@domain>`.
// We validate structure, not deliverability — the transport layer catches
// bad addresses at send time.
const EMAIL_ADDR_RE =
  /^(?:[^<>]*<\s*([^\s@]+@[^\s@]+\.[^\s@]+)\s*>|([^\s@]+@[^\s@]+\.[^\s@]+))$/;

// Resend's prod-verified sending domain. EMAIL_FROM must use this (or a
// subdomain) when APP_ENV=prod so a misconfigured From can't ship.
const PROD_EMAIL_DOMAIN = "send.axiomaquatics.io";

const DbEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

export interface DbEnv {
  databaseUrl: string;
}

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Explicit environment. See the module doc comment on why this is not
  // inferred from NODE_ENV.
  APP_ENV: z.enum(["local", "dev", "prod"]).default("local"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1, "SUPABASE_PUBLISHABLE_KEY is required"),
  // Service-role key used only by the Supabase admin client (account
  // deletion hard-deletes the auth user via admin.deleteUser — ADR 034).
  // Required on deployed environments; optional locally so `pnpm dev`
  // doesn't require it until the deletion flow is actually exercised.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),
  SITE_URL: z.string().url("SITE_URL must be a valid URL").default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default(""),
  CRON_SECRET: z.string().optional(),
  // Google Calendar integration (ADR 027).
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_OAUTH_STATE_SECRET: z.string().optional(),
  // Parent booking emails (ADR 028).
  EMAIL_TRANSPORT: z.enum(["resend", "smtp"]).optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_SMTP_HOST: z.string().optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().positive().optional(),
  // Coach alerts (ADR 031). All three required on every environment —
  // deployed and local — once the feature ships. Local keeps a sender
  // no-op when all three are absent (same shape as EmailEnv).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // Local-only fault injection. Comma-separated path patterns: exact match
  // (`/clubs`) or trailing-`*` prefix match (`/lessons*`). Any matching
  // request returns a 500 before the route handler runs. parseEnv refuses to
  // boot if this is set in any environment other than APP_ENV=local.
  FAIL_ROUTES: z.string().optional(),
  // Stripe (ADR 036 Phase 3). Secret key authenticates the API against
  // Stripe's REST API; the webhook secret verifies the signature on
  // incoming webhook events. Both live on the API service only — never
  // on Vercel, never as NEXT_PUBLIC_*. Required on dev/prod so a boot
  // without them surfaces in the Railway deploy log, not at first
  // parent click on "Buy".
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export interface GoogleOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Buffer;
  stateSecret: string;
}

export interface EmailEnv {
  transport: "resend" | "smtp";
  from: string;
  replyTo: string | undefined;
  resendApiKey: string | undefined;
  smtpHost: string | undefined;
  smtpPort: number | undefined;
}

export interface VapidEnv {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface StripeEnv {
  secretKey: string;
  webhookSecret: string;
}

export interface ApiEnv {
  nodeEnv: "development" | "test" | "production";
  appEnv: "local" | "dev" | "prod";
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  // Service-role key for the admin client. Undefined locally when not set.
  // Required for the account-deletion hard-delete of the auth user.
  supabaseServiceRoleKey: string | undefined;
  trustProxy: number;
  siteUrl: string;
  corsOrigins: string[];
  cronSecret: string | undefined;
  googleOAuth: GoogleOAuthEnv | undefined;
  // Undefined when APP_ENV=local AND no EMAIL_TRANSPORT is set — the sender
  // becomes a no-op in that case so writes don't accumulate. Non-null on dev
  // and prod (parser enforces).
  email: EmailEnv | undefined;
  // Undefined when APP_ENV=local AND no VAPID_* vars are set — the coach
  // alert sender becomes a no-op in that case. Required on dev/prod.
  vapid: VapidEnv | undefined;
  // Undefined when APP_ENV=local AND Stripe vars aren't set — the payments
  // service throws on use in that case so a local run without Stripe keys
  // only breaks the payments routes, not the rest of the API.
  stripe: StripeEnv | undefined;
  // Empty unless APP_ENV=local and FAIL_ROUTES was set. See the schema
  // comment on FAIL_ROUTES.
  failRoutes: readonly string[];
}

export function parseEnv(raw: Record<string, string | undefined>): ApiEnv {
  // Fail-safe: a deployed server (NODE_ENV=production, which is Railway's
  // default) that forgets to set APP_ENV would otherwise silently fall
  // through to local defaults — lenient CORS, no CRON_SECRET, email env
  // treated as optional. Refuse to boot with a specific error instead.
  if (raw.NODE_ENV === "production" && !raw.APP_ENV) {
    throw new EnvValidationError([
      "APP_ENV: must be set explicitly when NODE_ENV=production (one of 'dev' or 'prod'). " +
        "This prevents a deployed server from silently inheriting local defaults.",
    ]);
  }

  const result = RawEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(formatZodError(result.error));
  }
  const parsed = result.data;
  const corsOrigins = parsed.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const googleOAuth = parseGoogleOAuthEnv(parsed);
  const email = parseEmailEnv(parsed);
  const vapid = parseVapidEnv(parsed);
  const stripe = parseStripeEnv(parsed);
  const failRoutes = parseFailRoutes(parsed);

  const isDeployed = parsed.APP_ENV === "dev" || parsed.APP_ENV === "prod";
  if (isDeployed) {
    const issues: string[] = [];
    if (corsOrigins.length === 0) {
      issues.push(
        "CORS_ORIGINS: must be a non-empty, comma-separated list of allowed origins when APP_ENV is 'dev' or 'prod'",
      );
    }
    if (LOCALHOST_RE.test(parsed.SITE_URL)) {
      issues.push("SITE_URL: must not point to localhost when APP_ENV is 'dev' or 'prod'");
    }
    if (!parsed.CRON_SECRET || parsed.CRON_SECRET.length < 32) {
      issues.push(
        "CRON_SECRET: must be set and at least 32 characters when APP_ENV is 'dev' or 'prod'",
      );
    }
    // ADR 034 added auth.admin.deleteUser as part of the account-deletion
    // post-commit fan-out. The service-role key is required for that call;
    // without it the deployed API boots fine and only fails when a parent
    // first clicks delete. Fail boot instead so the mistake surfaces in
    // the deploy log, not a user-facing error. Required on Railway (API
    // service) only — Vercel (web) must NEVER carry this key, and it
    // must NEVER appear in a NEXT_PUBLIC_* variable.
    if (!parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY.length === 0) {
      issues.push(
        "SUPABASE_SERVICE_ROLE_KEY: must be set when APP_ENV is 'dev' or 'prod' " +
          "(used for the account-deletion auth.admin.deleteUser call per ADR 034)",
      );
    }
    issues.push(...validateGoogleOAuthForDeployed(parsed));
    issues.push(...validateEmailForDeployed(parsed));
    issues.push(...validateVapidForDeployed(parsed));
    issues.push(...validateStripeForDeployed(parsed));
    if (issues.length > 0) {
      throw new EnvValidationError(issues);
    }
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    appEnv: parsed.APP_ENV,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    trustProxy: parsed.TRUST_PROXY,
    siteUrl: parsed.SITE_URL,
    corsOrigins,
    cronSecret: parsed.CRON_SECRET,
    googleOAuth,
    email,
    vapid,
    stripe,
    failRoutes,
  };
}

function parseStripeEnv(parsed: RawParsedEnv): StripeEnv | undefined {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = parsed;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return undefined;
  return {
    secretKey: STRIPE_SECRET_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
  };
}

function validateStripeForDeployed(parsed: RawParsedEnv): string[] {
  const issues: string[] = [];
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = parsed;
  if (!STRIPE_SECRET_KEY) {
    issues.push("STRIPE_SECRET_KEY: required when APP_ENV is 'dev' or 'prod'");
  } else if (!STRIPE_SECRET_KEY.startsWith("sk_")) {
    issues.push("STRIPE_SECRET_KEY: must start with 'sk_' (secret keys are sk_test_... or sk_live_...)");
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    issues.push("STRIPE_WEBHOOK_SECRET: required when APP_ENV is 'dev' or 'prod'");
  } else if (!STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    issues.push("STRIPE_WEBHOOK_SECRET: must start with 'whsec_'");
  }
  return issues;
}

function parseFailRoutes(parsed: RawParsedEnv): readonly string[] {
  const raw = parsed.FAIL_ROUTES?.trim() ?? "";
  if (!raw) return [];
  if (parsed.APP_ENV !== "local") {
    throw new EnvValidationError([
      "FAIL_ROUTES: must only be set when APP_ENV=local (local-only fault injection switch)",
    ]);
  }
  return raw
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

type RawParsedEnv = z.infer<typeof RawEnvSchema>;

function tryDecodeEncryptionKey(input: string): Buffer | undefined {
  try {
    const buf = Buffer.from(input, "base64");
    if (buf.length !== 32) return undefined;
    const roundTrip = buf.toString("base64").replace(/=+$/, "");
    const normalized = input.replace(/=+$/, "");
    if (roundTrip !== normalized) return undefined;
    return buf;
  } catch {
    return undefined;
  }
}

function parseGoogleOAuthEnv(parsed: RawParsedEnv): GoogleOAuthEnv | undefined {
  const {
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI,
    GOOGLE_TOKEN_ENCRYPTION_KEY,
    GOOGLE_OAUTH_STATE_SECRET,
  } = parsed;
  if (
    !GOOGLE_OAUTH_CLIENT_ID ||
    !GOOGLE_OAUTH_CLIENT_SECRET ||
    !GOOGLE_OAUTH_REDIRECT_URI ||
    !GOOGLE_TOKEN_ENCRYPTION_KEY ||
    !GOOGLE_OAUTH_STATE_SECRET
  ) {
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

function validateGoogleOAuthForDeployed(parsed: RawParsedEnv): string[] {
  const issues: string[] = [];
  const {
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI,
    GOOGLE_TOKEN_ENCRYPTION_KEY,
    GOOGLE_OAUTH_STATE_SECRET,
  } = parsed;
  if (!GOOGLE_OAUTH_CLIENT_ID)
    issues.push("GOOGLE_OAUTH_CLIENT_ID: required when APP_ENV is 'dev' or 'prod'");
  if (!GOOGLE_OAUTH_CLIENT_SECRET)
    issues.push("GOOGLE_OAUTH_CLIENT_SECRET: required when APP_ENV is 'dev' or 'prod'");
  if (!GOOGLE_OAUTH_REDIRECT_URI) {
    issues.push("GOOGLE_OAUTH_REDIRECT_URI: required when APP_ENV is 'dev' or 'prod'");
  } else if (
    !GOOGLE_OAUTH_REDIRECT_URI.startsWith("https://") ||
    LOCALHOST_RE.test(GOOGLE_OAUTH_REDIRECT_URI)
  ) {
    issues.push(
      "GOOGLE_OAUTH_REDIRECT_URI: must be an https URL and not point to localhost when APP_ENV is 'dev' or 'prod'",
    );
  }
  if (!GOOGLE_TOKEN_ENCRYPTION_KEY) {
    issues.push("GOOGLE_TOKEN_ENCRYPTION_KEY: required when APP_ENV is 'dev' or 'prod'");
  } else if (!tryDecodeEncryptionKey(GOOGLE_TOKEN_ENCRYPTION_KEY)) {
    issues.push(
      "GOOGLE_TOKEN_ENCRYPTION_KEY: must be base64 that decodes to exactly 32 bytes (generate with `openssl rand -base64 32`)",
    );
  }
  if (!GOOGLE_OAUTH_STATE_SECRET) {
    issues.push("GOOGLE_OAUTH_STATE_SECRET: required when APP_ENV is 'dev' or 'prod'");
  } else if (GOOGLE_OAUTH_STATE_SECRET.length < 32) {
    issues.push(
      "GOOGLE_OAUTH_STATE_SECRET: must be at least 32 characters when APP_ENV is 'dev' or 'prod'",
    );
  }
  return issues;
}

function parseEmailEnv(parsed: RawParsedEnv): EmailEnv | undefined {
  // Local without a transport set: sender becomes a no-op.
  if (parsed.APP_ENV === "local" && !parsed.EMAIL_TRANSPORT) {
    return undefined;
  }
  const transport: "resend" | "smtp" =
    parsed.EMAIL_TRANSPORT ?? (parsed.APP_ENV === "local" ? "smtp" : "resend");
  if (!parsed.EMAIL_FROM) {
    // Dev/prod: validateEmailForDeployed will surface this. Local with
    // explicit transport but no from: return undefined so the sender
    // treats this as "not configured."
    return undefined;
  }
  return {
    transport,
    from: parsed.EMAIL_FROM,
    replyTo: parsed.EMAIL_REPLY_TO,
    resendApiKey: parsed.RESEND_API_KEY,
    smtpHost: parsed.EMAIL_SMTP_HOST,
    smtpPort: parsed.EMAIL_SMTP_PORT,
  };
}

function validateEmailForDeployed(parsed: RawParsedEnv): string[] {
  const issues: string[] = [];
  if (!parsed.EMAIL_TRANSPORT) {
    issues.push("EMAIL_TRANSPORT: required and must be 'resend' when APP_ENV is 'dev' or 'prod'");
  } else if (parsed.EMAIL_TRANSPORT !== "resend") {
    issues.push("EMAIL_TRANSPORT: must be 'resend' when APP_ENV is 'dev' or 'prod'");
  }
  if (!parsed.EMAIL_FROM) {
    issues.push("EMAIL_FROM: required when APP_ENV is 'dev' or 'prod'");
  } else if (!EMAIL_ADDR_RE.test(parsed.EMAIL_FROM)) {
    issues.push("EMAIL_FROM: must be a valid RFC 5322 address (e.g. 'Name <local@domain>')");
  } else if (parsed.APP_ENV === "prod" && !fromUsesDomain(parsed.EMAIL_FROM, PROD_EMAIL_DOMAIN)) {
    issues.push(
      `EMAIL_FROM: must use the ${PROD_EMAIL_DOMAIN} domain when APP_ENV=prod (the Resend-verified sending domain)`,
    );
  }
  if (parsed.EMAIL_TRANSPORT === "resend") {
    if (!parsed.RESEND_API_KEY || !parsed.RESEND_API_KEY.startsWith("re_")) {
      issues.push("RESEND_API_KEY: required and must start with 're_' when APP_ENV is 'dev' or 'prod'");
    }
  }
  return issues;
}

// VAPID subject must be either a mailto: URL or an https: URL per RFC 8292.
// We don't enforce beyond "has an @ for mailto, has a dot for https" — the
// push service rejects malformed subjects at send time and we log loudly.
const VAPID_SUBJECT_RE = /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s/]+\.[^\s/]+.*)$/;
// Base64url charset (RFC 4648 §5). The web-push library accepts base64url
// strings without padding; the browser's `applicationServerKey` conversion
// also expects this format. We only validate shape here — size checks are
// skipped because the push service surfaces mismatches at send time.
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function parseVapidEnv(parsed: RawParsedEnv): VapidEnv | undefined {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = parsed;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return undefined;
  }
  if (!BASE64URL_RE.test(VAPID_PUBLIC_KEY) || !BASE64URL_RE.test(VAPID_PRIVATE_KEY)) {
    return undefined;
  }
  if (!VAPID_SUBJECT_RE.test(VAPID_SUBJECT)) return undefined;
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT,
  };
}

function validateVapidForDeployed(parsed: RawParsedEnv): string[] {
  const issues: string[] = [];
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = parsed;
  if (!VAPID_PUBLIC_KEY) {
    issues.push("VAPID_PUBLIC_KEY: required when APP_ENV is 'dev' or 'prod'");
  } else if (!BASE64URL_RE.test(VAPID_PUBLIC_KEY)) {
    issues.push("VAPID_PUBLIC_KEY: must be base64url (chars [A-Za-z0-9_-], no padding)");
  }
  if (!VAPID_PRIVATE_KEY) {
    issues.push("VAPID_PRIVATE_KEY: required when APP_ENV is 'dev' or 'prod'");
  } else if (!BASE64URL_RE.test(VAPID_PRIVATE_KEY)) {
    issues.push("VAPID_PRIVATE_KEY: must be base64url (chars [A-Za-z0-9_-], no padding)");
  }
  if (!VAPID_SUBJECT) {
    issues.push("VAPID_SUBJECT: required when APP_ENV is 'dev' or 'prod'");
  } else if (!VAPID_SUBJECT_RE.test(VAPID_SUBJECT)) {
    issues.push("VAPID_SUBJECT: must be a mailto:… or https://… URL");
  }
  return issues;
}

function fromUsesDomain(from: string, domain: string): boolean {
  const match = EMAIL_ADDR_RE.exec(from);
  if (!match) return false;
  const addr = match[1] ?? match[2] ?? "";
  const idx = addr.lastIndexOf("@");
  if (idx < 0) return false;
  const host = addr.slice(idx + 1).toLowerCase();
  return host === domain.toLowerCase() || host.endsWith("." + domain.toLowerCase());
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

export function __resetEnvCacheForTests(): void {
  cached = undefined;
  cachedDb = undefined;
}
