import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let prisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
const userIds: string[] = [];
const centerIds: string[] = [];
const emailForRun = `auth-${randomUUID()}@example.test`;
const password = "correct horse battery";

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    "******localhost:5433/tutor_desk?schema=public";
  process.env.DIRECT_URL ??=
    "postgresql://tutordesk:tutordesk_dev_password@localhost:5433/tutor_desk?schema=public";
  process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-chars";
  process.env.APP_URL ??= "http://localhost:3000";

  ({ app } = await import("../src/app"));
  ({ prisma } = await import("../src/lib/prisma"));
  ownerPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });
  await Promise.all([prisma.$connect(), ownerPrisma.$connect()]);
});

afterAll(async () => {
  if (centerIds.length > 0) {
    await ownerPrisma.auditLog.deleteMany({
      where: { centerId: { in: centerIds } },
    });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (centerIds.length > 0) {
    await prisma.center.deleteMany({ where: { id: { in: centerIds } } });
  }
  await Promise.all([prisma.$disconnect(), ownerPrisma.$disconnect()]);
});

const registerCenter = async (email = emailForRun, centerName = "Auth Test Center") => {
  const response = await request(app).post("/auth/signup-center").send({
    name: "Auth Test User",
    email,
    password,
    centerName,
  });
  if (response.status === 201) {
    userIds.push(response.body.user.id as string);
    centerIds.push(response.body.center.id as string);
  }
  return response;
};

const createUserWithCenters = async (count: number) => {
  const user = await prisma.user.create({
    data: {
      name: "Multi-center User",
      email: `multi-${randomUUID()}@example.test`,
      passwordHash: await (await import("../src/lib/password")).hashPassword(password),
    },
  });
  userIds.push(user.id);

  const centers = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      prisma.center.create({ data: { name: `Multi-center ${randomUUID()} ${index}` } }),
    ),
  );
  centerIds.push(...centers.map(({ id }) => id));

  await prisma.membership.createMany({
    data: centers.map((center, index) => ({
      userId: user.id,
      centerId: center.id,
      role: index === 0 ? "OWNER" : "TEACHER",
    })),
  });

  return { user, centers };
};

