// Loads the integration-test env file and points DATABASE_URL at the test
// Supabase stack. Used by the db:test:migrate and db:test:sync-catalog
// shims so those commands can't accidentally run against the manual stack.

import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

export function applyTestEnv(): void {
  const envPath = resolve(__dirname, "..", ".env.test");
  const result = dotenvConfig({ path: envPath });

  if (result.error) {
    throw new Error(
      `Could not load ${envPath}. ` +
        `Create it from apps/api/.env.test.example and fill in the test-stack values ` +
        `(run \`pnpm db:test:status\` to get them).`,
    );
  }

  const integrationUrl = process.env["INTEGRATION_DATABASE_URL"];
  if (!integrationUrl) {
    throw new Error(
      "INTEGRATION_DATABASE_URL is not set in apps/api/.env.test.",
    );
  }

  // dotenv doesn't override pre-existing vars, so src/db/migrate.ts's
  // `import "dotenv/config"` (which loads the manual .env) will not clobber
  // this when we assign it first.
  process.env["DATABASE_URL"] = integrationUrl;
}
