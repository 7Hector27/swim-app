import { describe, expect, it } from "vitest";
import { InvalidStateError, signState, verifyState } from "../lib/oauthState";

const SECRET = "s".repeat(32);
const COACH_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_COACH_ID = "22222222-2222-2222-2222-222222222222";

describe("oauthState", () => {
  it("round-trips a signed state and recovers the coach id", () => {
    const token = signState(COACH_ID, SECRET);
    const payload = verifyState(token, SECRET);
    expect(payload.coachId).toBe(COACH_ID);
  });

  it("produces a different token on every call (fresh nonce)", () => {
    const a = signState(COACH_ID, SECRET);
    const b = signState(COACH_ID, SECRET);
    expect(a).not.toBe(b);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signState(COACH_ID, SECRET);
    expect(() => verifyState(token, "x".repeat(32))).toThrow(InvalidStateError);
  });

  it("rejects a tampered body", () => {
    const token = signState(COACH_ID, SECRET);
    const [body, sig] = token.split(".");
    // Flip one character in the body — same signature, different payload.
    const flipped = (body![0] === "A" ? "B" : "A") + body!.slice(1);
    expect(() => verifyState(`${flipped}.${sig}`, SECRET)).toThrow(InvalidStateError);
  });

  it("rejects a tampered signature", () => {
    const token = signState(COACH_ID, SECRET);
    const [body, sig] = token.split(".");
    const flipped = (sig![0] === "A" ? "B" : "A") + sig!.slice(1);
    expect(() => verifyState(`${body}.${flipped}`, SECRET)).toThrow(InvalidStateError);
  });

  it("rejects a token with no signature separator", () => {
    expect(() => verifyState("not-a-valid-state", SECRET)).toThrow(InvalidStateError);
  });

  it("rejects a token older than the TTL", () => {
    const start = Date.now();
    const token = signState(COACH_ID, SECRET, start);
    // Default TTL = 10 min. Fast-forward 11 min.
    expect(() => verifyState(token, SECRET, { nowMs: start + 11 * 60_000 })).toThrow(
      /expired/,
    );
  });

  it("accepts a token still inside the TTL window", () => {
    const start = Date.now();
    const token = signState(COACH_ID, SECRET, start);
    const payload = verifyState(token, SECRET, { nowMs: start + 9 * 60_000 });
    expect(payload.coachId).toBe(COACH_ID);
  });

  it("rejects a far-future-dated token (clock skew limit)", () => {
    const start = Date.now();
    const token = signState(COACH_ID, SECRET, start + 10 * 60_000);
    expect(() => verifyState(token, SECRET, { nowMs: start })).toThrow(/future/);
  });

  it("binds the state to the coach id so a state issued for one coach is distinguishable", () => {
    // The signature covers the coachId in the payload. Swapping payloads
    // breaks the signature.
    const tokenA = signState(COACH_ID, SECRET);
    const tokenB = signState(OTHER_COACH_ID, SECRET);
    const [, sigA] = tokenA.split(".");
    const [bodyB] = tokenB.split(".");
    expect(() => verifyState(`${bodyB}.${sigA}`, SECRET)).toThrow(/bad_signature/);
  });
});
