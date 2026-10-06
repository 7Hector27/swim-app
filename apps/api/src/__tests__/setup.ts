// Provide a placeholder DATABASE_URL so client.ts doesn't throw at import time.
// Tests that actually need the DB will require a real connection string.
process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
