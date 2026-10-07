// Provide placeholder env vars so modules don't throw at import time.
// Tests that actually need the DB or Supabase will require real values.
process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["SUPABASE_URL"] ??= "http://127.0.0.1:54321";
process.env["SUPABASE_PUBLISHABLE_KEY"] ??= "placeholder-anon-key";
