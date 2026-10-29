import { afterEach, beforeEach, vi } from "vitest";

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

// Pin the clock for every unit test by default so no test silently depends
// on the real wall clock. Only Date is faked — setTimeout and other timers
// stay real. Tests that need a specific instant (undo-window logic,
// too-soon/too-far booking rules, "ancient" rows) call vi.setSystemTime
// themselves. Integration tests use a separate setup and don't inherit this.
const DEFAULT_FROZEN_NOW = new Date("2026-10-26T17:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DEFAULT_FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
