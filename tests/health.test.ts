import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

let app: Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    "postgresql://tutordesk:tutordesk_dev_password@localhost:5432/tutor_desk?schema=public";
  process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-chars";

  ({ app } = await import("../src/app"));
});

beforeEach(() => {
  queryRaw.mockReset();
});

describe("HTTP foundation", () => {
  it("returns an ok health response when the database query succeeds", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", db: "up" });
    expect(queryRaw).toHaveBeenCalledOnce();
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
