// Integration test setup — runs against a real local Supabase stack.
//
// All connection details must be set in the environment — no hardcoded
// defaults. Locally, Vitest loads apps/api/.env which should contain these
// vars (copy from `pnpm db:status`). In CI they are written to $GITHUB_ENV
// from `supabase status -o env` immediately after the stack starts.
//
// Safety guard: refuses to run if INTEGRATION_DATABASE_URL doesn't resolve to
// a loopback address. Hitting a shared or production DB would create real auth
// users and delete rows.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Integration tests require ${name} to be set. ` +
        `Run \`pnpm db:status\` (or \`supabase status\`) to get the values ` +
        `and add them to apps/api/.env.`,
    );
  }
  return value;
}

const INTEGRATION_DATABASE_URL = requireEnv("INTEGRATION_DATABASE_URL");
requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_PUBLISHABLE_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

function assertLocalhost(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      `INTEGRATION_DATABASE_URL is not a valid URL: ${rawUrl}`,
    );
  }

  const hostname = parsed.hostname;
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";

  if (!isLocal) {
    throw new Error(
      `Refusing to run integration tests against a non-local database. ` +
        `INTEGRATION_DATABASE_URL must resolve to localhost, 127.0.0.1, or ::1. ` +
        `Got hostname: ${hostname}`,
    );
  }
}

assertLocalhost(INTEGRATION_DATABASE_URL);

// db/client.ts reads DATABASE_URL at import time, so we must set it before any
// test file imports the app.
process.env["DATABASE_URL"] = INTEGRATION_DATABASE_URL;

// Test defaults for env vars that the API would otherwise read from the
// developer's local .env. Set only when unset so a real .env or CI-provided
// value still wins. These exist so the integration suite runs identically
// locally and in CI without depending on a developer's .env being present.
//
// APP_ENV=local keeps env.ts's lenient branch (CORS, SITE_URL localhost,
// Google OAuth, prod email-domain pin are all optional). CRON_SECRET is
// used directly by the cron-tick integration tests to sign the request
// header; env.ts treats it as optional under APP_ENV=local but a value is
// required for the test's own assertions.
process.env["APP_ENV"] ??= "local";
process.env["SITE_URL"] ??= "http://localhost:3000";
process.env["CRON_SECRET"] ??= "test-cron-secret-aaaaaaaaaaaaaaaaaa";

// Parent booking emails sender (ADR 028). Integration tests inject a test
// transport via __setSenderTransportForTests, but the env parser still
// needs EMAIL_TRANSPORT + EMAIL_FROM so that getEnv().email is non-null.
process.env["EMAIL_TRANSPORT"] ??= "smtp";
process.env["EMAIL_FROM"] ??= "Axiom Aquatics Test <lessons@test.local>";
process.env["EMAIL_SMTP_HOST"] ??= "127.0.0.1";
process.env["EMAIL_SMTP_PORT"] ??= "54325";

// Coach push notifications (ADR 031). The transport is injected via
// __setSenderTransportForTests in tests that exercise the sender; the
// VAPID env is still required to pass env parsing.
process.env["VAPID_PUBLIC_KEY"] ??= "B".repeat(87);
process.env["VAPID_PRIVATE_KEY"] ??= "k".repeat(43);
process.env["VAPID_SUBJECT"] ??= "mailto:ops@test.local";
