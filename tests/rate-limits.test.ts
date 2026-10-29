import { randomUUID } from "node:crypto";
import express from "express";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { globalErrorHandler } from "../src/middleware/errors";
import type { RateLimitStore } from "../src/middleware/rateLimit";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_ENABLED = "true";
process.env.TRUST_PROXY = "true";
process.env.DATABASE_URL ??=
  "******localhost:5433/tutor_desk?schema=public";
process.env.DIRECT_URL ??=
  "******localhost:5433/tutor_desk?schema=public";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-chars";
process.env.APP_URL ??= "http://localhost:3000";
process.env.REDIS_URL ??= "redis://localhost:6379";

type TestCenter = {
  userId: string;
  centerId: string;
  accessToken: string;
};

let app: Express;
let appPrisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
let jobQueue: typeof import("../src/jobs/queues").jobQueue;
let redis: typeof import("../src/lib/redis").redis;
let createRateLimitMiddleware: typeof import("../src/middleware/rateLimit").createRateLimitMiddleware;
const emails: string[] = [];
const centerIds: string[] = [];
const queuedJobIds: string[] = [];

const uniqueIp = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `198.18.${Number.parseInt(hex.slice(0, 2), 16)}.${Number.parseInt(
    hex.slice(2, 4),
    16,
  )}`;
};

const signup = async (): Promise<TestCenter> => {
  const email = `rate-limit-${randomUUID()}@example.test`;
  const response = await request(app)
    .post("/auth/signup-center")
    .set("X-Forwarded-For", `198.51.100.${Math.ceil(Math.random() * 200)}`)
    .send({
      name: "Rate limit owner",
      email,
      password: "correct horse battery",
      centerName: "Rate limit center",
    });
  expect(response.status).toBe(201);
  emails.push(email);
  const centerId = response.body.center.id as string;
  centerIds.push(centerId);
  return {
    userId: response.body.user.id as string,
    centerId,
    accessToken: response.body.accessToken as string,
  };
};

const authorized = (center: TestCenter) => {
  const authorization = ["Bearer", center.accessToken].join(" ");
  return {
    get: (path: string, ip: string) =>
      request(app)
        .get(path)
        .set("Authorization", authorization)
        .set("X-Forwarded-For", ip),
    post: (path: string, ip: string) =>
      request(app)
        .post(path)
        .set("Authorization", authorization)
        .set("X-Forwarded-For", ip),
    patch: (path: string, ip: string) =>
      request(app)
        .patch(path)
        .set("Authorization", authorization)
        .set("X-Forwarded-For", ip),
  };
};

beforeAll(async () => {
  ({ app } = await import("../src/app"));
  ({ prisma: appPrisma } = await import("../src/lib/prisma"));
  ({ jobQueue } = await import("../src/jobs/queues"));
  ({ redis } = await import("../src/lib/redis"));
  ({ createRateLimitMiddleware } = await import("../src/middleware/rateLimit"));
  ownerPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });
  await Promise.all([appPrisma.$connect(), ownerPrisma.$connect()]);
}, 30_000);

afterAll(async () => {
  for (const id of queuedJobIds) {
    const job = await jobQueue.getJob(id);
    if (job) {
      await job.remove();
    }
  }
  if (centerIds.length > 0) {
    await ownerPrisma.auditLog.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.jobOutbox.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.center.deleteMany({ where: { id: { in: centerIds } } });
  }
  if (emails.length > 0) {
    await ownerPrisma.user.deleteMany({ where: { email: { in: emails } } });
  }
  await Promise.all([
    appPrisma.$disconnect(),
    ownerPrisma.$disconnect(),
    jobQueue.close(),
    redis.quit(),
  ]);
});

