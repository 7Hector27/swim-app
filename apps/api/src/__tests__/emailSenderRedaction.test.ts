import { describe, it, expect } from "vitest";
import { redactEmails, shortError } from "../services/emails/sender";

describe("redactEmails", () => {
  it("replaces a bare email address with [email]", () => {
    expect(redactEmails("Delivery failed for jane.doe@example.com — bounce")).toBe(
      "Delivery failed for [email] — bounce",
    );
  });

  it("replaces multiple addresses in one string", () => {
    expect(
      redactEmails("From: alice@example.com, To: bob+promo@sub.example.co.uk"),
    ).toBe("From: [email], To: [email]");
  });

  it("handles the local-part characters RFC 5321 allows (dots, plus, hyphen, underscore, percent)", () => {
    expect(redactEmails("first.last+tag_1%ok-7@mail.example.io")).toBe("[email]");
  });

  it("leaves strings without an email untouched", () => {
    const raw = "Rate limit exceeded (code 429). Retry after 60s.";
    expect(redactEmails(raw)).toBe(raw);
  });

  it("does not match a bare @-mention", () => {
    // "@claude" has no domain-looking tail; must not be treated as an email.
    expect(redactEmails("ping @claude for a review")).toBe("ping @claude for a review");
  });

  it("does not match @ with a single-letter TLD", () => {
    // RFC pattern requires at least 2 TLD characters; keep that behavior.
    expect(redactEmails("foo@bar.c and foo@bar.io")).toBe("foo@bar.c and [email]");
  });
});

describe("shortError", () => {
  it("renders an Error with name and message, then strips emails, then truncates", () => {
    const err = new TypeError(
      "could not deliver to parent@example.com — recipient quota exceeded",
    );
    expect(shortError(err)).toBe(
      "TypeError:could not deliver to [email] — recipient quota exceeded",
    );
  });

  it("renders a non-Error value as a string and still redacts", () => {
    expect(shortError("alert from ops@internal.example.com: 500")).toBe(
      "alert from [email]: 500",
    );
  });

  it("caps the output at 200 characters AFTER redaction", () => {
    const email = "really.long.recipient@example.com";
    const padding = "x".repeat(240);
    const raw = `provider error for ${email}: ${padding}`;
    const result = shortError(new Error(raw));
    expect(result.length).toBe(200);
    expect(result).toContain("[email]");
    expect(result).not.toContain("@example.com");
  });
});
