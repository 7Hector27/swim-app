import "dotenv/config";
import { logger } from "./logger";
import { createApp } from "./app";

const app = createApp(logger);
const port = process.env.PORT ?? 3001;
app.listen(port, () =>
  logger.info(`API listening on http://localhost:${port}`),
);
