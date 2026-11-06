import { applyTestEnv } from "./applyTestEnv";

applyTestEnv();

// Dynamic import so DATABASE_URL is already pointing at the test stack
// before src/db/migrate.ts reads it.
void import("../src/db/migrate");
