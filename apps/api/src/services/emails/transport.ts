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

export interface TransportSendOptions {
  from: string;
  replyTo: string | undefined;
  to: string[];
  subject: string;
  text: string;
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
    try {
      // The Resend SDK v6 accepts { idempotencyKey } as a second parameter
      // to emails.send(). The resulting header is Idempotency-Key.
      const response = await this.client.emails.send(
        {
          from: opts.from,
          to: opts.to,
          subject: opts.subject,
          text: opts.text,
          ...(opts.replyTo && { replyTo: opts.replyTo }),
        },
        { idempotencyKey: opts.idempotencyKey },
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
      return {
        ok: false,
        providerMessageId: null,
        error: { kind: "unexpected" },
        errorMessage: errorToShortMessage(err),
      };
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
      const info = await this.transporter.sendMail({
        from: opts.from || this.fromDefault,
        to: opts.to.join(", "),
        subject: opts.subject,
        text: opts.text,
        ...(opts.replyTo && { replyTo: opts.replyTo }),
        headers: {
          // Carries the outbox id to the Mailpit UI for traceability.
          "X-Idempotency-Key": opts.idempotencyKey,
        },
      });
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
