// Integration test setup — runs against the dedicated test Supabase stack.
//
// All connection details must be set in the environment — no hardcoded
// defaults. Locally, Vitest loads apps/api/.env.test (see
// vitest.integration.config.ts), which the developer generates from
// `pnpm db:test:status`. In CI, `supabase status -o env` writes the values
// to $GITHUB_ENV immediately after the stack starts.
//
// Two safety guards:
//   1. INTEGRATION_DATABASE_URL must resolve to a loopback address.
//   2. It must point at the dedicated test stack (DB port 54422), OR
//      INTEGRATION_TEST_TARGET=1 must be set. CI sets the env var because
//      its ephemeral stack still runs on the default port 54322 but the
//      runner VM is the isolation boundary. Locally, no override — the
//      developer must point at the test stack.
//
// See docs/decisions/035-test-database-isolation.md.

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

const TEST_STACK_DB_PORT = "54422";
const MANUAL_STACK_DB_PORT = "54322";

function assertTestTarget(rawUrl: string): void {
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

  const port = parsed.port;
  const ciAllow = process.env["INTEGRATION_TEST_TARGET"] === "1";

  if (port === TEST_STACK_DB_PORT || ciAllow) {
    return;
  }

  if (port === MANUAL_STACK_DB_PORT) {
    throw new Error(
      `Refusing to run integration tests against the manual Supabase stack ` +
        `(port ${MANUAL_STACK_DB_PORT}). Integration tests must target the ` +
        `dedicated test stack (port ${TEST_STACK_DB_PORT}). ` +
        `Start it with: pnpm db:test:up, then regenerate apps/api/.env.test ` +
        `from pnpm db:test:status. See ADR 035.`,
    );
  }

  throw new Error(
    `Refusing to run integration tests: INTEGRATION_DATABASE_URL port ` +
      `${port || "(none)"} is not the test stack's port ${TEST_STACK_DB_PORT}, ` +
      `and INTEGRATION_TEST_TARGET=1 is not set. ` +
      `Locally, start the test stack with: pnpm db:test:up. ` +
      `In CI, set INTEGRATION_TEST_TARGET=1. See ADR 035.`,
  );
}

assertTestTarget(INTEGRATION_DATABASE_URL);

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
