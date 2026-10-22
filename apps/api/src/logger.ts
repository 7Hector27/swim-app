import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: isDev ? "debug" : "info",
  ...(isDev && { transport: { target: "pino-pretty", options: { colorize: true } } }),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie"],
    censor: "[REDACTED]",
  },
  serializers: {
    req(req) {
      const rawUrl = (req.url as string | undefined) ?? "";
      const url = sanitizeUrl(rawUrl);
      return {
        id: req.id as unknown,
        method: req.method as unknown,
        url,
        headers: req.headers as unknown,
      };
    },
  },
});

// URL redactions applied before any request/response ever reaches a log sink.
// Add new rules here instead of sprinkling them across route handlers.
function sanitizeUrl(url: string): string {
  // Invite tokens are 20+ char base64url strings embedded in the path.
  let out = url.replace(/^(\/invites\/)([A-Za-z0-9_-]{20,})(\/|$)/, "$1[redacted]$3");

  // Google OAuth callback: both ?code and ?state are high-value secrets. The
  // code is a one-time grant redeemable for a refresh token; the state is the
  // signed CSRF binding. Replace values but keep the keys so log readers can
  // still see the shape of the request.
  if (out.startsWith("/integrations/google/callback")) {
    out = out.replace(/([?&])code=[^&]*/gi, "$1code=[redacted]");
    out = out.replace(/([?&])state=[^&]*/gi, "$1state=[redacted]");
  }

  return out;
}
