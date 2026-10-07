import type { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  req.log.error({ err, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
}
