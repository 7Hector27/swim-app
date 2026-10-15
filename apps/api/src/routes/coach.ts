import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { requireCoach } from "../middleware/requireCoach";
import { coachAvailabilityRouter } from "./coachAvailability";
import { coachLessonsRouter } from "./coachLessons";
import { coachSwimmersRouter } from "./coachSwimmers";
import { evaluationsRouter, ratingsRouter, coachCategoriesRouter, sessionsRouter } from "./evaluations";
import { meetsRouter } from "./meets";

export const coachRouter = Router();

// Auth runs exactly once for all /coach/* requests.
coachRouter.use(requireUser, requireCoach);

coachRouter.use(coachAvailabilityRouter);
coachRouter.use(coachLessonsRouter);
coachRouter.use(coachCategoriesRouter);
coachRouter.use(meetsRouter);
coachRouter.use("/swimmers", coachSwimmersRouter);
coachRouter.use("/swimmers", evaluationsRouter);
coachRouter.use("/ratings", ratingsRouter);
coachRouter.use("/sessions", sessionsRouter);
