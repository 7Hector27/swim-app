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
      // Redact invite tokens from the URL so raw tokens never appear in logs.
      // Tokens are 43-char base64url strings; match /invites/<token>[/...].
      const rawUrl = (req.url as string | undefined) ?? "";
      const url = rawUrl.replace(/^(\/invites\/)([A-Za-z0-9_-]{20,})(\/|$)/, "$1[redacted]$3");
      return {
        id: req.id as unknown,
        method: req.method as unknown,
        url,
        headers: req.headers as unknown,
      };
    },
  },
});
