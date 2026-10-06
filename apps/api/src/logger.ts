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
      return {
        id: req.id as unknown,
        method: req.method as unknown,
        url: req.url as unknown,
        headers: req.headers as unknown,
      };
    },
  },
});
