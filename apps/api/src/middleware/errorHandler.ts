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
  // body-parser's 413 (payload too large) and 400 (malformed JSON) are
  // client errors, not server errors — surface the correct status and the
  // standard { error } shape instead of hiding them behind a generic 500.
  const shaped = err as { type?: string; status?: number; statusCode?: number };
  const status = shaped.statusCode ?? shaped.status;
  if (shaped.type === "entity.too.large") {
    req.log.warn(
      { type: shaped.type, requestId: req.requestId },
      "request body too large",
    );
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  if (shaped.type === "entity.parse.failed" || status === 400) {
    req.log.warn(
      { type: shaped.type, requestId: req.requestId },
      "malformed request body",
    );
    res.status(400).json({ error: "Malformed request body" });
    return;
  }

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
