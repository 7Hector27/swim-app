import type { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

type ValidateSchemas = {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
};

export function validate(schemas: ValidateSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body) as unknown;
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(422).json({ error: "Validation error", issues: err.issues });
        return;
      }
      next(err);
    }
  };
}
