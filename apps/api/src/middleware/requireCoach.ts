import type { Request, Response, NextFunction } from "express";

export function requireCoach(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.profile.role !== "coach") {
    req.log.warn({ userId: req.profile.id, reason: "insufficient_role" }, "access denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
