import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { coachAvailabilityRouter } from "./coachAvailability";
import { coachCalendarRouter } from "./coachCalendar";
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

coachRouter.use(coachAvailabilityRouter);
coachRouter.use(coachCalendarRouter);
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