describe("identity and tenancy", () => {
  it("creates a user, center, and OWNER membership in signup", async () => {
    const response = await registerCenter(` ${emailForRun.toUpperCase()} `);

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: emailForRun,
      name: "Auth Test User",
    });
    expect(response.body.center).toMatchObject({
      name: "Auth Test Center",
      plan: "FREE",
    });
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty("user.passwordHash");

    const membership = await prisma.membership.findUnique({
      where: {
        userId_centerId: {
          userId: response.body.user.id as string,
          centerId: response.body.center.id as string,
        },
      },
    });
    expect(membership?.role).toBe("OWNER");
    expect(await prisma.user.count({ where: { email: emailForRun } })).toBe(1);
  });

  it("rejects an existing email without creating another center", async () => {
    const email = `duplicate-${randomUUID()}@example.test`;
    const first = await registerCenter(email, "Existing Center");
    const duplicate = await registerCenter(email, "Must Not Be Created");

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EMAIL_TAKEN");
    expect(
      await prisma.center.count({ where: { name: "Must Not Be Created" } }),
    ).toBe(0);
  });

  it("leaves no rows behind when a signup transaction fails", async () => {
    const email = `rollback-${randomUUID()}@example.test`;
    const response = await request(app).post("/auth/signup-center").send({
      name: "Rollback Test",
      email,
      password,
      centerName: `Rollback\u0000${email}`,
    });

    expect(response.status).toBe(500);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.center.count({ where: { name: `Rollback${email}` } })).toBe(0);
  });

  it("returns identical generic errors for unknown emails and wrong passwords", async () => {
    const created = await registerCenter(`login-${randomUUID()}@example.test`);
    expect(created.status).toBe(201);

    const wrongPassword = await request(app).post("/auth/login").send({
      email: created.body.user.email,
      password: "wrong password",
    });
    const unknownEmail = await request(app).post("/auth/login").send({
      email: `unknown-${randomUUID()}@example.test`,
      password,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  });

  it("rejects a valid user who has no center memberships", async () => {
    const { hashPassword } = await import("../src/lib/password");
    const user = await prisma.user.create({
      data: {
        name: "No Center User",
        email: `no-center-${randomUUID()}@example.test`,
        passwordHash: await hashPassword(password),
      },
    });
    userIds.push(user.id);

    const response = await request(app).post("/auth/login").send({
      email: user.email,
      password,
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("NO_CENTER");
  });

  it("gives a one-center user an access token directly from login", async () => {
    const created = await registerCenter(`single-${randomUUID()}@example.test`);
    const response = await request(app).post("/auth/login").send({
      email: created.body.user.email,
      password,
    });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.center.id).toBe(created.body.center.id);
    expect(response.body.role).toBe("OWNER");
    expect(response.body).not.toHaveProperty("passwordHash");
  });

  it("requires center selection for multi-center users and issues an access token", async () => {
    const { user, centers } = await createUserWithCenters(2);
    const login = await request(app).post("/auth/login").send({
      email: user.email,
      password,
    });

    expect(login.status).toBe(200);
    expect(login.body.centers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: centers[0].id, role: "OWNER" }),
        expect.objectContaining({ id: centers[1].id, role: "TEACHER" }),
      ]),
    );
    expect(login.body.accessToken).toBeUndefined();

    const selection = await request(app).post("/auth/select-center").send({
      selectionToken: login.body.selectionToken,
      centerId: centers[1].id,
    });
    expect(selection.status).toBe(200);
    expect(selection.body.accessToken).toEqual(expect.any(String));

    const me = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${selection.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.center.id).toBe(centers[1].id);
    expect(me.body.role).toBe("TEACHER");
  });

  it("rejects selecting a center the user does not belong to", async () => {
    const { user } = await createUserWithCenters(2);
    const outsideCenter = await prisma.center.create({
      data: { name: `Outside ${randomUUID()}` },
    });
    centerIds.push(outsideCenter.id);

    const login = await request(app).post("/auth/login").send({
      email: user.email,
      password,
    });
    const response = await request(app).post("/auth/select-center").send({
      selectionToken: login.body.selectionToken ?? "not-a-selection-token",
      centerId: outsideCenter.id,
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("NOT_A_MEMBER");
  });

  it("does not allow selection tokens on /me or access tokens for center selection", async () => {
    const { user, centers } = await createUserWithCenters(2);
    const login = await request(app).post("/auth/login").send({
      email: user.email,
      password,
    });
    const meWithSelection = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${login.body.selectionToken}`);
    const selectionWithAccess = await request(app).post("/auth/select-center").send({
      selectionToken: createAccessTokenForTest(user.id, centers[0].id),
      centerId: centers[0].id,
    });

    expect(meWithSelection.status).toBe(401);
    expect(meWithSelection.body.error.code).toBe("UNAUTHORIZED");
    expect(selectionWithAccess.status).toBe(401);
    expect(selectionWithAccess.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns user, center, and role from /me without exposing the password hash", async () => {
    const created = await registerCenter(`me-${randomUUID()}@example.test`);
    const response = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${created.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        id: created.body.user.id,
        name: "Auth Test User",
        email: created.body.user.email,
      },
      center: {
        id: created.body.center.id,
        name: "Auth Test Center",
        plan: "FREE",
      },
      role: "OWNER",
    });
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it.each(["missing", "garbage", "expired"])(
    "rejects %s tokens on /me",
    async (tokenType) => {
      const created = await registerCenter(`token-${randomUUID()}@example.test`);
      const token =
        tokenType === "missing"
          ? undefined
          : tokenType === "garbage"
            ? "not.a.jwt"
            : jwt.sign(
                {
                  userId: created.body.user.id,
                  centerId: created.body.center.id,
                  role: "OWNER",
                  typ: "access",
                },
                process.env.JWT_SECRET as string,
                { expiresIn: -1 },
              );

      const requestBuilder = request(app).get("/me");
      if (token) {
        requestBuilder.set("Authorization", `Bearer ${token}`);
      }
      const response = await requestBuilder;

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    },
  );

  it("rejects a still-valid token after its membership is deleted", async () => {
    const created = await registerCenter(`revoked-${randomUUID()}@example.test`);
    await prisma.membership.deleteMany({
      where: {
        userId: created.body.user.id,
        centerId: created.body.center.id,
      },
    });

    const response = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${created.body.accessToken}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TENANT_ACCESS_REVOKED");
  });

  it("uses the current database role instead of the token role", async () => {
    const created = await registerCenter(`role-${randomUUID()}@example.test`);
    await prisma.membership.update({
      where: {
        userId_centerId: {
          userId: created.body.user.id,
          centerId: created.body.center.id,
        },
      },
      data: { role: "TEACHER" },
    });

    const response = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${created.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("TEACHER");
  });
});

const createAccessTokenForTest = (userId: string, centerId: string): string =>
  jwt.sign(
    { userId, centerId, role: "OWNER", typ: "access" },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" },
  );
