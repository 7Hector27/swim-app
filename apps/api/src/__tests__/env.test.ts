import { describe, expect, it } from "vitest";
import { EnvValidationError, parseDbEnv, parseEnv } from "../lib/env";

const baseEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PUBLISHABLE_KEY: "anon-key",
};

const validGoogleKey = Buffer.alloc(32, 7).toString("base64");
const validGoogleStateSecret = "s".repeat(32);
const fullGoogle = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/integrations/google/callback",
  GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleKey,
  GOOGLE_OAUTH_STATE_SECRET: validGoogleStateSecret,
};

const prodDeployBase = {
  ...baseEnv,
  NODE_ENV: "production",
  APP_ENV: "prod",
  SITE_URL: "https://app.axiomaquatics.io",
  CORS_ORIGINS: "https://app.axiomaquatics.io",
  CRON_SECRET: "a".repeat(32),
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://api.axiomaquatics.io/integrations/google/callback",
  GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleKey,
  GOOGLE_OAUTH_STATE_SECRET: validGoogleStateSecret,
  EMAIL_TRANSPORT: "resend",
  EMAIL_FROM: "Axiom Aquatics <lessons@send.axiomaquatics.io>",
  RESEND_API_KEY: "re_test_key",
};

const devDeployBase = {
  ...prodDeployBase,
  APP_ENV: "dev",
  SITE_URL: "https://dev.axiomaquatics.io",
  CORS_ORIGINS: "https://dev.axiomaquatics.io",
  GOOGLE_OAUTH_REDIRECT_URI: "https://api-dev.axiomaquatics.io/integrations/google/callback",
};

function expectIssue(raw: Record<string, string | undefined>, pattern: RegExp): EnvValidationError {
  let caught: unknown;
  try {
    parseEnv(raw);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(EnvValidationError);
  const message = (caught as EnvValidationError).issues.join("\n");
  expect(message).toMatch(pattern);
  return caught as EnvValidationError;
}

describe("parseEnv — base + local", () => {
  it("accepts a minimal local env with defaults", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.nodeEnv).toBe("development");
    expect(env.appEnv).toBe("local");
    expect(env.port).toBe(3001);
    expect(env.siteUrl).toBe("http://localhost:3000");
    expect(env.corsOrigins).toEqual([]);
    expect(env.trustProxy).toBe(0);
    expect(env.email).toBeUndefined();
    expect(env.googleOAuth).toBeUndefined();
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
    const raw = { ...baseEnv } as Record<string, string | undefined>;
    delete raw.DATABASE_URL;
    expect(() => parseEnv(raw)).toThrow(/DATABASE_URL/);
  });

  it("fails with a clear message when SUPABASE_URL is missing", () => {
    const raw = { ...baseEnv } as Record<string, string | undefined>;
    delete raw.SUPABASE_URL;
    expect(() => parseEnv(raw)).toThrow(/SUPABASE_URL/);
  });

  it("fails with a clear message when SUPABASE_URL is not a URL", () => {
    expect(() => parseEnv({ ...baseEnv, SUPABASE_URL: "not-a-url" })).toThrow(
      /SUPABASE_URL must be a valid URL/,
    );
  });

  it("refuses to boot when NODE_ENV=production without APP_ENV (fail-safe)", () => {
    expectIssue(
      { ...baseEnv, NODE_ENV: "production" },
      /APP_ENV: must be set explicitly when NODE_ENV=production/,
    );
  });
});

