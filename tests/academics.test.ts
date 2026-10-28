import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type TestCenter = {
  userId: string;
  centerId: string;
  accessToken: string;
};

type TestMember = {
  userId: string;
  accessToken: string;
};

let app: Express;
let appPrisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
let centerA: TestCenter;
let centerB: TestCenter;
let teacherA: TestMember;
let teacherA2: TestMember;
let parentA: TestMember;
let studentAId: string;
let studentA2Id: string;
let studentA3Id: string;
let studentBId: string;
let batchAId: string;
let batchA2Id: string;
let batchBId: string;
let batchBExamId: string;
const userEmails: string[] = [];
const centerIds: string[] = [];

const signup = async (label: string): Promise<TestCenter> => {
  const email = `academics-${label}-${randomUUID()}@example.test`;
  const response = await request(app).post("/auth/signup-center").send({
    name: `Academics ${label}`,
    email,
    password: "correct horse battery",
    centerName: `Academics ${label}`,
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

const authorized = (member: TestCenter | TestMember) => {
  const token = ["Bearer", member.accessToken].join(" ");
  return {
    get: (path: string) => request(app).get(path).set("Authorization", token),
    post: (path: string) => request(app).post(path).set("Authorization", token),
    put: (path: string) => request(app).put(path).set("Authorization", token),
    patch: (path: string) => request(app).patch(path).set("Authorization", token),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", token),
  };
};

const createMember = async (
  center: TestCenter,
  role: "TEACHER" | "PARENT",
  studentId?: string,
): Promise<TestMember> => {
  const email = `academics-${role.toLowerCase()}-${randomUUID()}@example.test`;
  userEmails.push(email);
  const inviter =
    role === "PARENT" ? { ...center, accessToken: teacherA.accessToken } : center;
  const invite = await authorized(inviter).post("/invites").send({
    email,
    role,
    ...(studentId ? { studentId } : {}),
  });
  expect(invite.status).toBe(201);
  const token = new URL(invite.body.inviteLink as string).searchParams.get("token");
  expect(token).toBeTruthy();
  const accepted = await request(app).post("/auth/accept-invite").send({
    token,
    name: `Academic ${role}`,
    password: "correct horse battery",
  });
  expect(accepted.status).toBe(200);
  const user = await ownerPrisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { userId: user.id, accessToken: accepted.body.accessToken as string };
};

const createStudent = async (center: TestCenter, name: string) => {
  const response = await authorized(center).post("/students").send({ name });
  expect(response.status).toBe(201);
  return response.body.student.id as string;
};

const createBatch = async (center: TestCenter, name: string): Promise<string> => {
  const response = await authorized(center)
    .post("/batches")
    .send({ name, subject: "Mathematics", schedule: "Mon-Fri 5pm" });
  expect(response.status).toBe(201);
  return response.body.batch.id as string;
};

const assignTeacher = async (
  center: TestCenter,
  batchId: string,
  teacher: TestMember,
) => {
  const response = await authorized(center)
    .put(`/batches/${batchId}/teachers`)
    .send({ userIds: [teacher.userId] });
  expect(response.status).toBe(200);
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    "******localhost:5433/tutor_desk?schema=public";
  process.env.DIRECT_URL ??=
    "******localhost:5433/tutor_desk?schema=public";
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
  studentAId = await createStudent(centerA, "Center A student");
  studentA2Id = await createStudent(centerA, "Center A second student");
  studentA3Id = await createStudent(centerA, "Center A third student");
  studentBId = await createStudent(centerB, "Center B student");
  teacherA = await createMember(centerA, "TEACHER");
  teacherA2 = await createMember(centerA, "TEACHER");

  batchAId = await createBatch(centerA, "A teacher batch");
  batchA2Id = await createBatch(centerA, "A other teacher batch");
  batchBId = await createBatch(centerB, "Center B batch");
  await assignTeacher(centerA, batchAId, teacherA);
  await assignTeacher(centerA, batchA2Id, teacherA2);
  await assignTeacher(centerB, batchBId, {
    userId: centerB.userId,
    accessToken: centerB.accessToken,
  });
  await ownerPrisma.batchStudent.create({
    data: {
      centerId: centerB.centerId,
      batchId: batchBId,
      studentId: studentBId,
    },
  });
  batchBExamId = (
    await ownerPrisma.exam.create({
      data: {
        centerId: centerB.centerId,
        batchId: batchBId,
        name: "Center B exam",
        maxMarks: 100,
        date: new Date("2020-01-02T00:00:00.000Z"),
      },
      select: { id: true },
    })
  ).id;
  await ownerPrisma.attendance.create({
    data: {
      centerId: centerB.centerId,
      batchId: batchBId,
      studentId: studentBId,
      date: new Date("2020-01-01T00:00:00.000Z"),
      status: "PRESENT",
      markedByUserId: centerB.userId,
    },
  });
  await ownerPrisma.examResult.create({
    data: {
      centerId: centerB.centerId,
      examId: batchBExamId,
      studentId: studentBId,
      marks: 80,
    },
  });
  const initialEnrollment = await authorized(centerA)
    .post(`/batches/${batchAId}/students`)
    .send({ studentIds: [studentAId] });
  expect(initialEnrollment.status).toBe(200);
  parentA = await createMember(centerA, "PARENT", studentAId);
});

afterAll(async () => {
  if (centerIds.length > 0) {
    await ownerPrisma.attendance.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.exam.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.center.deleteMany({ where: { id: { in: centerIds } } });
  }
  if (userEmails.length > 0) {
    await ownerPrisma.user.deleteMany({ where: { email: { in: userEmails } } });
  }
  await Promise.all([appPrisma.$disconnect(), ownerPrisma.$disconnect()]);
});

describe("batches and enrollment", () => {
  it("owners create and manage batches and assign center members", async () => {
    const created = await authorized(centerA).post("/batches").send({
      name: "Owner managed batch",
    });
    expect(created.status).toBe(201);
    expect(created.body.batch).toMatchObject({
      centerId: centerA.centerId,
      name: "Owner managed batch",
    });

    const assigned = await authorized(centerA)
      .put(`/batches/${created.body.batch.id}/teachers`)
      .send({ userIds: [teacherA2.userId, centerA.userId] });
    expect(assigned.status).toBe(200);
    expect(assigned.body.teachers).toHaveLength(2);

    const updated = await authorized(centerA)
      .patch(`/batches/${created.body.batch.id}`)
      .send({ name: "Updated batch" });
    expect(updated.status).toBe(200);
    expect(updated.body.batch.name).toBe("Updated batch");

    const invalidAssignment = await authorized(centerA)
      .put(`/batches/${created.body.batch.id}/teachers`)
      .send({ userIds: [centerB.userId] });
    expect(invalidAssignment.status).toBe(422);
    expect(invalidAssignment.body.error.code).toBe("INVALID_TEACHERS");
    const parentAssignment = await authorized(centerA)
      .put(`/batches/${created.body.batch.id}/teachers`)
      .send({ userIds: [parentA.userId] });
    expect(parentAssignment.status).toBe(422);

    const ownerList = await authorized(centerA).get("/batches?limit=1&offset=0");
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.batches).toHaveLength(1);
    expect(ownerList.body.total).toBeGreaterThan(1);

    const deleted = await authorized(centerA).delete(
      `/batches/${created.body.batch.id}`,
    );
    expect(deleted.status).toBe(204);
  });

  it("lists assigned batches only and hides unassigned batches as not found", async () => {
    const listed = await authorized(teacherA).get("/batches");
    expect(listed.status).toBe(200);
    expect(listed.body.batches.map((batch: { id: string }) => batch.id)).toEqual([
      batchAId,
    ]);

    expect((await authorized(teacherA).get(`/batches/${batchAId}`)).status).toBe(200);
    expect((await authorized(teacherA).get(`/batches/${batchA2Id}`)).status).toBe(404);
    expect((await authorized(teacherA).get(`/batches/${batchBId}`)).status).toBe(404);
    expect((await authorized(teacherA2).get(`/batches/${batchAId}`)).status).toBe(404);
    expect(
      (
        await authorized(teacherA)
          .patch(`/batches/${batchA2Id}`)
          .send({ name: "Cannot see other batch" })
      ).status,
    ).toBe(404);
    expect(
      (
        await authorized(teacherA)
          .patch(`/batches/${batchAId}`)
          .send({ name: "Cannot update assigned batch" })
      ).status,
    ).toBe(403);
  });

  it("allows idempotent enrollment for assigned teachers and rejects other-center students", async () => {
    const first = await authorized(teacherA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentAId] });
    expect(first.status).toBe(200);
    const repeated = await authorized(teacherA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentAId, studentAId] });
    expect(repeated.status).toBe(200);
    expect(repeated.body.enrollments).toHaveLength(1);

    const invalidStudent = await authorized(teacherA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentBId] });
    expect(invalidStudent.status).toBe(422);
    expect(invalidStudent.body.error.code).toBe("INVALID_STUDENTS");

    const wrongBatch = await authorized(teacherA)
      .post(`/batches/${batchA2Id}/students`)
      .send({ studentIds: [studentAId] });
    expect(wrongBatch.status).toBe(404);

    const roster = await authorized(teacherA).get(`/batches/${batchAId}/students`);
    expect(roster.status).toBe(200);
    expect(roster.body.enrollments).toHaveLength(1);
    expect(roster.body.enrollments[0].student.id).toBe(studentAId);

    const removed = await authorized(teacherA).delete(
      `/batches/${batchAId}/students/${studentAId}`,
    );
    expect(removed.status).toBe(204);
    expect(
      await ownerPrisma.batchStudent.count({
        where: { centerId: centerA.centerId, batchId: batchAId, studentId: studentAId },
      }),
    ).toBe(0);
  });

  it("blocks teachers from batch administration and parents from batch endpoints", async () => {
    expect(
      (
        await authorized(teacherA)
          .post("/batches")
          .send({ name: "Teacher-created batch" })
      ).status,
    ).toBe(403);
    expect((await authorized(teacherA).delete(`/batches/${batchAId}`)).status).toBe(403);

    expect((await authorized(parentA).get("/batches")).status).toBe(403);
    expect((await authorized(parentA).get(`/batches/${batchAId}`)).status).toBe(403);
    expect(
      (
        await authorized(parentA)
          .post(`/batches/${batchAId}/students`)
          .send({ studentIds: [studentAId] })
      ).status,
    ).toBe(403);
  });
});

