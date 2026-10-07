import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { db } from "./db/client";
import { profiles } from "./db/schema";
import { sql, eq } from "drizzle-orm";
import { buildHealthResponse } from "./health";
import { HealthQuerySchema } from "@swim-app/shared";
import { requestId } from "./middleware/requestId";
import { validate } from "./middleware/validate";
import { errorHandler } from "./middleware/errorHandler";
import { requireUser } from "./middleware/requireUser";
import { requireCoach } from "./middleware/requireCoach";
import { type MeResponse, type PatchMeBody, PatchMeBodySchema } from "@swim-app/shared";

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

  app.get("/me", validate({}), requireUser, (req, res) => {
    const body: MeResponse = {
      fullName: req.profile.fullName,
      phone: req.profile.phone,
      role: req.profile.role,
    };
    res.json(body);
  });

  app.patch("/me", requireUser, validate({ body: PatchMeBodySchema }), async (req, res) => {
    const patch = req.body as PatchMeBody;
    const rows = await db
      .update(profiles)
      .set({
        ...(patch.fullName !== undefined && { fullName: patch.fullName }),
        ...(patch.phone !== undefined && { phone: patch.phone }),
      })
      .where(eq(profiles.id, req.profile.id))
      .returning();
    const updated = rows[0]!;
    const body: MeResponse = {
      fullName: updated.fullName,
      phone: updated.phone,
      role: updated.role,
    };
    res.json(body);
  });

  app.get("/coach/ping", validate({}), requireUser, requireCoach, (_req, res) => {
    res.json({ pong: true });
  });

  app.use(errorHandler);

  return app;
}