describe("parseEnv — APP_ENV=prod", () => {
  it("accepts a complete prod env", () => {
    const env = parseEnv(prodDeployBase);
    expect(env.appEnv).toBe("prod");
    expect(env.corsOrigins).toEqual(["https://app.axiomaquatics.io"]);
    expect(env.cronSecret).toBe("a".repeat(32));
    expect(env.email).toBeDefined();
    expect(env.email?.transport).toBe("resend");
  });

  it("rejects empty CORS_ORIGINS", () => {
    expectIssue({ ...prodDeployBase, CORS_ORIGINS: "" }, /CORS_ORIGINS/);
  });

  it("rejects a localhost SITE_URL", () => {
    expectIssue({ ...prodDeployBase, SITE_URL: "http://localhost:3000" }, /SITE_URL/);
  });

  it("rejects a missing CRON_SECRET", () => {
    const raw = { ...prodDeployBase } as Record<string, string | undefined>;
    delete raw.CRON_SECRET;
    expectIssue(raw, /CRON_SECRET/);
  });

  it("rejects a CRON_SECRET shorter than 32 characters", () => {
    expectIssue(
      { ...prodDeployBase, CRON_SECRET: "a".repeat(31) },
      /CRON_SECRET.*at least 32 characters/,
    );
  });

  it("rejects a missing GOOGLE_OAUTH_CLIENT_ID", () => {
    const raw = { ...prodDeployBase } as Record<string, string | undefined>;
    delete raw.GOOGLE_OAUTH_CLIENT_ID;
    expectIssue(raw, /GOOGLE_OAUTH_CLIENT_ID/);
  });

  it("rejects a localhost GOOGLE_OAUTH_REDIRECT_URI", () => {
    expectIssue(
      {
        ...prodDeployBase,
        GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3001/integrations/google/callback",
      },
      /GOOGLE_OAUTH_REDIRECT_URI.*localhost/,
    );
  });

  it("rejects an http GOOGLE_OAUTH_REDIRECT_URI", () => {
    expectIssue(
      {
        ...prodDeployBase,
        GOOGLE_OAUTH_REDIRECT_URI: "http://api.axiomaquatics.io/integrations/google/callback",
      },
      /GOOGLE_OAUTH_REDIRECT_URI/,
    );
  });

  it("rejects a GOOGLE_TOKEN_ENCRYPTION_KEY of the wrong length", () => {
    expectIssue(
      {
        ...prodDeployBase,
        GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64"),
      },
      /GOOGLE_TOKEN_ENCRYPTION_KEY.*32 bytes/,
    );
  });

  it("rejects a GOOGLE_OAUTH_STATE_SECRET shorter than 32 characters", () => {
    expectIssue(
      { ...prodDeployBase, GOOGLE_OAUTH_STATE_SECRET: "short" },
      /GOOGLE_OAUTH_STATE_SECRET.*32 characters/,
    );
  });

  it("rejects an EMAIL_FROM that doesn't use send.axiomaquatics.io", () => {
    expectIssue(
      { ...prodDeployBase, EMAIL_FROM: "lessons@elsewhere.example.com" },
      /EMAIL_FROM.*send\.axiomaquatics\.io/,
    );
  });

  it("rejects a missing RESEND_API_KEY", () => {
    const raw = { ...prodDeployBase } as Record<string, string | undefined>;
    delete raw.RESEND_API_KEY;
    expectIssue(raw, /RESEND_API_KEY/);
  });

  it("rejects a RESEND_API_KEY that doesn't start with re_", () => {
    expectIssue({ ...prodDeployBase, RESEND_API_KEY: "not-prefixed" }, /RESEND_API_KEY/);
  });

  it("rejects a non-resend EMAIL_TRANSPORT", () => {
    expectIssue({ ...prodDeployBase, EMAIL_TRANSPORT: "smtp" }, /EMAIL_TRANSPORT/);
  });

  it("rejects a missing EMAIL_TRANSPORT (no default to 'resend')", () => {
    const raw = { ...prodDeployBase } as Record<string, string | undefined>;
    delete raw.EMAIL_TRANSPORT;
    expectIssue(raw, /EMAIL_TRANSPORT.*required/);
  });

  it("rejects a missing EMAIL_FROM", () => {
    const raw = { ...prodDeployBase } as Record<string, string | undefined>;
    delete raw.EMAIL_FROM;
    expectIssue(raw, /EMAIL_FROM.*required/);
  });

  it("accepts EMAIL_FROM in a subdomain of send.axiomaquatics.io", () => {
    const env = parseEnv({
      ...prodDeployBase,
      EMAIL_FROM: "lessons@mail.send.axiomaquatics.io",
    });
    expect(env.email?.from).toContain("mail.send.axiomaquatics.io");
  });
});

