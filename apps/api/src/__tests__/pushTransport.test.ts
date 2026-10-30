// Covers two concerns:
// 1. validateVapidAtStartup — the API should refuse to boot when VAPID is
//    present but malformed (wrong-length keys, bad subject). This exists so
//    a misconfigured dev deploy fails loudly at boot instead of per-request.
// 2. classifyError / logDetail — a failing send must record a structured
//    error (name, message, code, statusCode, body) with endpoint URLs and
//    long base64url tokens redacted. The sender and the test-push route
//    both drop these fields into req.log, so this is the one chokepoint
//    that keeps secrets out of logs.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import webpush from "web-push";

import {
  __resetPushTransportForTests,
  createPushTransport,
  tagToTopic,
  validateVapidAtStartup,
  VapidStartupError,
} from "../services/notifications/pushTransport";
import { __resetEnvCacheForTests } from "../lib/env";

const validVapidPublicKey = Buffer.alloc(65, 2).toString("base64url");
const validVapidPrivateKey = Buffer.alloc(32, 3).toString("base64url");

const vapidKeys = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
const savedEnv: Record<string, string | undefined> = {};

function setVapidEnv(overrides: Partial<Record<(typeof vapidKeys)[number], string | undefined>>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetEnvCacheForTests();
  __resetPushTransportForTests();
}

beforeEach(() => {
  for (const key of vapidKeys) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of vapidKeys) {
    const original = savedEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  __resetEnvCacheForTests();
  __resetPushTransportForTests();
});

describe("validateVapidAtStartup", () => {
  it("is a no-op when no VAPID env is set (local-without-push stays bootable)", () => {
    setVapidEnv({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined });
    expect(() => validateVapidAtStartup()).not.toThrow();
  });

  it("accepts a correctly-sized key pair and valid mailto: subject", () => {
    setVapidEnv({
      VAPID_PUBLIC_KEY: validVapidPublicKey,
      VAPID_PRIVATE_KEY: validVapidPrivateKey,
      VAPID_SUBJECT: "mailto:ops@send.axiomaquatics.io",
    });
    expect(() => validateVapidAtStartup()).not.toThrow();
  });

  it("throws VapidStartupError when the public key is base64url but the wrong decoded length", () => {
    // 32 bytes, base64url-shaped — passes our env regex but web-push
    // wants 65 bytes.
    setVapidEnv({
      VAPID_PUBLIC_KEY: Buffer.alloc(32, 1).toString("base64url"),
      VAPID_PRIVATE_KEY: validVapidPrivateKey,
      VAPID_SUBJECT: "mailto:ops@send.axiomaquatics.io",
    });
    let caught: unknown;
    try {
      validateVapidAtStartup();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VapidStartupError);
    expect((caught as Error).message).toMatch(/VAPID configuration is invalid/);
    expect((caught as Error).message).toMatch(/65 bytes/);
  });

  it("throws when the private key decodes to the wrong length", () => {
    setVapidEnv({
      VAPID_PUBLIC_KEY: validVapidPublicKey,
      VAPID_PRIVATE_KEY: Buffer.alloc(16, 1).toString("base64url"),
      VAPID_SUBJECT: "mailto:ops@send.axiomaquatics.io",
    });
    expect(() => validateVapidAtStartup()).toThrow(VapidStartupError);
  });
});

describe("tagToTopic", () => {
  // Guards against the regression that produced "Unsupported characters
  // set use the URL or filename-safe Base64 characters set" from web-push:
  // our tags contain colons ("lesson:<uuid>", "daily-summary:2026-10-30")
  // and can exceed 32 chars, both of which web-push's Topic validator
  // rejects. Any topic returned here must slot straight into the header.
  const TOPIC_ALPHABET = /^[A-Za-z0-9_-]+$/;

  it("produces a topic within web-push's constraints for a long tag with colons", () => {
    const tag = `lesson:${"a".repeat(64)}:daily-summary:2026-10-30`;
    const topic = tagToTopic(tag);
    expect(topic.length).toBeGreaterThan(0);
    expect(topic.length).toBeLessThanOrEqual(32);
    expect(topic).toMatch(TOPIC_ALPHABET);
  });

  it("is deterministic — the same tag always resolves to the same topic", () => {
    const tag = "lesson:00000000-0000-0000-0000-000000000001";
    expect(tagToTopic(tag)).toBe(tagToTopic(tag));
  });

  it("yields different topics for different tags (dedup is per-notification, not global)", () => {
    expect(tagToTopic("lesson:a")).not.toBe(tagToTopic("lesson:b"));
  });
});

