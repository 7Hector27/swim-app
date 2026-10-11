// Integration test setup — runs against a real local Supabase stack.
//
// Safety guard: refuses to run if the database URL doesn't resolve to a
// loopback address. Hitting a shared or production DB with these tests would
// create real auth users and delete rows.

const INTEGRATION_DATABASE_URL =
  process.env["INTEGRATION_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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
process.env["SUPABASE_URL"] ??= "http://127.0.0.1:54321";
// Local Supabase's standard anon key — safe to hardcode; it only works against
// a local stack.
process.env["SUPABASE_PUBLISHABLE_KEY"] ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
