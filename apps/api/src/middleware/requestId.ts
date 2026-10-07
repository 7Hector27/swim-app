import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id =
    typeof req.headers["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : randomUUID();

  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
