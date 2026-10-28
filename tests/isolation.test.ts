import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type CreatedCenter = {
  userId: string;
  centerId: string;
  accessToken: string;
};

type CreatedStudent = {
  id: string;
  centerId: string;
  name: string;
};

let app: Express;
let appPrisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
let centerA: CreatedCenter;
let centerB: CreatedCenter;
let studentA: CreatedStudent;
let studentB: CreatedStudent;
const userIds: string[] = [];
const centerIds: string[] = [];

const signup = async (label: string): Promise<CreatedCenter> => {
  const response = await request(app).post("/auth/signup-center").send({
    name: `Isolation ${label}`,
    email: `isolation-${label}-${randomUUID()}@example.test`,
    password: "correct horse battery",
    centerName: `Isolation ${label}`,
  });

  if (response.status !== 201) {
    throw new Error(`Could not create isolation test center ${label}`);
  }

  const center: CreatedCenter = {
    userId: response.body.user.id as string,
    centerId: response.body.center.id as string,
    accessToken: response.body.accessToken as string,
  };
  userIds.push(center.userId);
  centerIds.push(center.centerId);
  return center;
};

const createStudent = async (
  center: CreatedCenter,
  name: string,
): Promise<CreatedStudent> => {
  const response = await request(app)
    .post("/students")
    .set("Authorization", `Bearer ${center.accessToken}`)
    .send({ name });

  if (response.status !== 201) {
    throw new Error(`Could not create isolation test student ${name}`);
  }
  return response.body.student as CreatedStudent;
};

const authorized = (center: CreatedCenter) => {
  const token = `Bearer ${center.accessToken}`;
  return {
    get: (path: string) => request(app).get(path).set("Authorization", token),
    post: (path: string) => request(app).post(path).set("Authorization", token),
    patch: (path: string) => request(app).patch(path).set("Authorization", token),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", token),
  };
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    "postgresql://tutordesk_app:tutordesk_app_dev_password@localhost:5433/tutor_desk?schema=public";
  process.env.DIRECT_URL ??=
    "postgresql://tutordesk:tutordesk_dev_password@localhost:5433/tutor_desk?schema=public";
  process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-chars";
  process.env.APP_URL ??= "http://localhost:3000";

  ({ app } = await import("../src/app"));
  ({ prisma: appPrisma } = await import("../src/lib/prisma"));
  ownerPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });
  await Promise.all([appPrisma.$connect(), ownerPrisma.$connect()]);

  centerA = await signup("A");
  centerB = await signup("B");
  studentA = await createStudent(centerA, "Center A student");
  studentB = await createStudent(centerB, "Center B student");
});

afterAll(async () => {
  if (centerIds.length > 0) {
    await ownerPrisma.center.deleteMany({
      where: { id: { in: centerIds } },
    });
  }
  if (userIds.length > 0) {
    await ownerPrisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }
  await Promise.all([appPrisma.$disconnect(), ownerPrisma.$disconnect()]);
});

