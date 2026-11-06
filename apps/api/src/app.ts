import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { sql, eq } from "drizzle-orm";
import { db } from "./db/client";
import { profiles } from "./db/schema";
import { buildHealthResponse } from "./health";
import { getEnv } from "./lib/env";
import { requestId } from "./middleware/requestId";
import { validate } from "./middleware/validate";
import { asyncHandler } from "./middleware/asyncHandler";
import { errorHandler } from "./middleware/errorHandler";
import { failRoutes } from "./middleware/failRoutes";
import { requireUser } from "./middleware/requireUser";
import { authEmailLimiter } from "./middleware/authEmailRateLimit";
import { supabase } from "./lib/supabase";
import { clubsRouter } from "./routes/clubs";
import { swimmersRouter } from "./routes/swimmers";
import { householdsRouter } from "./routes/households";
import { invitesRouter } from "./routes/invites";
import { locationsRouter } from "./routes/locations";
import { lessonsRouter } from "./routes/lessons";
import { internalRouter } from "./routes/internal";
import { parentProgressRouter } from "./routes/parentProgress";
import { coachRouter } from "./routes/coach";
import { integrationsGoogleRouter } from "./routes/integrationsGoogle";
import { leaderboardRouter } from "./routes/leaderboard";
import { accountDeletionRouter } from "./routes/accountDeletion";
import {
  calculateAge,
  HealthQuerySchema,
  isSafeReturnTo,
  type MeResponse,
  type PatchMeBody,
  PatchMeBodySchema,
  type SignUpBody,
  SignUpBodySchema,
  todayLA,
} from "@swim-app/shared";

export function createApp(logger: Logger) {
  const env = getEnv();
  const app = express();

  // Trust n proxy hops so req.ip reflects the real client IP behind reverse
  // proxies (e.g. Railway = 1 hop). Defaults to 0 (disabled) in local dev.
  // Controls the rate-limiter key. See ADR 023.
  if (env.trustProxy > 0) app.set("trust proxy", env.trustProxy);

  app.use(helmet());

  // Prod is guaranteed non-empty by env validation. In dev/test the fallback
  // keeps `pnpm dev` working with an empty CORS_ORIGINS — without it, a stale
  // .env would cause every browser mutation to fail silently (preflight passes
  // but with no Access-Control-Allow-Origin header, so fetch rejects).
  const corsOrigins =
    env.corsOrigins.length > 0
      ? env.corsOrigins
      : env.nodeEnv !== "production"
        ? ["http://localhost:3000"]
        : [];
  if (env.corsOrigins.length === 0 && env.nodeEnv !== "production") {
    logger.warn(
      { fallback: "http://localhost:3000" },
      "CORS_ORIGINS is unset — using dev fallback. Set it explicitly in apps/api/.env.",
    );
  }
  app.use(cors({ origin: corsOrigins }));

  app.use(requestId);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
    }),
  );

  // Local-only fault injection (APP_ENV=local + FAIL_ROUTES). No-op otherwise.
  // Installed after pinoHttp so req.log is available for the warn, and before
  // body parsing / auth so we can simulate failures on any route cheaply.
  app.use(failRoutes(env.failRoutes));

  // Ceiling is a full-catalog coach evaluation save
  // (POST /coach/swimmers/:id/sessions). ~132 skills in the catalog;
  // CreateSessionBody carries one RatingInput per skill, plus a per-skill
  // note with no schema cap. A realistic "long notes on every skill"
  // session lands around 100 KB (measured: 132 skills × 500-char notes
  // = 102 KB). The 20-lesson weekly batch is 5.7 KB — far smaller.
  // 128 KB gives ~25% headroom over the eval save worst case while
  // still blocking the multi-megabyte bodies that could only come from
  // a malformed or malicious client. Default (100 KB) surfaced 413 as
  // a generic 500 via errorHandler; errorHandler now returns a clean
  // 413 { error } with the standard shape.
  app.use(express.json({ limit: "128kb" }));

  app.get("/ping", (_req, res) => {
    res.json({ pong: true });
  });

  app.get(
    "/health",
    validate({ query: HealthQuerySchema }),
    asyncHandler(async (req, res) => {
      let dbOk = false;
      try {
        await db.execute(sql`SELECT 1`);
        dbOk = true;
      } catch (err) {
        req.log.error({ err }, "DB health check failed");
      }

      const body = buildHealthResponse(dbOk);
      res.status(dbOk ? 200 : 503).json(body);
    }),
  );

  app.post("/auth/signup", validate({ body: SignUpBodySchema }), authEmailLimiter, asyncHandler(async (req, res) => {
    const body = req.body as SignUpBody;

    if (calculateAge(body.birthDate, todayLA()) < 18) {
      res.status(403).json({ error: "Ask a parent or guardian to create an account" });
      return;
    }

    // Always set emailRedirectTo so GoTrue never falls back to the bare site_url
    // as .RedirectTo — that would break the template's &token_hash= separator.
    // Trailing ? on the normal-signup path lets the template safely append &token_hash=...
    const confirmBase = `${env.siteUrl}/auth/confirm`;
    const emailRedirectTo =
      body.returnTo && isSafeReturnTo(body.returnTo, env.siteUrl)
        ? `${confirmBase}?returnTo=${encodeURIComponent(body.returnTo)}`
        : `${confirmBase}?`;

    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        data: { full_name: body.fullName },
        emailRedirectTo,
      },
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
  }));

  app.get("/me", requireUser, validate({}), (req, res) => {
    const body: MeResponse = {
      email: req.userEmail,
      fullName: req.profile.fullName,
      phone: req.profile.phone,
      role: req.profile.role,
    };
    res.json(body);
  });

  app.patch("/me", requireUser, validate({ body: PatchMeBodySchema }), asyncHandler(async (req, res) => {
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
  }));

  app.use("/clubs", clubsRouter);
  app.use("/swimmers", swimmersRouter);
  app.use("/swimmers", parentProgressRouter);
  app.use("/households", householdsRouter);
  app.use("/invites", invitesRouter);
  app.use("/locations", locationsRouter);
  app.use("/lessons", lessonsRouter);
  app.use("/internal", internalRouter);
  // /integrations/google/callback must be at exactly that path (registered
  // in Google Cloud OAuth settings). Mounted outside /coach because the
  // callback is hit by a browser redirect from Google and must be reachable
  // without a Bearer token — state verification binds it to a coach instead.
  app.use("/integrations", integrationsGoogleRouter);
  app.use("/coach", coachRouter);
  app.use(accountDeletionRouter);
  app.use(leaderboardRouter);

  app.use(errorHandler);

  return app;
}
