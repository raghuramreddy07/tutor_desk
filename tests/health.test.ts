import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const { queryRaw, readiness } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  readiness: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

vi.mock("../src/lib/databaseReadiness", () => ({
  checkReadiness: readiness,
}));

let app: Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    "postgresql://tutordesk:tutordesk_dev_password@localhost:5432/tutor_desk?schema=public";
  process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-chars";
  process.env.APP_URL ??= "http://localhost:3000";

  ({ app } = await import("../src/app"));
});

beforeEach(() => {
  queryRaw.mockReset();
  readiness.mockReset();
});

describe("HTTP foundation", () => {
  it("keeps the liveness health endpoint independent of dependencies", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reports database and Redis readiness separately", async () => {
    readiness.mockResolvedValue({ database: true, redis: true });

    const ready = await request(app).get("/ready");

    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      status: "ready",
      checks: { database: true, redis: true },
    });

    readiness.mockResolvedValue({ database: false, redis: true });
    const notReady = await request(app).get("/ready");
    expect(notReady.status).toBe(503);
    expect(notReady.body.status).toBe("not_ready");
  });

  it("allows only configured browser origins and limits JSON body size", async () => {
    const allowed = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );

    const blocked = await request(app)
      .get("/health")
      .set("Origin", "https://untrusted.example");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();

    const oversized = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send({ data: "x".repeat(1_100_000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("REQUEST_TOO_LARGE");
  });

  it("returns the NOT_FOUND error shape for an unknown route", async () => {
    const response = await request(app).get("/not-a-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });
});