describe("tenant isolation", () => {
  it("lists only the authenticated center's students", async () => {
    const response = await authorized(centerA).get(
      `/students?centerId=${centerB.centerId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.students).toEqual([
      expect.objectContaining({ id: studentA.id, centerId: centerA.centerId }),
    ]);
    expect(response.body.students).not.toContainEqual(
      expect.objectContaining({ id: studentB.id }),
    );
    expect(response.body).toMatchObject({ total: 1, limit: 50, offset: 0 });
  });

  it("rejects pagination limits above the configured maximum", async () => {
    const response = await authorized(centerA).get("/students?limit=101");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("supports create, list pagination, get, patch, and delete for one center", async () => {
    const created = await authorized(centerA)
      .post("/students")
      .send({ name: "Temporary student", grade: "7", phone: "555-0100" });
    expect(created.status).toBe(201);
    expect(created.body.student).toMatchObject({
      centerId: centerA.centerId,
      name: "Temporary student",
      grade: "7",
      phone: "555-0100",
    });

    const listed = await authorized(centerA).get("/students?limit=1&offset=0");
    expect(listed.status).toBe(200);
    expect(listed.body.students).toHaveLength(1);
    expect(listed.body.limit).toBe(1);

    const fetched = await authorized(centerA).get(
      `/students/${created.body.student.id}`,
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body.student.id).toBe(created.body.student.id);

    const patched = await authorized(centerA)
      .patch(`/students/${created.body.student.id}`)
      .send({ name: "Updated temporary student" });
    expect(patched.status).toBe(200);
    expect(patched.body.student.name).toBe("Updated temporary student");

    const deleted = await authorized(centerA).delete(
      `/students/${created.body.student.id}`,
    );
    expect(deleted.status).toBe(204);
  });

  it("returns indistinguishable 404s for cross-center get, patch, and delete", async () => {
    const missingId = randomUUID();
    const getResponse = await authorized(centerA).get(
      `/students/${studentB.id}`,
    );
    const patchResponse = await authorized(centerA)
      .patch(`/students/${studentB.id}`)
      .send({ name: "Attempted cross-center update" });
    const deleteResponse = await authorized(centerA).delete(
      `/students/${studentB.id}`,
    );
    const missingResponses = [
      await authorized(centerA).get(`/students/${missingId}`),
      await authorized(centerA)
        .patch(`/students/${missingId}`)
        .send({ name: "Missing student update" }),
      await authorized(centerA).delete(`/students/${missingId}`),
    ];

    const crossCenterResponses = [getResponse, patchResponse, deleteResponse];
    for (const [index, response] of crossCenterResponses.entries()) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
      expect(response.body).toEqual(missingResponses[index].body);
    }

    const unchanged = await ownerPrisma.student.findUnique({
      where: { id: studentB.id },
    });
    expect(unchanged).toMatchObject({
      centerId: centerB.centerId,
      name: "Center B student",
    });
  });

  it("ignores a client-supplied centerId when creating a student", async () => {
    const response = await authorized(centerA).post("/students").send({
      name: "Body centerId must be ignored",
      centerId: centerB.centerId,
    });

    expect(response.status).toBe(201);
    expect(response.body.student.centerId).toBe(centerA.centerId);
  });

  it("returns only center A rows from an unfiltered raw query with A's context", async () => {
    const rows = await appPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${centerA.centerId}, true)
      `;
      return transaction.$queryRaw<Array<{ id: string; centerId: string }>>`
        SELECT * FROM "Student"
      `;
    });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.map((row) => row.centerId)).toEqual(
      rows.map(() => centerA.centerId),
    );
    expect(rows.some((row) => row.id === studentA.id)).toBe(true);
    expect(rows.some((row) => row.id === studentB.id)).toBe(false);
  });

  it("fails closed for an unfiltered query with no tenant context", async () => {
    const rows = await appPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT * FROM "Student"
    `;

    expect(rows).toEqual([]);
  });

  it("rejects inserts for a different center under the active RLS context", async () => {
    await expect(
      appPrisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT set_config('app.current_center', ${centerA.centerId}, true)
        `;
        return transaction.$executeRaw`
          INSERT INTO "Student"
            ("id", "centerId", "name", "createdAt", "updatedAt")
          VALUES
            (${randomUUID()}::uuid, ${centerB.centerId}::uuid,
             'RLS write rejection', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
      }),
    ).rejects.toThrow();
  });

  it("uses a database role that neither is superuser nor bypasses RLS", async () => {
    const [role] = await appPrisma.$queryRaw<
      Array<{
        roleName: string;
        isSuperuser: boolean;
        bypassesRls: boolean;
      }>
    >`
      SELECT
        r.rolname AS "roleName",
        r.rolsuper AS "isSuperuser",
        r.rolbypassrls AS "bypassesRls"
      FROM pg_roles AS r
      WHERE r.rolname = current_user
    `;

    expect(role).toEqual({
      roleName: "tutordesk_app",
      isSuperuser: false,
      bypassesRls: false,
    });
  });

  it("rejects requests after the center membership is removed", async () => {
    await ownerPrisma.membership.deleteMany({
      where: { userId: centerA.userId, centerId: centerA.centerId },
    });

    const response = await authorized(centerA).get("/students");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TENANT_ACCESS_REVOKED");
  });
});
