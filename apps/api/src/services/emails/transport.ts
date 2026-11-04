// Transport layer for parent booking emails. Picks SMTP (Mailpit locally)
// or Resend (dev/prod) based on APP_ENV + EMAIL_TRANSPORT. The sender
// (./sender.ts) is the sole caller. See ADR 028.
//
// Every send carries an idempotency key equal to the outbox row id. Resend
// honors the Idempotency-Key header to make a retry of the same send a
// no-op on their side; SMTP has no equivalent, so the duplicate-send
// window there is bounded only by the claim-before-send protocol.

import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailEnv } from "../../lib/env";
import {
  OUTBOUND_TIMEOUT_MS,
  isAbortSignalTimeout,
  withTimeout,
} from "../../lib/outboundTimeout";

export interface IcsAttachment {
  // "invite.ics" (REQUEST) or "cancel.ics" (CANCEL).
  filename: string;
  // The raw .ics body (CRLF-terminated per RFC 5545).
  content: string;
  // The .ics method, surfaced into the attachment's Content-Type so Gmail
  // and Apple Mail render the invite preview card.
  method: "REQUEST" | "CANCEL";
}

export interface TransportSendOptions {
  from: string;
  replyTo: string | undefined;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  // Optional .ics attachment. The transport sets content-type to
  // `text/calendar; method=REQUEST|CANCEL; charset=UTF-8` so Gmail renders
  // the invite card and calendar clients consume the SEQUENCE properly.
  ics?: IcsAttachment;
  // The outbox row id. Passed as Resend's Idempotency-Key; included in
  // SMTP's Message-ID header for traceability.
  idempotencyKey: string;
}

export type TransportError =
  | { kind: "config" }
  | { kind: "rate_limit" }
  | { kind: "server" }
  | { kind: "unexpected" };

export interface TransportResult {
  ok: boolean;
  providerMessageId: string | null;
  error: TransportError | null;
  errorMessage: string | null;
}

export interface EmailTransport {
  send(opts: TransportSendOptions): Promise<TransportResult>;
}

export class ResendTransport implements EmailTransport {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(opts: TransportSendOptions): Promise<TransportResult> {
    // AbortController + setTimeout fires at OUTBOUND_TIMEOUT_MS and the
    // Resend SDK forwards the signal to fetch, so the HTTP request is
    // actually cancelled (not just ignored like Promise.race would do).
    // Using setTimeout (not AbortSignal.timeout) so vitest fake-timers can
    // advance the clock in tests. A timeout maps to the `server` kind so
    // the outbox retries on the next tick.
    const controller = new AbortController();
    const signal = controller.signal;
    const timeoutHandle = setTimeout(
      () => controller.abort(new DOMException("timeout", "TimeoutError")),
      OUTBOUND_TIMEOUT_MS,
    );
    try {
      // The Resend SDK v6 accepts { idempotencyKey, signal } as a second
      // parameter to emails.send(). The resulting header is Idempotency-Key.
      const response = await this.client.emails.send(
        {
          from: opts.from,
          to: opts.to,
          subject: opts.subject,
          text: opts.text,
          ...(opts.html && { html: opts.html }),
          ...(opts.replyTo && { replyTo: opts.replyTo }),
          ...(opts.ics && {
            attachments: [
              {
                filename: opts.ics.filename,
                content: Buffer.from(opts.ics.content, "utf-8").toString("base64"),
                // Resend's attachments API carries contentType per spec,
                // so set the full text/calendar line including method so
                // Gmail renders the invite preview card.
                contentType: `text/calendar; method=${opts.ics.method}; charset=UTF-8`,
              },
            ],
          }),
        },
        { idempotencyKey: opts.idempotencyKey, signal },
      );
      if (response.error) {
        return classifyResendError(response.error);
      }
      return {
        ok: true,
        providerMessageId: response.data?.id ?? null,
        error: null,
        errorMessage: null,
      };
    } catch (err) {
      if (isAbortSignalTimeout(signal, err)) {
        return {
          ok: false,
          providerMessageId: null,
          error: { kind: "server" },
          errorMessage: `timeout:${OUTBOUND_TIMEOUT_MS}ms`,
        };
      }
      return {
        ok: false,
        providerMessageId: null,
        error: { kind: "unexpected" },
        errorMessage: errorToShortMessage(err),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

interface ResendErrorShape {
  readonly name?: string;
  readonly message?: string;
  readonly statusCode?: number;
}

function classifyResendError(err: unknown): TransportResult {
  const shape = err as ResendErrorShape;
  const name = typeof shape.name === "string" ? shape.name : "resend_error";
  const message = typeof shape.message === "string" ? shape.message : "";
  const statusCode = typeof shape.statusCode === "number" ? shape.statusCode : 0;
  let kind: TransportError["kind"];
  if (statusCode === 429) {
    kind = "rate_limit";
  } else if (statusCode >= 500) {
    kind = "server";
  } else if (statusCode >= 400) {
    kind = "config";
  } else {
    kind = "unexpected";
  }
  return {
    ok: false,
    providerMessageId: null,
    error: { kind },
    // Short, no PII — just the Resend error name + status.
    errorMessage: `${name}:${statusCode || "0"}:${truncate(message, 80)}`,
  };
}

export class SmtpTransport implements EmailTransport {
  private readonly transporter: Transporter;
  private readonly fromDefault: string;

  constructor(host: string, port: number, from: string) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      // Mailpit does not require auth; disable the plain-text auth
      // warning emitted by nodemailer when auth is omitted.
      ignoreTLS: true,
    });
    this.fromDefault = from;
  }

  async send(opts: TransportSendOptions): Promise<TransportResult> {
    try {
      const info = await withTimeout(
        this.transporter.sendMail({
          from: opts.from || this.fromDefault,
          to: opts.to.join(", "),
          subject: opts.subject,
          text: opts.text,
          ...(opts.html && { html: opts.html }),
          ...(opts.replyTo && { replyTo: opts.replyTo }),
          ...(opts.ics && {
            attachments: [
              {
                filename: opts.ics.filename,
                content: opts.ics.content,
                // charset=UTF-8 so Gmail renders the invite card. method=…
                // tells calendar clients how to treat the SEQUENCE.
                contentType: `text/calendar; method=${opts.ics.method}; charset=UTF-8`,
              },
            ],
          }),
          headers: {
            // Carries the outbox id to the Mailpit UI for traceability.
            "X-Idempotency-Key": opts.idempotencyKey,
          },
        }),
        "smtp.sendMail",
      );
      return {
        ok: true,
        providerMessageId: typeof info.messageId === "string" ? info.messageId : null,
        error: null,
        errorMessage: null,
      };
    } catch (err) {
      return {
        ok: false,
        providerMessageId: null,
        error: { kind: "server" },
        errorMessage: errorToShortMessage(err),
      };
    }
  }
}

export function createTransport(env: EmailEnv): EmailTransport | null {
  if (env.transport === "resend") {
    if (!env.resendApiKey) return null;
    return new ResendTransport(env.resendApiKey);
  }
  if (env.transport === "smtp") {
    if (!env.smtpHost || !env.smtpPort) return null;
    return new SmtpTransport(env.smtpHost, env.smtpPort, env.from);
  }
  return null;
}

function errorToShortMessage(err: unknown): string {
  if (err instanceof Error) return truncate(`${err.name}:${err.message}`, 160);
  return truncate(String(err), 160);
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, max - 1) + "…";
}
