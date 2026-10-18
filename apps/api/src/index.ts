import "dotenv/config";
import { EnvValidationError, getEnv } from "./lib/env";

try {
  getEnv();
} catch (err) {
  const message = err instanceof EnvValidationError || err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

import { logger } from "./logger";
import { createApp } from "./app";

const env = getEnv();
const app = createApp(logger);
app.listen(env.port, () => logger.info({ port: env.port }, "API listening"));
