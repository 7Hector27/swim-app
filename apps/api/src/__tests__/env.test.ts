import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "../lib/env";

const baseEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "anon-key",
};

describe("parseEnv", () => {
  it("accepts a minimal dev env with defaults", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.nodeEnv).toBe("development");
    expect(env.port).toBe(3001);
    expect(env.siteUrl).toBe("http://localhost:3000");
    expect(env.corsOrigins).toEqual([]);
    expect(env.trustProxy).toBe(0);
  });

  it("parses CORS_ORIGINS as a comma-separated, trimmed list", () => {
    const env = parseEnv({
      ...baseEnv,
      CORS_ORIGINS: "https://a.example.com, https://b.example.com , ",
    });
    expect(env.corsOrigins).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("coerces PORT and TRUST_PROXY from strings", () => {
    const env = parseEnv({ ...baseEnv, PORT: "4000", TRUST_PROXY: "2" });
    expect(env.port).toBe(4000);
    expect(env.trustProxy).toBe(2);
  });

  it("fails with a clear message when DATABASE_URL is missing", () => {
    const raw = { ...baseEnv } as Record<string, string>;
    delete raw.DATABASE_URL;
    expect(() => parseEnv(raw)).toThrow(/DATABASE_URL/);
  });

  it("fails with a clear message when SUPABASE_URL is missing", () => {
    const raw = { ...baseEnv } as Record<string, string>;
    delete raw.SUPABASE_URL;
    expect(() => parseEnv(raw)).toThrow(/SUPABASE_URL/);
  });

  it("fails with a clear message when SUPABASE_URL is not a URL", () => {
    expect(() => parseEnv({ ...baseEnv, SUPABASE_URL: "not-a-url" })).toThrow(
      /SUPABASE_URL must be a valid URL/,
    );
  });

  describe("in production", () => {
    const prodBase = {
      ...baseEnv,
      NODE_ENV: "production",
      SITE_URL: "https://app.example.com",
      CORS_ORIGINS: "https://app.example.com",
      CRON_SECRET: "a".repeat(32),
    };

    it("accepts a complete production env", () => {
      const env = parseEnv(prodBase);
      expect(env.nodeEnv).toBe("production");
      expect(env.corsOrigins).toEqual(["https://app.example.com"]);
      expect(env.cronSecret).toBe("a".repeat(32));
    });

    it("rejects empty CORS_ORIGINS and names the variable", () => {
      let caught: unknown;
      try {
        parseEnv({ ...prodBase, CORS_ORIGINS: "" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EnvValidationError);
      expect((caught as EnvValidationError).issues.join("\n")).toMatch(/CORS_ORIGINS/);
    });

    it("rejects a localhost SITE_URL and names the variable", () => {
      let caught: unknown;
      try {
        parseEnv({ ...prodBase, SITE_URL: "http://localhost:3000" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EnvValidationError);
      expect((caught as EnvValidationError).issues.join("\n")).toMatch(/SITE_URL/);
    });

    it("rejects a missing CRON_SECRET and names the variable", () => {
      const raw = { ...prodBase } as Record<string, string>;
      delete raw.CRON_SECRET;
      let caught: unknown;
      try {
        parseEnv(raw);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EnvValidationError);
      expect((caught as EnvValidationError).issues.join("\n")).toMatch(/CRON_SECRET/);
    });

    it("rejects a CRON_SECRET shorter than 32 characters", () => {
      let caught: unknown;
      try {
        parseEnv({ ...prodBase, CRON_SECRET: "a".repeat(31) });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EnvValidationError);
      expect((caught as EnvValidationError).issues.join("\n")).toMatch(
        /CRON_SECRET.*at least 32 characters/,
      );
    });

    it("reports every failing variable in one error", () => {
      const raw = { ...prodBase, CORS_ORIGINS: "", SITE_URL: "http://localhost:3000" } as Record<
        string,
        string
      >;
      delete raw.CRON_SECRET;
      let caught: unknown;
      try {
        parseEnv(raw);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EnvValidationError);
      const message = (caught as EnvValidationError).message;
      expect(message).toMatch(/CORS_ORIGINS/);
      expect(message).toMatch(/SITE_URL/);
      expect(message).toMatch(/CRON_SECRET/);
    });
  });
});
