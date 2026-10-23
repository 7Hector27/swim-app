// Provide placeholder env vars so modules don't throw at import time.
// Tests that actually need the DB or Supabase will require real values.
process.env["NODE_ENV"] ??= "test";
process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["SUPABASE_URL"] ??= "http://127.0.0.1:54321";
process.env["SUPABASE_PUBLISHABLE_KEY"] ??= "placeholder-anon-key";
// Email env placeholders so the sender's getEnv() path is happy. Tests
// that need the sender for real supply their own transport via
// __setSenderTransportForTests.
process.env["SITE_URL"] ??= "http://localhost:3000";
process.env["EMAIL_TRANSPORT"] ??= "smtp";
process.env["EMAIL_FROM"] ??= "Axiom Aquatics <lessons@send.axiomaquatics.io>";
process.env["EMAIL_SMTP_HOST"] ??= "127.0.0.1";
process.env["EMAIL_SMTP_PORT"] ??= "54325";
