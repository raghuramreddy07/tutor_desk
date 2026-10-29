import pino from "pino";

const allowedLevels = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

export const logger = pino({
  level: "silent",
  redact: {
    paths: [
      "authorization",
      "cookie",
      "password",
      "passwordHash",
      "token",
      "selectionToken",
      "inviteToken",
      "idempotencyKey",
      "idempotency-key",
      "body",
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["idempotency-key"]',
      "req.body.password",
      "req.body.token",
      "req.body.selectionToken",
      "req.body.inviteToken",
      "req.body.idempotencyKey",
      "err.body",
    ],
    censor: "[REDACTED]",
  },
});

export const configureLogger = (
  nodeEnv: string,
  configuredLevel: string,
): void => {
  const level =
    nodeEnv === "test"
      ? "silent"
      : allowedLevels.find((candidate) => candidate === configuredLevel) ??
        "info";
  logger.level = level;
};
