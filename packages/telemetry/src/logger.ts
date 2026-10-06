import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    name,
    level,
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["*.apiKey", "*.apiSecret", "*.secret", "*.password", "*.token", "headers.authorization", "*.signature"],
      censor: "[REDACTED]",
    },
  });
}
