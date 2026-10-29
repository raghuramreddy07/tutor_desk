import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestCenter = {
  userId: string;
  centerId: string;
  accessToken: string;
};

let app: Express;
let appPrisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
let centerA: TestCenter;
let centerB: TestCenter;
const emails: string[] = [];
const centerIds: string[] = [];

const signup = async (label: string): Promise<TestCenter> => {
  const email = `audit-${label}-${randomUUID()}@example.test`;
  const response = await request(app).post("/auth/signup-center").send({
    name: `Audit ${label}`,
    email,
    password: "correct horse battery",
    centerName: `Audit ${label}`,
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

const ownerRequest = (center: TestCenter) => {
  const token = ["Bearer", center.accessToken].join(" ");
  return {
    get: (path: string) => request(app).get(path).set("Authorization", token),
    post: (path: string) => request(app).post(path).set("Authorization", token),
    patch: (path: string) => request(app).patch(path).set("Authorization", token),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", token),
  };
};

const acceptInvite = async (inviteLink: string, name: string) => {
  const token = new URL(inviteLink).searchParams.get("token");
  if (!token) {
    throw new Error("Invite link did not include a token");
  }
  return request(app).post("/auth/accept-invite").send({
    token,
    name,
    password: "correct horse battery",
  });
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.RATE_LIMIT_ENABLED = "false";
  process.env.DATABASE_URL ??=
    "******localhost:5433/tutor_desk?schema=public";
  process.env.DIRECT_URL ??=
    "******localhost:5433/tutor_desk?schema=public";
  process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-chars";
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  ({ app } = await import("../src/app"));
  ({ prisma: appPrisma } = await import("../src/lib/prisma"));
  ownerPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });
  await Promise.all([appPrisma.$connect(), ownerPrisma.$connect()]);
  centerA = await signup("A");
  centerB = await signup("B");
}, 30_000);

afterAll(async () => {
  if (centerIds.length > 0) {
    await ownerPrisma.auditLog.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.center.deleteMany({ where: { id: { in: centerIds } } });
  }
  if (emails.length > 0) {
    await ownerPrisma.user.deleteMany({ where: { email: { in: emails } } });
  }
  await Promise.all([appPrisma.$disconnect(), ownerPrisma.$disconnect()]);
});

