// Idempotent sync of the skills catalog into the DB.
// Safe to run against any environment deliberately; never runs automatically.
//
// Run via: pnpm db:sync-catalog

import "dotenv/config";
import { db } from "../client";
import syncCatalogFn from "./syncCatalogFn";

syncCatalogFn(db)
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
