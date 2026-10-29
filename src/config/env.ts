import "dotenv/config";
import { z } from "zod";
import { productionConfigurationIssues } from "./production";
import { configureLogger } from "../lib/logger";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  DIRECT_URL: z.string().url("DIRECT_URL must be a valid URL"),
  APP_URL: z.string().url("APP_URL must be a valid URL"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL"),
  JOB_SCHEDULE_CRON: z.string().default("0 2 * * *"),
  RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CORS_ORIGINS: z.string().default(""),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default(process.env.NODE_ENV === "test" ? "silent" : "info"),
  ENABLE_DOCS: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? process.env.NODE_ENV !== "production" : value === "true",
    ),
  ALLOW_SELF_SERVICE_PLAN_CHANGE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? process.env.NODE_ENV !== "production" : value === "true",
    ),
  JWT_SECRET: z
    .string({ error: "JWT_SECRET is required" })
    .min(32, "JWT_SECRET must be at least 32 characters long"),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^[1-9]\d*(ms|s|m|h|d|w|y)$/, "JWT_EXPIRES_IN must be a positive duration")
    .default("1d"),
}).superRefine((config, context) => {
  for (const message of productionConfigurationIssues({
    nodeEnv: config.NODE_ENV,
    jwtSecret: config.JWT_SECRET,
    corsOrigins: config.CORS_ORIGINS,
  })) {
    context.addIssue({ code: "custom", path: ["production"], message });
  }
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  process.stderr.write(
    `${JSON.stringify({
      level: "fatal",
      message: "Invalid environment configuration",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    })}\n`,
  );
  process.exit(1);
}

export const env = result.data;
configureLogger(env.NODE_ENV, env.LOG_LEVEL);
