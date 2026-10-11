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
