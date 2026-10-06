import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { db } from "./db/client";
import { sql } from "drizzle-orm";
import { buildHealthResponse } from "./health";
import { HealthQuerySchema } from "@swim-app/shared";
import { requestId } from "./middleware/requestId";
import { validate } from "./middleware/validate";
import { errorHandler } from "./middleware/errorHandler";

export function createApp(logger: Logger) {
  const app = express();

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({ origin: corsOrigins }));

  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
    }),
  );

  app.use(express.json());

  app.get("/ping", (_req, res) => {
    res.json({ pong: true });
  });

  app.get(
    "/health",
    validate({ query: HealthQuerySchema }),
    async (req, res) => {
      let dbOk = false;
      try {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
      } catch (err) {
        req.log.error({ err }, "DB health check failed");
      }

      const body = buildHealthResponse(dbOk);
      res.status(dbOk ? 200 : 503).json(body);
    },
  );

  app.use(errorHandler);

  return app;
}
