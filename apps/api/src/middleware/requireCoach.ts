import type { Request, Response, NextFunction } from "express";

export function requireCoach(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.profile.role !== "coach") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
