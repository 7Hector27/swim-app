import type { Request, Response, NextFunction } from "express";

export function requireParent(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.profile.role !== "parent") {
    req.log.warn({ userId: req.profile.id, reason: "insufficient_role" }, "access denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
