import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { coachAvailabilityRouter } from "./coachAvailability";
import { coachLessonsRouter } from "./coachLessons";
import { coachSwimmersRouter } from "./coachSwimmers";
import { evaluationsRouter, ratingsRouter, coachCategoriesRouter, sessionsRouter } from "./evaluations";
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
coachRouter.use(coachLessonsRouter);
coachRouter.use(coachCategoriesRouter);
// meetsRouter and coachLeaderboardRouter have no inline auth guards; they rely on the requireCoach applied above.
coachRouter.use(meetsRouter);
coachRouter.use(coachLeaderboardRouter);
coachRouter.use("/swimmers", coachSwimmersRouter);
coachRouter.use("/swimmers", evaluationsRouter);
coachRouter.use("/ratings", ratingsRouter);
coachRouter.use("/sessions", sessionsRouter);