describe("attendance", () => {
  const previousWeek = (): string[] => {
    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - daysSinceMonday - 7);
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
  };

  it("marks and corrects a week, returns unmarked roster rows, and rejects invalid marks", async () => {
    const enroll = await authorized(centerA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentAId, studentA2Id, studentA3Id] });
    expect(enroll.status).toBe(200);
    const otherBatchEnroll = await authorized(centerA)
      .post(`/batches/${batchA2Id}/students`)
      .send({ studentIds: [studentA3Id] });
    expect(otherBatchEnroll.status).toBe(200);

    const week = previousWeek();
    for (const date of week) {
      const marked = await authorized(teacherA)
        .put(`/batches/${batchAId}/attendance`)
        .send({
          date,
          records: [
            { studentId: studentAId, status: "PRESENT" },
            { studentId: studentA2Id, status: "LATE" },
          ],
        });
      expect(marked.status).toBe(200);
    }

    const corrected = await authorized(teacherA)
      .put(`/batches/${batchAId}/attendance`)
      .send({
        date: week[0],
        records: [{ studentId: studentAId, status: "ABSENT" }],
      });
    expect(corrected.status).toBe(200);
    expect(
      await ownerPrisma.attendance.count({
        where: {
          centerId: centerA.centerId,
          batchId: batchAId,
          studentId: studentAId,
          date: new Date(`${week[0]}T00:00:00.000Z`),
        },
      }),
    ).toBe(1);

    const roster = await authorized(teacherA).get(
      `/batches/${batchAId}/attendance?date=${week[0]}`,
    );
    expect(roster.status).toBe(200);
    expect(roster.body.roster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          student: expect.objectContaining({ id: studentAId }),
          status: "ABSENT",
        }),
        expect.objectContaining({
          student: expect.objectContaining({ id: studentA2Id }),
          status: "LATE",
        }),
        expect.objectContaining({
          student: expect.objectContaining({ id: studentA3Id }),
          status: null,
        }),
      ]),
    );

    const unmarkedStudent = await createStudent(centerA, "Not enrolled student");
    const rejected = await authorized(teacherA)
      .put(`/batches/${batchAId}/attendance`)
      .send({
        date: week[0],
        records: [{ studentId: unmarkedStudent, status: "PRESENT" }],
      });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("NOT_ENROLLED");

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const future = await authorized(teacherA)
      .put(`/batches/${batchAId}/attendance`)
      .send({
        date: tomorrow.toISOString().slice(0, 10),
        records: [{ studentId: studentAId, status: "PRESENT" }],
      });
    expect(future.status).toBe(400);
    expect(future.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("limits teacher histories to assigned batches and hides other batches as not found", async () => {
    const week = previousWeek();
    const otherBatch = await authorized(teacherA2)
      .put(`/batches/${batchA2Id}/attendance`)
      .send({
        date: week[4],
        records: [{ studentId: studentA3Id, status: "PRESENT" }],
      });
    expect(otherBatch.status).toBe(200);

    const history = await authorized(teacherA).get(
      `/students/${studentA3Id}/attendance?from=${week[0]}&to=${week[4]}`,
    );
    expect(history.status).toBe(200);
    expect(history.body.attendance).toHaveLength(0);

    const wrongBatch = await authorized(teacherA).get(
      `/batches/${batchA2Id}/attendance?date=${week[4]}`,
    );
    expect(wrongBatch.status).toBe(404);
    const centerBStudent = await authorized(teacherA).get(
      `/students/${studentBId}/attendance?from=${week[0]}&to=${week[4]}`,
    );
    expect(centerBStudent.status).toBe(404);
  });

  it("denies parents access to attendance", async () => {
    const date = previousWeek()[0];
    expect(
      (
        await authorized(parentA).get(
          `/batches/${batchAId}/attendance?date=${date}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await authorized(parentA)
          .put(`/batches/${batchAId}/attendance`)
          .send({ date, records: [] })
      ).status,
    ).toBe(403);
  });
});

describe("exams and results", () => {
  const examDate = (): string => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 3);
    return date.toISOString().slice(0, 10);
  };

  it("creates exams, upserts validated results, and reports the full roster and statistics", async () => {
    const created = await authorized(centerA)
      .post(`/batches/${batchAId}/exams`)
      .send({ name: "Weekly test", maxMarks: 100, date: examDate() });
    expect(created.status).toBe(201);
    const examId = created.body.exam.id as string;

    expect((await authorized(teacherA).get(`/exams/${examId}`)).status).toBe(200);
    expect(
      (await authorized(teacherA).get(`/batches/${batchAId}/exams`)).body.exams,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: examId })]));
    expect((await authorized(teacherA2).get(`/exams/${examId}`)).status).toBe(404);

    const entered = await authorized(teacherA)
      .put(`/exams/${examId}/results`)
      .send({
        results: [
          { studentId: studentAId, marks: 90 },
          { studentId: studentA2Id, marks: 75 },
        ],
      });
    expect(entered.status).toBe(200);
    expect(entered.body.average).toBe(82.5);
    expect(entered.body.highestMark).toBe(90);

    const updated = await authorized(teacherA)
      .put(`/exams/${examId}/results`)
      .send({ results: [{ studentId: studentAId, marks: 85 }] });
    expect(updated.status).toBe(200);
    expect(updated.body.average).toBe(80);
    expect(updated.body.highestMark).toBe(85);
    expect(
      await ownerPrisma.examResult.count({
        where: { centerId: centerA.centerId, examId, studentId: studentAId },
      }),
    ).toBe(1);
    expect(updated.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          student: expect.objectContaining({ id: studentAId }),
          marks: 85,
        }),
        expect.objectContaining({
          student: expect.objectContaining({ id: studentA2Id }),
          marks: 75,
        }),
        expect.objectContaining({
          student: expect.objectContaining({ id: studentA3Id }),
          marks: null,
        }),
      ]),
    );

    const nonEnrolledId = await createStudent(centerA, "Not enrolled for exam");
    const notEnrolled = await authorized(teacherA)
      .put(`/exams/${examId}/results`)
      .send({ results: [{ studentId: nonEnrolledId, marks: 40 }] });
    expect(notEnrolled.status).toBe(422);
    expect(notEnrolled.body.error.code).toBe("NOT_ENROLLED");

    const tooHigh = await authorized(teacherA)
      .put(`/exams/${examId}/results`)
      .send({ results: [{ studentId: studentAId, marks: 101 }] });
    expect(tooHigh.status).toBe(422);
    expect(tooHigh.body.error.code).toBe("INVALID_MARKS");
    const belowZero = await authorized(teacherA)
      .put(`/exams/${examId}/results`)
      .send({ results: [{ studentId: studentAId, marks: -1 }] });
    expect(belowZero.status).toBe(400);

    const wrongBatch = await authorized(teacherA)
      .post(`/batches/${batchA2Id}/exams`)
      .send({ name: "Hidden test", maxMarks: 10, date: examDate() });
    expect(wrongBatch.status).toBe(404);

    const patched = await authorized(teacherA)
      .patch(`/exams/${examId}`)
      .send({ name: "Corrected weekly test" });
    expect(patched.status).toBe(200);
    expect(patched.body.exam.name).toBe("Corrected weekly test");

    const unsafeMaxMarksChange = await authorized(centerA)
      .patch(`/exams/${examId}`)
      .send({ maxMarks: 80 });
    expect(unsafeMaxMarksChange.status).toBe(409);
    expect(unsafeMaxMarksChange.body.error.code).toBe(
      "MAX_MARKS_BELOW_EXISTING_RESULT",
    );
  });

  it("limits student result histories to the teacher's assigned batches", async () => {
    const created = await authorized(teacherA2)
      .post(`/batches/${batchA2Id}/exams`)
      .send({ name: "Other teacher test", maxMarks: 100, date: examDate() });
    expect(created.status).toBe(201);
    const examId = created.body.exam.id as string;
    const result = await authorized(teacherA2)
      .put(`/exams/${examId}/results`)
      .send({ results: [{ studentId: studentA3Id, marks: 95 }] });
    expect(result.status).toBe(200);

    const hiddenHistory = await authorized(teacherA).get(
      `/students/${studentA3Id}/results`,
    );
    expect(hiddenHistory.status).toBe(200);
    expect(hiddenHistory.body.results).toHaveLength(0);

    const visibleHistory = await authorized(teacherA2).get(
      `/students/${studentA3Id}/results`,
    );
    expect(visibleHistory.status).toBe(200);
    expect(visibleHistory.body.results).toEqual([
      expect.objectContaining({
        marks: 95,
        exam: expect.objectContaining({
          id: examId,
          batch: expect.objectContaining({ id: batchA2Id }),
        }),
      }),
    ]);

    const removed = await authorized(teacherA2).delete(`/exams/${examId}`);
    expect(removed.status).toBe(204);
    expect(await ownerPrisma.examResult.count({ where: { examId } })).toBe(0);
  });

  it("denies parents access to exams and results", async () => {
    const date = examDate();
    const exam = await ownerPrisma.exam.findFirstOrThrow({
      where: { centerId: centerA.centerId, batchId: batchAId },
      select: { id: true },
    });
    const parent = authorized(parentA);
    const responses = await Promise.all([
      parent.get("/batches"),
      parent.post("/batches").send({ name: "Parent test batch" }),
      parent.get(`/batches/${batchAId}`),
      parent.patch(`/batches/${batchAId}`).send({ name: "Parent test batch" }),
      parent.delete(`/batches/${batchAId}`),
      parent.put(`/batches/${batchAId}/teachers`).send({ userIds: [] }),
      parent.get(`/batches/${batchAId}/teachers`),
      parent.post(`/batches/${batchAId}/students`).send({ studentIds: [] }),
      parent.get(`/batches/${batchAId}/students`),
      parent.delete(`/batches/${batchAId}/students/${studentAId}`),
      parent.get(`/batches/${batchAId}/attendance?date=${date}`),
      parent.put(`/batches/${batchAId}/attendance`).send({ date, records: [] }),
      parent.get(`/students/${studentAId}/attendance?from=${date}&to=${date}`),
      parent.post(`/batches/${batchAId}/exams`).send({
        name: "Parent test",
        maxMarks: 10,
        date,
      }),
      parent.get(`/batches/${batchAId}/exams`),
      parent.get(`/exams/${exam.id}`),
      parent.patch(`/exams/${exam.id}`).send({ name: "Parent test" }),
      parent.delete(`/exams/${exam.id}`),
      parent.put(`/exams/${exam.id}/results`).send({ results: [] }),
      parent.get(`/exams/${exam.id}/results`),
      parent.get(`/students/${studentAId}/results`),
    ]);
    expect(responses.map(({ status }) => status)).toEqual(
      Array.from({ length: responses.length }, () => 403),
    );
  });
});

describe("academic tenant isolation", () => {
  it("hides another center's batch, attendance, and exams from the owner", async () => {
    expect((await authorized(centerA).get(`/batches/${batchBId}`)).status).toBe(404);
    expect(
      (
        await authorized(centerA).get(
          `/batches/${batchBId}/attendance?date=2020-01-01`,
        )
      ).status,
    ).toBe(404);
    expect((await authorized(centerA).get(`/exams/${batchBExamId}`)).status).toBe(404);
    expect(
      (await authorized(centerA).get(`/exams/${batchBExamId}/results`)).status,
    ).toBe(404);
  });

  it("returns only center A rows from unfiltered queries with tenant context", async () => {
    const scopedRows = await appPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${centerA.centerId}, true)
      `;
      const readTable = (table: string) =>
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "${Prisma.raw(table)}"`;
      return Promise.all([
        readTable("Batch"),
        readTable("BatchTeacher"),
        readTable("BatchStudent"),
        readTable("Attendance"),
        readTable("Exam"),
        readTable("ExamResult"),
      ]);
    });

    for (const rows of scopedRows) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(({ centerId }) => centerId === centerA.centerId)).toBe(true);
    }
  });

  it("returns no rows without context and verifies RLS is enabled and forced", async () => {
    const unscopedRows = await appPrisma.$transaction(async (transaction) =>
      Promise.all([
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "Batch"`,
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "BatchTeacher"`,
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "BatchStudent"`,
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "Attendance"`,
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "Exam"`,
        transaction.$queryRaw<Array<{ centerId: string }>>`SELECT "centerId" FROM "ExamResult"`,
      ]),
    );
    expect(unscopedRows.every((rows) => rows.length === 0)).toBe(true);

    const policies = await appPrisma.$queryRaw<
      Array<{ tableName: string; enabled: boolean; forced: boolean }>
    >`
      SELECT c.relname AS "tableName",
             c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname <> 'Membership'
        AND EXISTS (
          SELECT 1
          FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'centerId'
            AND a.attnum > 0
            AND NOT a.attisdropped
        )
      ORDER BY c.relname
    `;
    expect(policies.map(({ tableName }) => tableName)).toEqual(
      expect.arrayContaining([
        "Student",
        "Invite",
        "ParentStudent",
        "Batch",
        "BatchTeacher",
        "BatchStudent",
        "Attendance",
        "Exam",
        "ExamResult",
      ]),
    );
    expect(policies.every(({ enabled, forced }) => enabled && forced)).toBe(true);
  });

  it("blocks batch deletion after academic history exists and removes assignment access immediately", async () => {
    const blockedUnenroll = await authorized(centerA).delete(
      `/batches/${batchAId}/students/${studentAId}`,
    );
    expect(blockedUnenroll.status).toBe(409);
    expect(blockedUnenroll.body.error.code).toBe("ENROLLMENT_HAS_ATTENDANCE");

    const blockedDelete = await authorized(centerA).delete(`/batches/${batchAId}`);
    expect(blockedDelete.status).toBe(409);
    expect(blockedDelete.body.error.code).toBe("BATCH_HAS_ACADEMIC_HISTORY");

    const removed = await authorized(centerA)
      .put(`/batches/${batchAId}/teachers`)
      .send({ userIds: [] });
    expect(removed.status).toBe(200);
    expect((await authorized(teacherA).get(`/batches/${batchAId}`)).status).toBe(404);
    expect(
      (
        await authorized(teacherA).get(
          `/batches/${batchAId}/attendance?date=2020-01-01`,
        )
      ).status,
    ).toBe(404);
  });
});
