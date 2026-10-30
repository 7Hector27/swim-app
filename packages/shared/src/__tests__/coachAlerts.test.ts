import { describe, expect, it } from "vitest";

import {
  CoachPushSubscriptionRegisterSchema,
  normalizeSubscriptionKey,
} from "../schemas/coachAlerts";

const validEndpoint = "https://fcm.googleapis.com/fcm/send/abcd1234";

describe("CoachPushSubscriptionRegisterSchema", () => {
  it("normalizes standard-base64 keys to base64url on parse", () => {
    // Standard base64 arrives from older Safari builds; the Push API spec
    // calls for base64url but the server treats both as acceptable input
    // and stores the normalized form.
    const result = CoachPushSubscriptionRegisterSchema.safeParse({
      endpoint: validEndpoint,
      keys: {
        p256dh: "aGVsbG8rLy93b3JsZA==",
        auth: "QS9CKzE=",
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.data.keys.p256dh).toBe("aGVsbG8rLy93b3JsZA");
    expect(result.data.keys.p256dh).not.toContain("+");
    expect(result.data.keys.p256dh).not.toContain("/");
    expect(result.data.keys.p256dh).not.toContain("=");
    expect(result.data.keys.auth).toBe("QS9CKzE");
  });

  it("leaves already-base64url keys unchanged", () => {
    const parsed = CoachPushSubscriptionRegisterSchema.parse({
      endpoint: validEndpoint,
      keys: { p256dh: "AAAA-BBBB_CCCC", auth: "DDDD-EEEE_FFFF" },
    });
    expect(parsed.keys.p256dh).toBe("AAAA-BBBB_CCCC");
    expect(parsed.keys.auth).toBe("DDDD-EEEE_FFFF");
  });

  it("rejects keys with characters outside the base64 alphabet", () => {
    const result = CoachPushSubscriptionRegisterSchema.safeParse({
      endpoint: validEndpoint,
      // A space is not valid base64 or base64url — the normalizer only
      // touches +/= so a space survives and the refine step catches it.
      keys: { p256dh: "has spaces", auth: "AAAA" },
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("keys.p256dh");
  });

  it("rejects an empty key", () => {
    const result = CoachPushSubscriptionRegisterSchema.safeParse({
      endpoint: validEndpoint,
      keys: { p256dh: "", auth: "AAAA" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a key whose only non-base64url chars survive normalization", () => {
    const result = CoachPushSubscriptionRegisterSchema.safeParse({
      endpoint: validEndpoint,
      // A `#` is not touched by the normalizer and isn't base64url.
      keys: { p256dh: "abcd#efgh", auth: "AAAA" },
    });
    expect(result.success).toBe(false);
  });
});

describe("normalizeSubscriptionKey", () => {
  it("is idempotent on base64url input", () => {
    expect(normalizeSubscriptionKey("AAAA-BBBB_CCCC")).toBe("AAAA-BBBB_CCCC");
  });

  it("rewrites + to -, / to _ and strips trailing =", () => {
    expect(normalizeSubscriptionKey("A+B/C==")).toBe("A-B_C");
  });

  it("only strips trailing =, never interior =", () => {
    // Interior `=` isn't valid base64 at all, but the normalizer isn't
    // responsible for validating — it just rewrites. The downstream
    // refine step rejects anything that still contains '='.
    expect(normalizeSubscriptionKey("A=B=")).toBe("A=B");
  });
});
