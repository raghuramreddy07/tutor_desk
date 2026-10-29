import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { redis } from "../lib/redis";
import { AppError } from "./errors";

export interface RateLimitStore {
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    windowMs: string,
  ): Promise<unknown>;
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return { count, redis.call("PTTL", KEYS[1]) }
`;

const REDIS_TIMEOUT_MS = 1_500;

export type RateLimitFailureMode = "open" | "closed";

export type RateLimitRule = {
  name: string;
  identity: string | undefined;
  limit: number;
  windowMs: number;
  failureMode?: RateLimitFailureMode;
};

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const rateLimitKey = (name: string, identity: string): string =>
  `tutordesk:rate:v1:${name}:${hash(identity)}`;

const setRateLimitHeaders = (
  res: Response,
  limit: number,
  count: number,
  ttlMs: number,
): void => {
  const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1_000));
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - count)));
  res.setHeader(
    "RateLimit-Reset",
    String(Math.ceil(Date.now() / 1_000) + resetSeconds),
  );
};

const consume = async (
  store: RateLimitStore,
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    store.eval(RATE_LIMIT_SCRIPT, 1, key, String(windowMs)),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Redis rate-limit command timed out")),
        REDIS_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  if (
    !Array.isArray(result) ||
    result.length !== 2 ||
    !Number.isSafeInteger(Number(result[0])) ||
    !Number.isFinite(Number(result[1]))
  ) {
    throw new Error("Redis returned an invalid rate-limit result");
  }
  return { count: Number(result[0]), ttlMs: Math.max(1, Number(result[1])) };
};

export const enforceRateLimits = async (
  req: Request,
  res: Response,
  rules: RateLimitRule[],
  store: RateLimitStore = {
    eval: (script, numberOfKeys, key, windowMs) =>
      redis.eval(script, numberOfKeys, key, windowMs),
  },
): Promise<void> => {
  if (!env.RATE_LIMIT_ENABLED) {
    return;
  }

  for (const rule of rules) {
    if (rule.identity === undefined) {
      continue;
    }

    try {
      const { count, ttlMs } = await consume(
        store,
        rateLimitKey(rule.name, rule.identity),
        rule.windowMs,
      );
      setRateLimitHeaders(res, rule.limit, count, ttlMs);
      if (count > rule.limit) {
        const retryAfter = Math.max(1, Math.ceil(ttlMs / 1_000));
        res.setHeader("Retry-After", String(retryAfter));
        throw new AppError(
          429,
          "RATE_LIMITED",
          "Too many requests. Please try again later.",
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if ((rule.failureMode ?? "open") === "closed") {
        console.error("Authentication rate-limit store is unavailable:", error);
        throw new AppError(
          503,
          "RATE_LIMIT_UNAVAILABLE",
          "Authentication is temporarily unavailable",
        );
      }

      console.error("Rate-limit store is unavailable; allowing request:", error);
    }
  }
};

const appliedRateLimitScopes = new WeakMap<Request, Set<string>>();

export const enforceRateLimitsOnce = async (
  req: Request,
  res: Response,
  scope: string,
  rules: RateLimitRule[],
): Promise<void> => {
  const applied = appliedRateLimitScopes.get(req);
  if (applied?.has(scope)) {
    return;
  }

  await enforceRateLimits(req, res, rules);
  const requestScopes = applied ?? new Set<string>();
  requestScopes.add(scope);
  if (!applied) {
    appliedRateLimitScopes.set(req, requestScopes);
  }
};

export const createRateLimitMiddleware = (
  rulesForRequest: (req: Request) => RateLimitRule[],
  store?: RateLimitStore,
): RequestHandler => async (req, res, next) => {
  try {
    if (store) {
      await enforceRateLimits(req, res, rulesForRequest(req), store);
    } else {
      await enforceRateLimits(req, res, rulesForRequest(req));
    }
    next();
  } catch (error) {
    next(error);
  }
};

const ipIdentity = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? "unknown";

export const globalIpRateLimit = createRateLimitMiddleware((req) => [
  {
    name: "global-ip",
    identity: ipIdentity(req),
    limit: 300,
    windowMs: 60_000,
  },
]);

export const authenticatedUserRateLimit = (req: Request): RateLimitRule[] => [
  {
    name: "authenticated-user",
    identity: req.auth.userId,
    limit: 300,
    windowMs: 60_000,
  },
];

export const centerRateLimit = (
  req: Request,
  plan: "FREE" | "PRO",
  requestsPerMinute: number,
): RateLimitRule[] => [
  {
    name: `center-${plan}`,
    identity: req.auth.centerId,
    limit: requestsPerMinute,
    windowMs: 60_000,
  },
];

const normalizedEmail = (req: Request): string | undefined => {
  const rawEmail = req.body?.email;
  if (typeof rawEmail !== "string") {
    return undefined;
  }
  const email = rawEmail.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
};

export const authenticationRateLimit = (
  endpoint: "signup" | "login" | "select-center" | "accept-invite",
): RequestHandler =>
  createRateLimitMiddleware((req) => {
    const ip = ipIdentity(req);
    const failureMode = "closed" as const;
    const rules: RateLimitRule[] = [];

    if (endpoint === "signup") {
      rules.push(
        {
          name: "auth-signup-ip",
          identity: ip,
          limit: 10,
          windowMs: 60 * 60_000,
          failureMode,
        },
        {
          name: "auth-signup-email",
          identity: normalizedEmail(req),
          limit: 3,
          windowMs: 24 * 60 * 60_000,
          failureMode,
        },
      );
    } else if (endpoint === "login") {
      rules.push(
        {
          name: "auth-login-ip",
          identity: ip,
          limit: 15,
          windowMs: 15 * 60_000,
          failureMode,
        },
        {
          name: "auth-login-email",
          identity: normalizedEmail(req),
          limit: 5,
          windowMs: 15 * 60_000,
          failureMode,
        },
      );
    } else if (endpoint === "select-center") {
      rules.push({
        name: "auth-select-center-ip",
        identity: ip,
        limit: 30,
        windowMs: 15 * 60_000,
        failureMode,
      });
    } else {
      const token = req.body?.token;
      rules.push(
        {
          name: "auth-accept-invite-ip",
          identity: ip,
          limit: 10,
          windowMs: 15 * 60_000,
          failureMode,
        },
        {
          name: "auth-accept-invite-token",
          identity: typeof token === "string" ? token : undefined,
          limit: 5,
          windowMs: 15 * 60_000,
          failureMode,
        },
      );
    }

    return rules;
  });
