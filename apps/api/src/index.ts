import "dotenv/config";
import { EnvValidationError, getEnv } from "./lib/env";
import { validateVapidAtStartup } from "./services/notifications/pushTransport";

try {
  getEnv();
  // Fail boot (not first push) if VAPID subject or keys are malformed or
  // mismatched. web-push's setVapidDetails validates all three; letting a
  // misconfigured server start would only surface as an opaque "Error" at
  // first send and look identical to a transient network failure.
  validateVapidAtStartup();
} catch (err) {
  const message = err instanceof EnvValidationError || err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

import { logger } from "./logger";
import { createApp } from "./app";
import { pool } from "./db/client";
import { registerShutdown } from "./shutdown";

const env = getEnv();
const app = createApp(logger);
const server = app.listen(env.port, () => logger.info({ port: env.port }, "API listening"));

server.on("error", (err) => {
  logger.error({ err: err.message, name: err.name }, "server error");
});

registerShutdown({ server, pool, logger });
