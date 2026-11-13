import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { cashRefundJobsRouter } from "./cashRefundJobs";
import { coachAlertsRouter } from "./coachAlerts";
import { coachAvailabilityRouter } from "./coachAvailability";
import { coachBatchesRouter } from "./coachBatches";
import { coachBulkCancelRouter } from "./coachBulkCancel";
import { coachCalendarRouter } from "./coachCalendar";
import { coachHouseholdsRouter } from "./coachHouseholds";
import { coachLessonsRouter } from "./coachLessons";
import { coachSwimmersRouter } from "./coachSwimmers";
import { evaluationsRouter, ratingsRouter, coachCategoriesRouter, coachScreensRouter, sessionsRouter } from "./evaluations";
import { coachDraftsRouter, draftsRouter } from "./drafts";
import { meetsRouter } from "./meets";
import { coachLeaderboardRouter } from "./coachLeaderboard";
import { validate } from "../middleware/validate";

export const coachRouter = Router();

// Auth runs exactly once for all /coach/* requests.
coachRouter.use(requireUser, requireCoach);

coachRouter.get("/ping", validate({}), (_req, res) => {
  res.json({ pong: true });
});

coachRouter.use(cashRefundJobsRouter);
coachRouter.use(coachAlertsRouter);
coachRouter.use(coachAvailabilityRouter);
coachRouter.use(coachBatchesRouter);
coachRouter.use(coachCalendarRouter);
// Bulk-cancel endpoints live under /coach/lessons/bulk-cancel. Mount before
// coachLessonsRouter so the specific path matches first.
coachRouter.use(coachBulkCancelRouter);
// coachHouseholdsRouter owns /coach/households/balances + per-id balance
// views. Mount it before coachLessonsRouter (which hosts GET
// /coach/households search) so the specific /balances suffix matches first.
coachRouter.use(coachHouseholdsRouter);
coachRouter.use(coachLessonsRouter);
coachRouter.use(coachCategoriesRouter);
coachRouter.use(coachScreensRouter);
// meetsRouter and coachLeaderboardRouter have no inline auth guards; they rely on the requireCoach applied above.
coachRouter.use(meetsRouter);
coachRouter.use(coachLeaderboardRouter);
coachRouter.use("/swimmers", coachSwimmersRouter);
coachRouter.use("/swimmers", evaluationsRouter);
coachRouter.use("/swimmers", coachDraftsRouter);
coachRouter.use("/drafts", draftsRouter);
coachRouter.use("/ratings", ratingsRouter);
coachRouter.use("/sessions", sessionsRouter);
