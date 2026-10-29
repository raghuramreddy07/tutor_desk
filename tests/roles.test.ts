import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Express } from "express";
import { PrismaClient, type InviteRole } from "@prisma/client";
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
let studentAId: string;
let studentBId: string;
const userEmails: string[] = [];
const centerIds: string[] = [];
const teacherTokensByCenter = new Map<string, string>();
const teacherUserIdsByCenter = new Map<string, string>();

const signup = async (label: string): Promise<TestCenter> => {
  const email = `roles-${label}-${randomUUID()}@example.test`;
  const response = await request(app).post("/auth/signup-center").send({
    name: `Roles ${label}`,
    email,
    password: "correct horse battery",
    centerName: `Roles ${label}`,
  });
  expect(response.status).toBe(201);
  userEmails.push(email);
  centerIds.push(response.body.center.id as string);
  return {
    userId: response.body.user.id as string,
    centerId: response.body.center.id as string,
    accessToken: response.body.accessToken as string,
  };
};

const seedInvite = async (input: {
  centerId: string;
  invitedByUserId: string;
  email: string;
  role?: InviteRole;
  studentId?: string;
  expiresAt?: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}) => {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invite = await ownerPrisma.invite.create({
    data: {
      centerId: input.centerId,
      invitedByUserId: input.invitedByUserId,
      email: input.email,
      role: input.role ?? "TEACHER",
      studentId: input.studentId,
      tokenHash,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: input.acceptedAt,
      revokedAt: input.revokedAt,
    },
  });
  return { invite, token, tokenHash };
};

const accept = (token: string, extra: { name?: string; password?: string } = {}) =>
  request(app).post("/auth/accept-invite").send({
    token,
    name: extra.name ?? "Invited person",
    password: extra.password ?? "correct horse battery",
  });

const authorized = (center: TestCenter) => {
  const token = `Bearer ${center.accessToken}`;
  return {
    get: (path: string) => request(app).get(path).set("Authorization", token),
    post: (path: string) => request(app).post(path).set("Authorization", token),
    patch: (path: string) => request(app).patch(path).set("Authorization", token),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", token),
  };
};

const createMember = async (
  center: TestCenter,
  input: { email: string; role: "TEACHER" | "PARENT"; studentId?: string },
) => {
  let inviter = center;
  if (input.role === "PARENT") {
    let teacherToken = teacherTokensByCenter.get(center.centerId);
    if (!teacherToken) {
      const teacher = await createMember(center, {
        email: `roles-inviter-${randomUUID()}@example.test`,
        role: "TEACHER",
      });
      teacherToken = teacher.token;
      teacherTokensByCenter.set(center.centerId, teacherToken);
    }
    const teacherUserId = teacherUserIdsByCenter.get(center.centerId);
    if (!teacherUserId) {
      throw new Error("Parent invitations require a known teacher membership");
    }
    let batch = await ownerPrisma.batch.findFirst({
      where: {
        centerId: center.centerId,
        teachers: { some: { centerId: center.centerId, userId: teacherUserId } },
      },
      select: { id: true },
    });
    if (!batch) {
      batch = await ownerPrisma.batch.create({
        data: {
          centerId: center.centerId,
          name: `Roles invite batch ${randomUUID()}`,
          teachers: {
            create: {
              userId: teacherUserId,
            },
          },
        },
        select: { id: true },
      });
    }
    if (input.studentId) {
      await ownerPrisma.batchStudent.createMany({
        data: [{
          centerId: center.centerId,
          batchId: batch.id,
          studentId: input.studentId,
        }],
        skipDuplicates: true,
      });
    }
    inviter = { ...center, accessToken: teacherToken };
  }

  userEmails.push(input.email);
  const invited = await authorized(inviter).post("/invites").send(input);
  if (invited.status !== 201) {
    throw new Error(
      `Could not create ${input.role} invite for ${input.email}: ${JSON.stringify(invited.body)}`,
    );
  }
  const token = new URL(invited.body.inviteLink as string).searchParams.get("token");
  if (!token) {
    throw new Error("Invite link did not contain a token");
  }
  const accepted = await accept(token, { name: "Invited member" });
  if (accepted.status !== 200) {
    throw new Error(`Could not accept invite for ${input.email}`);
  }
  if (input.role === "TEACHER") {
    teacherTokensByCenter.set(center.centerId, accepted.body.accessToken as string);
  }
  const member = await ownerPrisma.user.findUniqueOrThrow({
    where: { email: input.email },
    select: { id: true },
  });
  if (input.role === "TEACHER") {
    teacherUserIdsByCenter.set(center.centerId, member.id);
    const batch = await ownerPrisma.batch.create({
      data: {
        centerId: center.centerId,
        name: `Roles teacher batch ${randomUUID()}`,
      },
      select: { id: true },
    });
    await ownerPrisma.batchTeacher.create({
      data: {
        centerId: center.centerId,
        batchId: batch.id,
        userId: member.id,
      },
    });
  }
  return { token: accepted.body.accessToken as string, userId: member.id };
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
  await ownerPrisma.center.updateMany({
    where: { id: { in: [centerA.centerId, centerB.centerId] } },
    data: { plan: "PRO" },
  });
  const [studentA, studentB] = await Promise.all([
    ownerPrisma.student.create({
      data: { centerId: centerA.centerId, name: "Roles student A" },
    }),
    ownerPrisma.student.create({
      data: { centerId: centerB.centerId, name: "Roles student B" },
    }),
  ]);
  studentAId = studentA.id;
  studentBId = studentB.id;
});