describe("tenant audit log", () => {
  it("writes successful mutations to a center-scoped owner-only log", async () => {
    const requestId = `audit-test-${randomUUID()}`;
    const created = await ownerRequest(centerA)
      .post("/students")
      .set("X-Request-Id", requestId)
      .send({ name: "Audited Student" });
    expect(created.status).toBe(201);
    const studentId = created.body.student.id as string;

    const deleted = await ownerRequest(centerA)
      .delete(`/students/${studentId}`)
      .set("X-Request-Id", requestId);
    expect(deleted.status).toBe(204);

    const ownLogs = await ownerRequest(centerA).get("/audit-logs?action=student.deleted");
    const otherLogs = await ownerRequest(centerB).get("/audit-logs?action=student.deleted");
    expect(ownLogs.status).toBe(200);
    expect(ownLogs.body.auditLogs).toHaveLength(1);
    expect(ownLogs.body.auditLogs[0]).toMatchObject({
      centerId: centerA.centerId,
      actorUserId: centerA.userId,
      action: "student.deleted",
      entityType: "Student",
      entityId: studentId,
      requestId,
    });
    expect(otherLogs.status).toBe(200);
    expect(otherLogs.body.auditLogs).toHaveLength(0);

    const forbiddenDeletion = await ownerRequest(centerA).delete(
      "/students/00000000-0000-4000-8000-000000000001",
    );
    expect(forbiddenDeletion.status).toBe(404);
    expect(
      await ownerPrisma.auditLog.count({
        where: { centerId: centerA.centerId, action: "student.deleted" },
      }),
    ).toBe(1);
  });

  it("keeps all audit metadata free of forbidden keys", async () => {
    const rows = await ownerPrisma.auditLog.findMany({
      where: { centerId: centerA.centerId },
      select: { metadata: true },
    });
    const forbidden = /password|token|jwt|secret|email|phone|name|personal|idempotency|cookie|authorization|reason/i;
    const assertKeysSafe = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(assertKeysSafe);
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          expect(key).not.toMatch(forbidden);
          assertKeysSafe(child);
        }
      }
    };
    rows.forEach(({ metadata }) => assertKeysSafe(metadata));
  });

  it("denies UPDATE and DELETE to tutordesk_app", async () => {
    const entry = await ownerPrisma.auditLog.findFirstOrThrow({
      where: { centerId: centerA.centerId },
      select: { id: true },
    });
    await expect(
      appPrisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT set_config('app.current_center', ${centerA.centerId}, true)
        `;
        await transaction.$executeRaw`
          UPDATE "AuditLog" SET "action" = 'tampered'
          WHERE "id" = ${entry.id}::uuid
        `;
      }),
    ).rejects.toThrow();
    await expect(
      appPrisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT set_config('app.current_center', ${centerA.centerId}, true)
        `;
        await transaction.$executeRaw`
          DELETE FROM "AuditLog" WHERE "id" = ${entry.id}::uuid
        `;
      }),
    ).rejects.toThrow();
    expect(
      await ownerPrisma.auditLog.findUniqueOrThrow({
        where: { id: entry.id },
        select: { action: true },
      }),
    ).not.toEqual({ action: "tampered" });
  });

  it("returns no rows under a mismatched tenant context", async () => {
    const rows = await appPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${centerB.centerId}, true)
      `;
      return transaction.$queryRaw<Array<{ id: string; centerId: string }>>`
        SELECT "id", "centerId" FROM "AuditLog"
      `;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(({ centerId }) => centerId === centerB.centerId)).toBe(true);

    const noContextRows = await appPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AuditLog"
    `;
    expect(noContextRows).toHaveLength(0);
  });

  it("denies audit log access to teachers and parents", async () => {
    const teacherEmail = `audit-teacher-${randomUUID()}@example.test`;
    emails.push(teacherEmail);
    const teacherInvite = await ownerRequest(centerA).post("/invites").send({
      email: teacherEmail,
      role: "TEACHER",
    });
    expect(teacherInvite.status).toBe(201);
    const acceptedTeacher = await acceptInvite(
      teacherInvite.body.inviteLink as string,
      "Audit teacher",
    );
    expect(acceptedTeacher.status).toBe(200);
    const teacher = {
      userId: (await ownerPrisma.user.findUniqueOrThrow({
        where: { email: teacherEmail },
        select: { id: true },
      })).id,
      centerId: centerA.centerId,
      accessToken: acceptedTeacher.body.accessToken as string,
    };

    const student = await ownerRequest(centerA)
      .post("/students")
      .send({ name: "Parent audit student" });
    expect(student.status).toBe(201);
    const batch = await ownerRequest(centerA)
      .post("/batches")
      .send({ name: "Parent audit batch" });
    expect(batch.status).toBe(201);
    const assigned = await ownerRequest(centerA)
      .post(`/batches/${batch.body.batch.id}/students`)
      .send({ studentIds: [student.body.student.id] });
    expect(assigned.status).toBe(200);
    const setTeachers = await request(app)
      .put(`/batches/${batch.body.batch.id}/teachers`)
      .set("Authorization", ["Bearer", centerA.accessToken].join(" "))
      .send({ userIds: [teacher.userId] });
    expect(setTeachers.status).toBe(200);

    const parentEmail = `audit-parent-${randomUUID()}@example.test`;
    emails.push(parentEmail);
    const parentInvite = await request(app)
      .post("/invites")
      .set("Authorization", ["Bearer", teacher.accessToken].join(" "))
      .send({
        email: parentEmail,
        role: "PARENT",
        studentId: student.body.student.id,
      });
    expect(parentInvite.status).toBe(201);
    const acceptedParent = await acceptInvite(
      parentInvite.body.inviteLink as string,
      "Audit parent",
    );
    expect(acceptedParent.status).toBe(200);

    const teacherResponse = await request(app)
      .get("/audit-logs")
      .set("Authorization", ["Bearer", teacher.accessToken].join(" "));
    const parentResponse = await request(app)
      .get("/audit-logs")
      .set(
        "Authorization",
        ["Bearer", acceptedParent.body.accessToken as string].join(" "),
      );
    expect(teacherResponse.status).toBe(403);
    expect(parentResponse.status).toBe(403);

    const makeOwner = await ownerRequest(centerA)
      .patch(`/members/${teacher.userId}`)
      .send({ role: "OWNER" });
    expect(makeOwner.status).toBe(200);
    const makeTeacher = await ownerRequest(centerA)
      .patch(`/members/${teacher.userId}`)
      .send({ role: "TEACHER" });
    expect(makeTeacher.status).toBe(200);
    const removedTeacher = await ownerRequest(centerA).delete(
      `/members/${teacher.userId}`,
    );
    expect(removedTeacher.status).toBe(204);

    const pendingEmail = `audit-revoked-${randomUUID()}@example.test`;
    emails.push(pendingEmail);
    const pendingInvite = await ownerRequest(centerA).post("/invites").send({
      email: pendingEmail,
      role: "TEACHER",
    });
    expect(pendingInvite.status).toBe(201);
    const revokedInvite = await ownerRequest(centerA).delete(
      `/invites/${pendingInvite.body.invite.id}`,
    );
    expect(revokedInvite.status).toBe(204);

    const upgraded = await ownerRequest(centerA).patch("/plan").send({
      plan: "PRO",
    });
    const downgraded = await ownerRequest(centerA).patch("/plan").send({
      plan: "FREE",
    });
    expect(upgraded.status).toBe(200);
    expect(downgraded.status).toBe(200);

    const emptyBatch = await ownerRequest(centerA)
      .post("/batches")
      .send({ name: "Audit batch deletion" });
    expect(emptyBatch.status).toBe(201);
    const deletedBatch = await ownerRequest(centerA).delete(
      `/batches/${emptyBatch.body.batch.id}`,
    );
    expect(deletedBatch.status).toBe(204);

    const actions = await ownerPrisma.auditLog.findMany({
      where: { centerId: centerA.centerId },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "signup-center",
        "invite.created",
        "invite.accepted",
        "invite.revoked",
        "member.role_changed",
        "member.removed",
        "plan.changed",
        "batch.deleted",
        "student.deleted",
      ]),
    );
  });
});