describe("createPushTransport error classification", () => {
  it("returns null when VAPID env is not set", () => {
    setVapidEnv({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined });
    expect(createPushTransport()).toBeNull();
  });

  async function sendOnce(err: unknown) {
    setVapidEnv({
      VAPID_PUBLIC_KEY: validVapidPublicKey,
      VAPID_PRIVATE_KEY: validVapidPrivateKey,
      VAPID_SUBJECT: "mailto:ops@send.axiomaquatics.io",
    });
    // Swap the real network call for one that rejects with the shape we
    // want to classify. Restore after so other tests in this file aren't
    // affected.
    const original = webpush.sendNotification;
    (webpush as unknown as { sendNotification: unknown }).sendNotification = () => Promise.reject(err);
    try {
      const transport = createPushTransport();
      expect(transport).not.toBeNull();
      return await transport!.send(
        {
          endpoint: "https://fcm.googleapis.com/fcm/send/abcd1234abcd1234abcd1234abcd1234abcd1234",
          p256dh: "p",
          auth: "a",
        },
        {
          title: "t",
          body: "b",
          tag: "tag",
          click_url: "/x",
          urgency: "standard",
        },
      );
    } finally {
      (webpush as unknown as { sendNotification: unknown }).sendNotification = original;
    }
  }

  it("records logDetail with the Node code for a network error", async () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND fcm.googleapis.com"), {
      code: "ENOTFOUND",
    });
    const result = await sendOnce(err);
    expect(result.outcome).toBe("fail");
    expect(result.statusCode).toBeNull();
    expect(result.shortError).toBe("net:ENOTFOUND");
    expect(result.logDetail?.errorName).toBe("Error");
    expect(result.logDetail?.errorCode).toBe("ENOTFOUND");
    // The scrubber redacts explicit URLs and long base64url chunks. A bare
    // hostname like "fcm.googleapis.com" is not a URL and may survive —
    // that's acceptable (it's the push service, not the subscription).
    expect(result.logDetail?.errorMessage).not.toMatch(/https?:\/\//);
  });

  it("records logDetail with the push-service body for a WebPushError, redacting URLs and keys", async () => {
    // Simulate a WebPushError shape with a body that references an endpoint
    // URL and a long base64url token — both must be scrubbed.
    const err = Object.assign(new Error("Received unexpected response code"), {
      name: "WebPushError",
      statusCode: 403,
      body: "VAPID credentials rejected for endpoint https://fcm.googleapis.com/fcm/send/AAAAABBBBBCCCCCDDDDDEEEEEFFFFFGGGGG",
      endpoint: "https://fcm.googleapis.com/fcm/send/AAAAABBBBBCCCCCDDDDDEEEEEFFFFFGGGGG",
    });
    const result = await sendOnce(err);
    expect(result.outcome).toBe("fail");
    expect(result.statusCode).toBe(403);
    expect(result.shortError).toBe("http_403");
    expect(result.logDetail?.errorName).toBe("WebPushError");
    expect(result.logDetail?.statusCode).toBe(403);
    expect(result.logDetail?.bodyPreview).toContain("[redacted-url]");
    expect(result.logDetail?.bodyPreview).not.toContain("fcm.googleapis.com");
  });

  it("classifies 410 Gone as outcome=gone with the status code preserved", async () => {
    const err = Object.assign(new Error("Gone"), {
      name: "WebPushError",
      statusCode: 410,
      body: "",
    });
    const result = await sendOnce(err);
    expect(result.outcome).toBe("gone");
    expect(result.statusCode).toBe(410);
    expect(result.logDetail?.statusCode).toBe(410);
  });
});