afterAll(async () => {
  if (centerIds.length > 0) {
    await ownerPrisma.center.deleteMany({ where: { id: { in: centerIds } } });
  }
  if (userEmails.length > 0) {
    await ownerPrisma.user.deleteMany({
      where: { email: { in: userEmails } },
    });
  }
  await Promise.all([appPrisma.$disconnect(), ownerPrisma.$disconnect()]);
});

describe("invite acceptance", () => {
  it("creates a new account and membership from an invite whose raw token is not stored", async () => {
    const email = `new-teacher-${randomUUID()}@example.test`;
    userEmails.push(email);
    const { invite, token, tokenHash } = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email,
    });

    const response = await accept(token, {
      name: "New Teacher",
      password: "new-person-password",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      center: { id: centerA.centerId },
      role: "TEACHER",
      accessToken: expect.any(String),
    });
    const storedInvite = await ownerPrisma.invite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(storedInvite.tokenHash).toBe(tokenHash);
    expect(storedInvite.tokenHash).not.toBe(token);
    expect(storedInvite.acceptedAt).toBeInstanceOf(Date);

    const member = await ownerPrisma.user.findUniqueOrThrow({
      where: { email },
      include: { memberships: true },
    });
    expect(member.name).toBe("New Teacher");
    expect(member.memberships).toHaveLength(1);
    expect(member.memberships[0]).toMatchObject({
      centerId: centerA.centerId,
      role: "TEACHER",
    });

    const me = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${response.body.accessToken as string}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: { email },
      center: { id: centerA.centerId },
      role: "TEACHER",
    });

    const reused = await accept(token, {
      name: "Changed name",
      password: "new-person-password",
    });
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe("INVALID_INVITE");
  });

  it("requires the existing account password and then adds a second membership", async () => {
    const existing = await signup("existing");
    const email = `existing-${randomUUID()}@example.test`;
    const user = await ownerPrisma.user.update({
      where: { id: existing.userId },
      data: { email },
    });
    userEmails[userEmails.length - 1] = email;
    const { token } = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email,
    });

    const wrongPassword = await accept(token, {
      password: "incorrect password",
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });

    const accepted = await accept(token, {
      password: "correct horse battery",
    });
    expect(accepted.status).toBe(200);
    expect(
      await ownerPrisma.membership.count({ where: { userId: user.id } }),
    ).toBe(2);

    const removed = await authorized(centerA).delete(`/members/${user.id}`);
    expect(removed.status).toBe(204);
    const remainingMemberships = await ownerPrisma.membership.findMany({
      where: { userId: user.id },
    });
    expect(remainingMemberships).toHaveLength(1);
    expect(remainingMemberships[0].centerId).toBe(existing.centerId);
    const stillMember = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${existing.accessToken}`);
    expect(stillMember.status).toBe(200);
    expect(stillMember.body.center.id).toBe(existing.centerId);
  });

  it("rejects expired, revoked, and already-used invites", async () => {
    const expired = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email: `expired-${randomUUID()}@example.test`,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const revoked = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email: `revoked-${randomUUID()}@example.test`,
      revokedAt: new Date(),
    });
    const used = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email: `used-${randomUUID()}@example.test`,
      acceptedAt: new Date(),
    });

    for (const token of [expired.token, revoked.token, used.token]) {
      const response = await accept(token);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_INVITE");
    }
  });

  it("allows exactly one of two simultaneous accepts", async () => {
    const email = `race-${randomUUID()}@example.test`;
    userEmails.push(email);
    const { token } = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email,
    });

    const responses = await Promise.all([accept(token), accept(token)]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
    expect(await ownerPrisma.user.count({ where: { email } })).toBe(1);
  });

  it("creates the parent-student link and scopes direct unfiltered reads with RLS", async () => {
    await seedInvite({
      centerId: centerB.centerId,
      invitedByUserId: centerB.userId,
      email: `other-center-${randomUUID()}@example.test`,
    });
    const email = `parent-${randomUUID()}@example.test`;
    userEmails.push(email);
    const { token } = await seedInvite({
      centerId: centerA.centerId,
      invitedByUserId: centerA.userId,
      email,
      role: "PARENT",
      studentId: studentAId,
    });

    const accepted = await accept(token);
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe("PARENT");
    const parent = await ownerPrisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(
      await ownerPrisma.parentStudent.findUnique({
        where: {
          userId_studentId: { userId: parent.id, studentId: studentAId },
        },
      }),
    ).toMatchObject({ centerId: centerA.centerId });
    await ownerPrisma.parentStudent.create({
      data: {
        centerId: centerB.centerId,
        userId: centerB.userId,
        studentId: studentBId,
      },
    });

    const scopedRows = await appPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${centerA.centerId}, true)
      `;
      const invites = await transaction.$queryRaw<Array<{ centerId: string }>>`
        SELECT * FROM "Invite"
      `;
      const parentLinks = await transaction.$queryRaw<
        Array<{ centerId: string }>
      >`SELECT * FROM "ParentStudent"`;
      return { invites, parentLinks };
    });
    expect(scopedRows.invites.length).toBeGreaterThan(0);
    expect(scopedRows.invites.every((row) => row.centerId === centerA.centerId)).toBe(true);
    expect(scopedRows.parentLinks).toHaveLength(1);
    expect(scopedRows.parentLinks[0].centerId).toBe(centerA.centerId);
    expect(scopedRows.invites.some((row) => row.centerId === centerB.centerId)).toBe(false);
    expect(studentBId).not.toBe(studentAId);

    const noContextInvites = await appPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT * FROM "Invite"
    `;
    const noContextLinks = await appPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT * FROM "ParentStudent"
    `;
    expect(noContextInvites).toEqual([]);
    expect(noContextLinks).toEqual([]);
  });

  it("creates a teacher invite link while storing only its hash and rejecting duplicates", async () => {
    const email = `owner-invite-${randomUUID()}@example.test`;
    const response = await authorized(centerA).post("/invites").send({
      email,
      role: "TEACHER",
    });

    expect(response.status).toBe(201);
    expect(response.body.invite).toMatchObject({
      centerId: centerA.centerId,
      email,
      role: "TEACHER",
    });
    expect(response.body).not.toHaveProperty("token");
    expect(response.body.invite).not.toHaveProperty("tokenHash");
    const link = new URL(response.body.inviteLink as string);
    const token = link.searchParams.get("token");
    expect(`${link.origin}${link.pathname}`).toBe(
      `${process.env.APP_URL}/accept-invite`,
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

    const stored = await ownerPrisma.invite.findFirstOrThrow({
      where: { centerId: centerA.centerId, email, role: "TEACHER" },
    });
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(token as string).digest("hex"),
    );
    expect(stored.tokenHash).not.toBe(token);

    const duplicate = await authorized(centerA).post("/invites").send({
      email,
      role: "TEACHER",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("INVITE_PENDING");

    const ownerList = await authorized(centerA).get("/invites");
    expect(
      ownerList.body.invites.some(
        (listed: { id: string }) => listed.id === response.body.invite.id,
      ),
    ).toBe(true);
    const revoked = await authorized(centerA).delete(
      `/invites/${response.body.invite.id as string}`,
    );
    expect(revoked.status).toBe(204);
    expect(
      (await ownerPrisma.invite.findUniqueOrThrow({
        where: { id: response.body.invite.id as string },
      })).revokedAt,
    ).toBeInstanceOf(Date);
  });

  it("enforces who may invite which roles and scopes parent invitations to center students", async () => {
    const teacher = await createMember(centerA, {
      email: `teacher-permissions-${randomUUID()}@example.test`,
      role: "TEACHER",
    });
    const parent = await createMember(centerA, {
      email: `parent-permissions-${randomUUID()}@example.test`,
      role: "PARENT",
      studentId: studentAId,
    });

    for (const role of ["TEACHER", "OWNER"]) {
      const response = await request(app)
        .post("/invites")
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({ email: `disallowed-${role}-${randomUUID()}@example.test`, role });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }

    const ownerParentInvite = await authorized(centerA).post("/invites").send({
      email: `owner-parent-${randomUUID()}@example.test`,
      role: "PARENT",
      studentId: studentAId,
    });
    expect(ownerParentInvite.status).toBe(403);
    const ownerInviteOwner = await authorized(centerA).post("/invites").send({
      email: `owner-cannot-invite-owner-${randomUUID()}@example.test`,
      role: "OWNER",
    });
    expect(ownerInviteOwner.status).toBe(403);

    const parentAttempt = await request(app)
      .post("/invites")
      .set("Authorization", `Bearer ${parent.token}`)
      .send({ email: `parent-cannot-invite-${randomUUID()}@example.test`, role: "TEACHER" });
    expect(parentAttempt.status).toBe(403);

    const invitedParent = await request(app)
      .post("/invites")
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({
        email: `teacher-invited-parent-${randomUUID()}@example.test`,
        role: "PARENT",
        studentId: studentAId,
      });
    expect(invitedParent.status).toBe(201);

    const outsideStudent = await request(app)
      .post("/invites")
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({
        email: `outside-student-parent-${randomUUID()}@example.test`,
        role: "PARENT",
        studentId: studentBId,
      });
    expect(outsideStudent.status).toBe(404);
    expect(outsideStudent.body.error.code).toBe("NOT_FOUND");

    const unassignedStudent = await ownerPrisma.student.create({
      data: { centerId: centerA.centerId, name: "Unassigned invitation student" },
    });
    const unassignedInvite = await request(app)
      .post("/invites")
      .set("Authorization", ["Bearer", teacher.token].join(" "))
      .send({
        email: `unassigned-student-parent-${randomUUID()}@example.test`,
        role: "PARENT",
        studentId: unassignedStudent.id,
      });
    expect(unassignedInvite.status).toBe(404);
    expect(unassignedInvite.body.error.code).toBe("NOT_FOUND");
  });

  it("allows teachers to use students while denying parents and member management", async () => {
    const teacher = await createMember(centerA, {
      email: `teacher-students-${randomUUID()}@example.test`,
      role: "TEACHER",
    });
    const parent = await createMember(centerA, {
      email: `parent-students-${randomUUID()}@example.test`,
      role: "PARENT",
      studentId: studentAId,
    });

    const teacherStudents = await request(app)
      .get("/students")
      .set("Authorization", `Bearer ${teacher.token}`);
    expect(teacherStudents.status).toBe(200);

    const parentStudents = await request(app)
      .get("/students")
      .set("Authorization", `Bearer ${parent.token}`);
    expect(parentStudents.status).toBe(403);
    expect(parentStudents.body.error.code).toBe("FORBIDDEN");

    const teacherMembers = await request(app)
      .get("/members")
      .set("Authorization", `Bearer ${teacher.token}`);
    expect(teacherMembers.status).toBe(403);
    expect(teacherMembers.body.error.code).toBe("FORBIDDEN");
  });

  it("lets owners list, change, and remove a member and immediately rejects their old token", async () => {
    const email = `member-management-${randomUUID()}@example.test`;
    const member = await createMember(centerA, { email, role: "TEACHER" });

    const members = await authorized(centerA).get("/members");
    expect(members.status).toBe(200);
    expect(members.body.members).toContainEqual(
      expect.objectContaining({ userId: member.userId, email, role: "TEACHER" }),
    );

    const promoted = await authorized(centerA)
      .patch(`/members/${member.userId}`)
      .send({ role: "OWNER" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.member.role).toBe("OWNER");

    const demoted = await authorized(centerA)
      .patch(`/members/${member.userId}`)
      .send({ role: "TEACHER" });
    expect(demoted.status).toBe(200);
    expect(demoted.body.member.role).toBe("TEACHER");

    const removed = await authorized(centerA).delete(`/members/${member.userId}`);
    expect(removed.status).toBe(204);
    const oldToken = await request(app)
      .get("/me")
      .set("Authorization", `Bearer ${member.token}`);
    expect(oldToken.status).toBe(401);
    expect(oldToken.body.error.code).toBe("TENANT_ACCESS_REVOKED");
    expect(await ownerPrisma.user.findUnique({ where: { email } })).not.toBeNull();
  });

  it("prevents demoting or removing the last owner", async () => {
    const demoted = await authorized(centerA)
      .patch(`/members/${centerA.userId}`)
      .send({ role: "TEACHER" });
    const removed = await authorized(centerA).delete(`/members/${centerA.userId}`);

    for (const response of [demoted, removed]) {
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("LAST_OWNER");
    }
  });

  it("limits invite visibility and revocation as well as member management to the center", async () => {
    const inviteResponse = await authorized(centerB).post("/invites").send({
      email: `center-b-invite-${randomUUID()}@example.test`,
      role: "TEACHER",
    });
    expect(inviteResponse.status).toBe(201);
    const inviteId = inviteResponse.body.invite.id as string;

    const centerAInvites = await authorized(centerA).get("/invites");
    expect(centerAInvites.status).toBe(200);
    expect(
      centerAInvites.body.invites.some(
        (invite: { id: string }) => invite.id === inviteId,
      ),
    ).toBe(false);
    const revokeOtherCenter = await authorized(centerA).delete(
      `/invites/${inviteId}`,
    );
    expect(revokeOtherCenter.status).toBe(404);

    const centerAMembers = await authorized(centerA).get("/members");
    expect(centerAMembers.status).toBe(200);
    expect(
      centerAMembers.body.members.some(
        (member: { userId: string }) => member.userId === centerB.userId,
      ),
    ).toBe(false);
    const changeOtherCenterMember = await authorized(centerA)
      .patch(`/members/${centerB.userId}`)
      .send({ role: "TEACHER" });
    const removeOtherCenterMember = await authorized(centerA).delete(
      `/members/${centerB.userId}`,
    );
    expect(changeOtherCenterMember.status).toBe(404);
    expect(removeOtherCenterMember.status).toBe(404);
  });

  it("lets teachers see and revoke only their own invites", async () => {
    const teacher = await createMember(centerA, {
      email: `teacher-invites-${randomUUID()}@example.test`,
      role: "TEACHER",
    });
    const assignedBatch = await ownerPrisma.batchTeacher.findFirstOrThrow({
      where: { centerId: centerA.centerId, userId: teacher.userId },
      select: { batchId: true },
    });
    await ownerPrisma.batchStudent.create({
      data: {
        centerId: centerA.centerId,
        batchId: assignedBatch.batchId,
        studentId: studentAId,
      },
    });
    const ownerInvite = await authorized(centerA).post("/invites").send({
      email: `owner-created-invite-${randomUUID()}@example.test`,
      role: "TEACHER",
    });
    const teacherInvite = await request(app)
      .post("/invites")
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({
        email: `teacher-created-parent-${randomUUID()}@example.test`,
        role: "PARENT",
        studentId: studentAId,
      });
    expect(ownerInvite.status).toBe(201);
    expect(teacherInvite.status).toBe(201);

    const ownerInviteId = ownerInvite.body.invite.id as string;
    const teacherInviteId = teacherInvite.body.invite.id as string;
    const teacherList = await request(app)
      .get("/invites")
      .set("Authorization", `Bearer ${teacher.token}`);
    expect(teacherList.status).toBe(200);
    expect(
      teacherList.body.invites.some(
        (invite: { id: string }) => invite.id === teacherInviteId,
      ),
    ).toBe(true);
    expect(
      teacherList.body.invites.some(
        (invite: { id: string }) => invite.id === ownerInviteId,
      ),
    ).toBe(false);

    const cannotRevokeOwnerInvite = await request(app)
      .delete(`/invites/${ownerInviteId}`)
      .set("Authorization", `Bearer ${teacher.token}`);
    expect(cannotRevokeOwnerInvite.status).toBe(404);
    const revokedOwnInvite = await request(app)
      .delete(`/invites/${teacherInviteId}`)
      .set("Authorization", `Bearer ${teacher.token}`);
    expect(revokedOwnInvite.status).toBe(204);
  });

  it("links an additional student directly for an existing parent member", async () => {
    const email = `existing-parent-${randomUUID()}@example.test`;
    const parent = await createMember(centerA, {
      email,
      role: "PARENT",
      studentId: studentAId,
    });
    const secondStudent = await ownerPrisma.student.create({
      data: { centerId: centerA.centerId, name: "Second parent student" },
    });
    const teacherUserId = teacherUserIdsByCenter.get(centerA.centerId);
    if (!teacherUserId) {
      throw new Error("Expected an existing teacher membership");
    }
    const assignedBatch = await ownerPrisma.batchTeacher.findFirstOrThrow({
      where: { centerId: centerA.centerId, userId: teacherUserId },
      select: { batchId: true },
    });
    await ownerPrisma.batchStudent.create({
      data: {
        centerId: centerA.centerId,
        batchId: assignedBatch.batchId,
        studentId: secondStudent.id,
      },
    });

    const teacherToken = teacherTokensByCenter.get(centerA.centerId);
    if (!teacherToken) {
      throw new Error("Expected an existing teacher inviter");
    }
    const linked = await request(app)
      .post("/invites")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({
        email,
        role: "PARENT",
        studentId: secondStudent.id,
      });
    expect(linked.status).toBe(200);
    expect(linked.body.alreadyMember).toBe(true);
    expect(linked.body).not.toHaveProperty("inviteLink");

    const member = await ownerPrisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    expect(
      await ownerPrisma.parentStudent.findUnique({
        where: {
          userId_studentId: { userId: member.id, studentId: secondStudent.id },
        },
      }),
    ).toMatchObject({ centerId: centerA.centerId });
    expect(parent.userId).toBe(member.id);

    const changeParentRole = await authorized(centerA)
      .patch(`/members/${member.id}`)
      .send({ role: "TEACHER" });
    expect(changeParentRole.status).toBe(409);
    expect(changeParentRole.body.error.code).toBe("ROLE_CHANGE_NOT_ALLOWED");

    const removed = await authorized(centerA).delete(`/members/${member.id}`);
    expect(removed.status).toBe(204);
    expect(
      await ownerPrisma.parentStudent.count({
        where: { centerId: centerA.centerId, userId: member.id },
      }),
    ).toBe(0);
  });
});