describe("Redis-backed rate limits", () => {
  it("limits the global request rate by client IP", async () => {
    const ip = uniqueIp();
    const responses = await Promise.all(
      Array.from({ length: 301 }, () =>
        request(app).get("/rate-limit-probe").set("X-Forwarded-For", ip),
      ),
    );

    expect(responses.filter(({ status }) => status === 404)).toHaveLength(300);
    const blocked = responses.find(({ status }) => status === 429);
    expect(blocked?.body.error.code).toBe("RATE_LIMITED");
    expect(blocked?.headers["ratelimit-limit"]).toBe("300");
  });

  it("fails open for general traffic but closed for authentication when Redis is unavailable", async () => {
    const unavailableStore: RateLimitStore = {
      eval: async () => {
        throw new Error("Redis unavailable");
      },
    };
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const middleware = (failureMode: "open" | "closed") =>
      createRateLimitMiddleware(
        (req) => [
          {
            name: `failure-test-${failureMode}`,
            identity: req.ip,
            limit: 1,
            windowMs: 60_000,
            failureMode,
          },
        ],
        unavailableStore,
      );
    const openApp = express();
    openApp.get("/", middleware("open"), (_req, res) => res.sendStatus(200));
    openApp.use(globalErrorHandler);
    const closedApp = express();
    closedApp.get("/", middleware("closed"), (_req, res) => res.sendStatus(200));
    closedApp.use(globalErrorHandler);

    try {
      expect((await request(openApp).get("/")).status).toBe(200);
      const closedResponse = await request(closedApp).get("/");
      expect(closedResponse.status).toBe(503);
      expect(closedResponse.body.error.code).toBe("RATE_LIMIT_UNAVAILABLE");
    } finally {
      logError.mockRestore();
    }
  });

  it("limits authentication attempts by IP and normalized email", async () => {
    const email = `blocked-${randomUUID()}@example.test`;
    const emailAttempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        request(app)
          .post("/auth/login")
          .set("X-Forwarded-For", uniqueIp())
          .send({ email: email.toUpperCase(), password: "wrong-password" }),
      ),
    );
    const emailBlocked = emailAttempts.find(({ status }) => status === 429);
    expect(emailAttempts.filter(({ status }) => status === 401)).toHaveLength(5);
    expect(emailBlocked?.body.error.code).toBe("RATE_LIMITED");
    expect(emailBlocked?.headers["retry-after"]).toBeDefined();
    expect(emailBlocked?.headers["ratelimit-remaining"]).toBe("0");

    const limitedIp = uniqueIp();
    const ipAttempts = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        request(app)
          .post("/auth/login")
          .set("X-Forwarded-For", limitedIp)
          .send({
            email: `ip-attempt-${index}-${randomUUID()}@example.test`,
            password: "wrong-password",
          }),
      ),
    );
    const ipBlocked = ipAttempts.find(({ status }) => status === 429);
    expect(ipAttempts.filter(({ status }) => status === 401)).toHaveLength(15);
    expect(ipBlocked?.body.error.code).toBe("RATE_LIMITED");
  });

  it("applies the FREE plan center request budget after authentication", async () => {
    const center = await signup();
    const calls = await Promise.all(
      Array.from({ length: 61 }, () =>
        authorized(center).get("/plan", uniqueIp()),
      ),
    );

    const blocked = calls.find(({ status }) => status === 429);
    expect(calls.filter(({ status }) => status === 200)).toHaveLength(60);
    expect(blocked?.body.error.code).toBe("RATE_LIMITED");
    expect(blocked?.headers["ratelimit-limit"]).toBe("60");
  });

  it("uses the higher PRO plan center request budget", async () => {
    const center = await signup();
    const upgraded = await authorized(center)
      .patch("/plan", uniqueIp())
      .send({ plan: "PRO" });
    expect(upgraded.status).toBe(200);

    const calls = await Promise.all(
      Array.from({ length: 61 }, () =>
        authorized(center).get("/plan", uniqueIp()),
      ),
    );
    expect(calls.every(({ status }) => status === 200)).toBe(true);
    expect(calls[0].headers["ratelimit-limit"]).toBe("300");
  });

  it("limits expensive manual job runs per user and per center", async () => {
    const center = await signup();
    const calls = await Promise.all(
      Array.from({ length: 6 }, () =>
        authorized(center).post("/jobs/run-now", uniqueIp()).send({}),
      ),
    );

    const accepted = calls.filter(({ status }) => status === 202);
    const blocked = calls.find(({ status }) => status === 429);
    expect(accepted).toHaveLength(5);
    expect(blocked?.body.error.code).toBe("RATE_LIMITED");
    for (const response of accepted) {
      queuedJobIds.push(
        response.body.jobs.chargeJobId as string,
        response.body.jobs.overdueJobId as string,
      );
    }
  });
});
