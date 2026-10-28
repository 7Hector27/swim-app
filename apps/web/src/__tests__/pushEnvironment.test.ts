import { describe, it, expect } from "vitest";

import {
  describeUserAgent,
  urlBase64ToUint8Array,
} from "../content/AccountContent/NotificationsSection/pushEnvironment";

describe("urlBase64ToUint8Array", () => {
  it("decodes a url-safe base64 string", () => {
    // "any carnal pleasure." encoded as base64url (no padding, _ for /).
    const result = urlBase64ToUint8Array("YW55IGNhcm5hbCBwbGVhc3VyZS4");
    const decoded = String.fromCharCode(...result);
    expect(decoded).toBe("any carnal pleasure.");
  });

  it("round-trips a VAPID-shaped key", () => {
    // 65-byte buffer like a real VAPID public key.
    const bytes = new Uint8Array(65);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    const base64 = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = urlBase64ToUint8Array(base64);
    expect(result.length).toBe(65);
    expect(Array.from(result)).toEqual(Array.from(bytes));
  });
});

describe("describeUserAgent", () => {
  it("returns 'Unknown device' for empty input", () => {
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("")).toBe("Unknown device");
  });

  it("names Chrome on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(describeUserAgent(ua)).toBe("Chrome on macOS");
  });

  it("names Safari on iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(describeUserAgent(ua)).toBe("Safari on iOS");
  });

  it("names Edge on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(describeUserAgent(ua)).toBe("Edge on Windows");
  });

  it("falls back when the shape is unknown", () => {
    expect(describeUserAgent("Lynx/2.9")).toBe("Browser on device");
  });
});
