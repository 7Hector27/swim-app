import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Signed OAuth `state` parameter bound to the coach's profile id. Prevents
// CSRF (random session can't forge a signature) and cross-coach hijack (a
// state issued for one coach can't be redeemed by another).
//
// Format: base64url(JSON({ coachId, nonce, iat })) + "." + base64url(hmacSHA256)
// Nonce is per-call random bytes; iat is a unix seconds timestamp. TTL is
// enforced by the verifier, not encoded in the token.

const DEFAULT_TTL_SECONDS = 10 * 60;
const NONCE_BYTES = 16;

export interface StatePayload {
  coachId: string;
  nonce: string;
  iat: number;
}

export class InvalidStateError extends Error {
  constructor(public readonly reason: string) {
    super(`Invalid OAuth state: ${reason}`);
    this.name = "InvalidStateError";
  }
}

export function signState(coachId: string, secret: string, nowMs: number = Date.now()): string {
  const payload: StatePayload = {
    coachId,
    nonce: randomNonce(),
    iat: Math.floor(nowMs / 1000),
  };
  const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = base64url(hmac(secret, body));
  return `${body}.${signature}`;
}

export interface VerifyStateOptions {
  /** Max age of the state in seconds. Defaults to 10 minutes. */
  ttlSeconds?: number;
  /** Clock injection for tests. Defaults to Date.now(). */
  nowMs?: number;
}

export function verifyState(
  token: string,
  secret: string,
  options: VerifyStateOptions = {},
): StatePayload {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowMs = options.nowMs ?? Date.now();

  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    throw new InvalidStateError("malformed");
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = base64url(hmac(secret, body));
  const sigBuf = tryFromBase64url(sig);
  const expectedBuf = tryFromBase64url(expected);
  if (!sigBuf || !expectedBuf || sigBuf.length !== expectedBuf.length) {
    throw new InvalidStateError("bad_signature");
  }
  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    throw new InvalidStateError("bad_signature");
  }

  let payload: StatePayload;
  try {
    const decoded = tryFromBase64url(body);
    if (!decoded) throw new Error("decode");
    payload = JSON.parse(decoded.toString("utf8")) as StatePayload;
  } catch {
    throw new InvalidStateError("malformed_payload");
  }
  if (typeof payload.coachId !== "string" || typeof payload.nonce !== "string" || typeof payload.iat !== "number") {
    throw new InvalidStateError("malformed_payload");
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (nowSeconds - payload.iat > ttlSeconds) {
    throw new InvalidStateError("expired");
  }
  // Reject future-dated tokens outside a small skew to avoid replay with a
  // clock set ahead on an attacker-controlled host.
  if (payload.iat - nowSeconds > 60) {
    throw new InvalidStateError("future");
  }

  return payload;
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

function randomNonce(): string {
  return base64url(randomBytes(NONCE_BYTES));
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function tryFromBase64url(input: string): Buffer | undefined {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    return Buffer.from(padded + pad, "base64");
  } catch {
    return undefined;
  }
}