describe("parseEnv — APP_ENV=dev", () => {
  it("accepts a complete dev env", () => {
    const env = parseEnv(devDeployBase);
    expect(env.appEnv).toBe("dev");
    expect(env.email).toBeDefined();
    expect(env.email?.transport).toBe("resend");
  });

  it("rejects a missing RESEND_API_KEY on dev as well as prod", () => {
    const raw = { ...devDeployBase } as Record<string, string | undefined>;
    delete raw.RESEND_API_KEY;
    expectIssue(raw, /RESEND_API_KEY/);
  });

  it("rejects a missing EMAIL_TRANSPORT on dev", () => {
    const raw = { ...devDeployBase } as Record<string, string | undefined>;
    delete raw.EMAIL_TRANSPORT;
    expectIssue(raw, /EMAIL_TRANSPORT.*required/);
  });

  it("rejects a missing EMAIL_FROM on dev", () => {
    const raw = { ...devDeployBase } as Record<string, string | undefined>;
    delete raw.EMAIL_FROM;
    expectIssue(raw, /EMAIL_FROM.*required/);
  });

  it("rejects a localhost SITE_URL on dev as well as prod", () => {
    expectIssue({ ...devDeployBase, SITE_URL: "http://localhost:3000" }, /SITE_URL/);
  });

  it("accepts an EMAIL_FROM at any verified domain (dev doesn't pin the domain)", () => {
    const env = parseEnv({
      ...devDeployBase,
      EMAIL_FROM: "lessons@send.axiomaquatics.io",
    });
    expect(env.email?.from).toContain("send.axiomaquatics.io");
  });
});

describe("parseEnv — APP_ENV=local + email configuration", () => {
  it("returns email=undefined when no transport is set in local", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.email).toBeUndefined();
  });

  it("returns a populated email config when local sets smtp + from", () => {
    const env = parseEnv({
      ...baseEnv,
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "Axiom Aquatics <lessons@send.axiomaquatics.io>",
      EMAIL_SMTP_HOST: "127.0.0.1",
      EMAIL_SMTP_PORT: "54325",
    });
    expect(env.email).toBeDefined();
    expect(env.email?.transport).toBe("smtp");
    expect(env.email?.smtpHost).toBe("127.0.0.1");
    expect(env.email?.smtpPort).toBe(54325);
  });

  it("accepts an EMAIL_FROM at any domain in local", () => {
    const env = parseEnv({
      ...baseEnv,
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "lessons@local.test",
    });
    expect(env.email?.from).toContain("local.test");
  });

  it("reports multiple failing variables in one error", () => {
    const raw = {
      ...prodDeployBase,
      CORS_ORIGINS: "",
      SITE_URL: "http://localhost:3000",
    } as Record<string, string | undefined>;
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

describe("parseEnv — Google OAuth (local branch)", () => {
  it("returns googleOAuth=undefined in local when no vars are set", () => {
    const env = parseEnv({ ...baseEnv });
    expect(env.googleOAuth).toBeUndefined();
  });

  it("returns googleOAuth=undefined in local when some vars are missing", () => {
    const partial = { ...fullGoogle } as Record<string, string | undefined>;
    delete partial.GOOGLE_OAUTH_CLIENT_SECRET;
    const env = parseEnv({ ...baseEnv, ...partial });
    expect(env.googleOAuth).toBeUndefined();
  });

  it("returns a populated googleOAuth in local when all five vars are valid", () => {
    const env = parseEnv({ ...baseEnv, ...fullGoogle });
    expect(env.googleOAuth).toBeDefined();
    expect(env.googleOAuth?.clientId).toBe("client-id");
    expect(env.googleOAuth?.tokenEncryptionKey.length).toBe(32);
    expect(env.googleOAuth?.stateSecret).toBe(validGoogleStateSecret);
  });

  it("returns googleOAuth=undefined when the encryption key decodes to the wrong length", () => {
    const env = parseEnv({
      ...baseEnv,
      ...fullGoogle,
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64"),
    });
    expect(env.googleOAuth).toBeUndefined();
  });

  it("returns googleOAuth=undefined when the state secret is too short", () => {
    const env = parseEnv({ ...baseEnv, ...fullGoogle, GOOGLE_OAUTH_STATE_SECRET: "short" });
    expect(env.googleOAuth).toBeUndefined();
  });
});

describe("parseDbEnv", () => {
  it("accepts an env with only DATABASE_URL set", () => {
    const env = parseDbEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/db" });
    expect(env.databaseUrl).toBe("postgres://user:pass@localhost:5432/db");
  });

  it("ignores unrelated API vars", () => {
    const env = parseDbEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      SUPABASE_URL: "not-a-url",
      CORS_ORIGINS: "",
    });
    expect(env.databaseUrl).toBe("postgres://user:pass@localhost:5432/db");
  });

  it("fails with a clear message when DATABASE_URL is missing", () => {
    let caught: unknown;
    try {
      parseDbEnv({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).message).toMatch(/DATABASE_URL/);
  });
});
