import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { sql, eq } from "drizzle-orm";
import { db } from "./db/client";
import { householdMembers, profiles } from "./db/schema";
import { buildHealthResponse } from "./health";
import { getEnv } from "./lib/env";
import { requestId } from "./middleware/requestId";
import { validate } from "./middleware/validate";
import { asyncHandler } from "./middleware/asyncHandler";
import { errorHandler } from "./middleware/errorHandler";
import { failRoutes } from "./middleware/failRoutes";
import { requireUser } from "./middleware/requireUser";
import { authEmailLimiter } from "./middleware/authEmailRateLimit";
import {
  changePasswordLimiter,
  forgotPasswordIpLimiter,
} from "./middleware/passwordRateLimit";
import { supabase } from "./lib/supabase";
import { supabaseAdmin } from "./lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";
import { enqueuePasswordChangedEmail } from "./services/emails/passwordChangedOutbox";
import { sendLessonEmailOutboxRow } from "./services/emails/sender";
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
import { balanceRouter, paymentsRouter } from "./routes/payments";
import { policiesRouter } from "./routes/policies";
import { applyPolicyAcceptance } from "./services/policyAcceptance";
import { processWebhook } from "./services/stripe";
import {
  calculateAge,
  ChangePasswordBodySchema,
  type ChangePasswordBody,
  currentVersionFor,
  type ForgotPasswordBody,
  ForgotPasswordBodySchema,
  HealthQuerySchema,
  isSafeReturnTo,
  type MeResponse,
  type PatchMeBody,
  PatchMeBodySchema,
  type PolicySlug,
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

  // Stripe webhook mounted BEFORE express.json() so the raw body is
  // preserved for signature verification (ADR 036 §3). Stripe signs the
  // exact bytes of the request body; any JSON parse-and-re-stringify
  // breaks the signature. The route's own `express.raw` parser only
  // matches application/json and stops at the standard Stripe payload
  // ceiling — Stripe delivers events well under 256 KB.
  app.post(
    "/webhooks/stripe",
    express.raw({ type: "application/json", limit: "256kb" }),
    asyncHandler(async (req, res) => {
      const stripeEnv = env.stripe;
      if (!stripeEnv) {
        // Local boot without Stripe keys: fail loudly so a developer who
        // hits the webhook accidentally sees why. Deployed envs can't
        // reach here — env parsing refuses to boot without the keys.
        req.log.error("stripe webhook hit without STRIPE_WEBHOOK_SECRET set");
        res.status(503).json({ error: "Stripe is not configured" });
        return;
      }
      const signature = req.header("stripe-signature");
      const result = await processWebhook({
        rawBody: req.body as Buffer,
        signature,
        webhookSecret: stripeEnv.webhookSecret,
        logger: req.log,
        siteUrl: env.siteUrl,
      });
      res.status(result.status).json({ reason: result.reason });
    }),
  );

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

    // ADR 036 Phase 8 Part B Stop 3: validate submitted policy versions
    // BEFORE calling Supabase auth so we never create a user whose
    // acceptance can't be recorded. Each field must equal the server's
    // current constant; the web form carries the constants as hidden
    // inputs rendered by the server page.
    const slugToSubmitted: Record<PolicySlug, string> = {
      terms: body.acceptedPolicyVersions.terms,
      privacy: body.acceptedPolicyVersions.privacy,
      payments_refund: body.acceptedPolicyVersions.payments_refund,
    };
    const stale: { policySlug: PolicySlug; currentVersion: string }[] = [];
    for (const slug of ["terms", "privacy", "payments_refund"] as const) {
      const expected = currentVersionFor(slug);
      if (slugToSubmitted[slug] !== expected) {
        stale.push({ policySlug: slug, currentVersion: expected });
      }
    }
    if (stale.length > 0) {
      res.status(422).json({ error: "stale_policy_versions", stale });
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

    const authUserId = data.user.id;

    // Wrap profile update + policy acceptance inserts in one transaction
    // so a failure anywhere rolls everything back together. The
    // on_auth_user_created trigger has already run by the time Supabase's
    // signUp returns, so the profile row + household + owner membership
    // all exist.
    let profileMissing = false;
    let householdMissing = false;
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(profiles)
        .set({
          ageAttestedAt: new Date(),
          ...(body.phone !== undefined && { phone: body.phone }),
        })
        .where(eq(profiles.id, authUserId))
        .returning();

      if (!rows[0]) {
        profileMissing = true;
        return;
      }

      const memberRows = await tx
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(eq(householdMembers.profileId, authUserId))
        .limit(1);
      const householdId = memberRows[0]?.householdId;
      if (!householdId) {
        householdMissing = true;
        return;
      }

      for (const slug of ["terms", "privacy", "payments_refund"] as const) {
        await applyPolicyAcceptance(tx, {
          userId: authUserId,
          policySlug: slug,
          version: currentVersionFor(slug),
          source: "signup",
          actorId: authUserId,
          householdId,
        });
      }
    });

    if (profileMissing) {
      req.log.error({ userId: authUserId }, "Profile row missing after signUp");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    if (householdMissing) {
      req.log.error(
        { userId: authUserId },
        "Household membership missing after signUp — on_auth_user_created trigger didn't fire or rolled back",
      );
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    res.status(201).end();
  }));

  // POST /auth/forgot-password — enumeration-safe reset request.
  //
  // Always returns 200 with the same generic body regardless of whether
  // the email corresponds to an account. The per-email limiter runs AFTER
  // validate() so it keys on the parsed body.email, and before the
  // Supabase call so an attacker probing an email gets a 429 identical to
  // the signup 429. A per-IP limiter is stacked on top with a generous
  // cap to catch direct-from-curl abuse without throttling legitimate
  // traffic coming through Vercel's shared egress pool.
  //
  // The redirect URL is ALWAYS built from env.siteUrl — never from a
  // request header. Trusting Host / Origin here would let an attacker
  // redirect the reset to a site they control.
  app.post(
    "/auth/forgot-password",
    validate({ body: ForgotPasswordBodySchema }),
    forgotPasswordIpLimiter,
    authEmailLimiter,
    asyncHandler(async (req, res) => {
      const body = req.body as ForgotPasswordBody;
      const redirectTo = `${env.siteUrl}/auth/reset-password`;
      // Fire-and-log: Supabase returns `error` for unknown emails too,
      // but we must not surface that to the caller. Any failure is
      // logged (no email in the log line — logs must stay PII-free) and
      // the client still gets the same generic response.
      const { error } = await supabase.auth.resetPasswordForEmail(body.email, {
        redirectTo,
      });
      if (error) {
        req.log.warn(
          { code: (error as { code?: string } | null)?.code, status: (error as { status?: number } | null)?.status },
          "resetPasswordForEmail call returned error",
        );
      }
      res.status(200).json({
        ok: true,
        message: "If there's an account for that email, we've sent a reset link.",
      });
    }),
  );

  // POST /auth/change-password — authed change flow from /account.
  //
  // Re-authenticates with the current password via a non-persisting
  // Supabase client (same pattern as /me/deletion/confirm per ADR 034),
  // then updates via the admin client so the response doesn't depend on
  // whether the user is signed in through this request's token. Enqueues
  // the password_changed email inside a transaction and kicks a sender
  // microtask after commit.
  app.post(
    "/auth/change-password",
    requireUser,
    changePasswordLimiter,
    validate({ body: ChangePasswordBodySchema }),
    asyncHandler(async (req, res) => {
      const body = req.body as ChangePasswordBody;

      const authCheckClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await authCheckClient.auth.signInWithPassword({
        email: req.userEmail,
        password: body.currentPassword,
      });
      // Scope "local" — see accountDeletion.ts: default "global" would
      // revoke every refresh token for this user, signing the parent out
      // of their live browser. The re-auth client only owns the session
      // it just minted; end only that one.
      try {
        await authCheckClient.auth.signOut({ scope: "local" });
      } catch {
        /* best-effort */
      }
      if (authError || !authData?.user) {
        req.log.warn(
          { profileId: req.profile.id, reason: "invalid_password" },
          "change-password re-auth failed",
        );
        res.status(403).json({ error: "invalid_password" });
        return;
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        req.profile.id,
        { password: body.newPassword },
      );
      if (updateError) {
        req.log.error(
          { profileId: req.profile.id, code: (updateError as { code?: string } | null)?.code },
          "change-password admin update failed",
        );
        res.status(500).json({ error: "Could not change password" });
        return;
      }

      const now = new Date();
      const resetPasswordUrl = `${env.siteUrl}/forgot-password`;
      let outboxId: string | null = null;
      try {
        outboxId = await db.transaction(async (tx) =>
          enqueuePasswordChangedEmail(tx, {
            profileId: req.profile.id,
            source: "change",
            now,
            resetPasswordUrl,
          }),
        );
      } catch (err) {
        req.log.error(
          { profileId: req.profile.id, err: err instanceof Error ? err.message : String(err) },
          "change-password email enqueue failed",
        );
        // Deliberately don't fail the request — the password change
        // succeeded; the confirmation email is best-effort.
      }

      res.status(204).end();

      if (outboxId !== null) {
        const emailOutboxId = outboxId;
        queueMicrotask(() => {
          void sendLessonEmailOutboxRow(emailOutboxId);
        });
      }
    }),
  );

  // POST /auth/notify-password-changed — enqueue the confirmation email
  // after a successful reset. The /auth/reset-password page completes
  // the Supabase recovery flow client-side (verifyOtp → updateUser →
  // signOut others), and then calls this endpoint so the backend can
  // record the event in the outbox. The authed session is the just-
  // established recovery session, so requireUser is sufficient.
  app.post(
    "/auth/notify-password-changed",
    requireUser,
    validate({}),
    asyncHandler(async (req, res) => {
      const now = new Date();
      const resetPasswordUrl = `${env.siteUrl}/forgot-password`;
      let outboxId: string | null = null;
      try {
        outboxId = await db.transaction(async (tx) =>
          enqueuePasswordChangedEmail(tx, {
            profileId: req.profile.id,
            source: "reset",
            now,
            resetPasswordUrl,
          }),
        );
      } catch (err) {
        req.log.error(
          { profileId: req.profile.id, err: err instanceof Error ? err.message : String(err) },
          "notify-password-changed enqueue failed",
        );
      }

      res.status(204).end();

      if (outboxId !== null) {
        const emailOutboxId = outboxId;
        queueMicrotask(() => {
          void sendLessonEmailOutboxRow(emailOutboxId);
        });
      }
    }),
  );

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
  app.use("/payments", paymentsRouter);
  // balanceRouter serves GET /me/balance and /me/balance/history under
  // the root; mounted alongside accountDeletionRouter which owns the
  // other /me/* paths.
  app.use(balanceRouter);
  app.use(accountDeletionRouter);
  // Policy acceptance (ADR 036 Phase 8 Part B Stop 3). requireUser lives
  // on the mount point so both /me/policies/missing and /me/policies/accept
  // reject unauthenticated callers at a single choke point.
  app.use("/me/policies", requireUser, policiesRouter);
  app.use(leaderboardRouter);

  app.use(errorHandler);

  return app;
}
