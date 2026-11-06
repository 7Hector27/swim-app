// Loads the integration-test env file and points DATABASE_URL at the test
// Supabase stack. Used by the db:test:migrate and db:test:sync-catalog
// shims and scripts/runIntegration.ts so those paths can't accidentally
// run against the manual stack.
//
// Local path: apps/api/.env.test exists; dotenv loads it.
// CI path: the file does not exist, but INTEGRATION_DATABASE_URL and
// friends are already injected via $GITHUB_ENV before this runs. In that
// case we skip the file load and trust the environment.

import { existsSync } from "node:fs";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

export function applyTestEnv(): void {
  const envPath = resolve(__dirname, "..", ".env.test");

  if (existsSync(envPath)) {
    const result = dotenvConfig({ path: envPath });
    if (result.error) {
      throw new Error(`Could not load ${envPath}: ${result.error.message}`);
    }
  }

  const integrationUrl = process.env["INTEGRATION_DATABASE_URL"];
  if (!integrationUrl) {
    throw new Error(
      "INTEGRATION_DATABASE_URL is not set. " +
        "Locally: create apps/api/.env.test from apps/api/.env.test.example " +
        "(run `pnpm db:test:status` for values). " +
        "In CI: export it from `supabase status -o env` before running the tests.",
    );
  }

  // dotenv doesn't override pre-existing vars, so src/db/migrate.ts's
  // `import "dotenv/config"` (which loads the manual .env) will not clobber
  // this when we assign it first.
  process.env["DATABASE_URL"] = integrationUrl;
}
