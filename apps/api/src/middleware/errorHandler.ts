import type { Request, Response, NextFunction } from "express";
import { redactEmails } from "../services/emails/sender";

// Hard cap on the logged message length. Postgres unique/FK-violation
// messages can be hundreds of characters once they echo the row contents;
// we only need the first ~200 for triage.
const MAX_MESSAGE_LENGTH = 200;

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Never log `err` directly: pino serializes it fully, so a Postgres error
  // echoing column values or a Supabase error echoing a recipient email
  // would land in the log. Pull the three fields we actually need and run
  // the message through the same redactEmails helper used in sender.ts.
  const name = err instanceof Error ? err.name : "UnknownError";
  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = redactEmails(rawMessage).slice(0, MAX_MESSAGE_LENGTH);
  const stack = err instanceof Error ? err.stack : undefined;
  req.log.error(
    { name, message, stack, requestId: req.requestId },
    "Unhandled error",
  );
  res.status(500).json({ error: "Internal server error" });
}
