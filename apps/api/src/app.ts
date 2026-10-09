import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { sql, eq } from "drizzle-orm";
import { db } from "./db/client";
import { profiles } from "./db/schema";
import { buildHealthResponse } from "./health";
import { requestId } from "./middleware/requestId";
import { validate } from "./middleware/validate";
import { errorHandler } from "./middleware/errorHandler";
import { requireUser } from "./middleware/requireUser";
import { requireCoach } from "./middleware/requireCoach";
import { supabase } from "./lib/supabase";
import {
  calculateAge,
  HealthQuerySchema,
  type MeResponse,
  type PatchMeBody,
  PatchMeBodySchema,
  type SignUpBody,
  SignUpBodySchema,
  todayLA,
} from "@swim-app/shared";

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

  app.post("/auth/signup", validate({ body: SignUpBodySchema }), async (req, res) => {
    const body = req.body as SignUpBody;

    if (calculateAge(body.birthDate, todayLA()) < 18) {
      res.status(403).json({ error: "Ask a parent or guardian to create an account" });
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: { data: { full_name: body.fullName } },
    });

    if (error || !data.user) {
      req.log.warn(
        { code: (error as { code?: string } | null)?.code, status: (error as { status?: number } | null)?.status },
        "signUp failed",
      );
      res.status(400).json({ error: "Could not create account" });
      return;
    }

    const rows = await db
      .update(profiles)
      .set({
        ageAttestedAt: new Date(),
        ...(body.phone !== undefined && { phone: body.phone }),
      })
      .where(eq(profiles.id, data.user.id))
      .returning();

    if (!rows[0]) {
      req.log.error({ userId: data.user.id }, "Profile row missing after signUp");
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.status(201).end();
  });

  app.get("/me", requireUser, validate({}), (req, res) => {
    const body: MeResponse = {
      email: req.userEmail,
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
      email: req.userEmail,
      fullName: updated.fullName,
      phone: updated.phone,
      role: updated.role,
    };
    res.json(body);
  });

  app.get("/coach/ping", requireUser, requireCoach, validate({}), (_req, res) => {
    res.json({ pong: true });
  });

  app.use(errorHandler);

  return app;
}
