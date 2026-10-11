import type { Request, Response, NextFunction, RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import type { IdParams } from "@swim-app/shared";
import { db } from "../db/client";
import { guardians, swimmers } from "../db/schema";
import { isActiveSwimmer } from "../db/queries";

export const requireGuardian: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // validate({ params: IdParamsSchema }) runs before this middleware.
  const { id: swimmerId } = req.params as unknown as IdParams;

  const rows = await db
    .select({ swimmerId: swimmers.id })
    .from(guardians)
    .innerJoin(
      swimmers,
      and(eq(swimmers.id, guardians.swimmerId), isActiveSwimmer),
    )
    .where(
      and(
        eq(guardians.profileId, req.profile.id),
        eq(guardians.swimmerId, swimmerId),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  next();
};
