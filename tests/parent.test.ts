import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parentRoutes } from "../src/modules/parent/routes";

type TestMember = {
  userId: string;
  centerId: string;
  accessToken: string;
};

let app: Express;
let appPrisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
let owner: TestMember;
let ownerB: TestMember;
let teacher: TestMember;
let teacherB: TestMember;
let parent: TestMember;
let parentB: TestMember;
let childId: string;
let secondChildId: string;
let otherChildId: string;
let childBId: string;
let batchId: string;
let batchBId: string;
let firstPaymentId: string;
let voidedPaymentId: string;
let centerId: string;
let centerBId: string;
let parentEmail: string;
const emails: string[] = [];
const centerIds: string[] = [];

const today = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const shiftDate = (date: string, days: number): string => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const childPaths = (studentId: string, paymentId: string): string[] => [
  `/parent/children/${studentId}`,
  `/parent/children/${studentId}/attendance`,
  `/parent/children/${studentId}/results`,
  `/parent/children/${studentId}/dues`,
  `/parent/children/${studentId}/payments`,
  `/parent/children/${studentId}/payments/${paymentId}`,
];

const responseKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(responseKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...responseKeys(child),
    ]);
  }
  return [];
};

const signup = async (): Promise<TestMember> => {
  const email = `parent-owner-${randomUUID()}@example.test`;
  const response = await request(app).post("/auth/signup-center").send({
    name: "Parent view owner",
    email,
    password: "correct horse battery",
    centerName: "Parent view center",
  });
  expect(response.status).toBe(201);
  emails.push(email);
  const createdCenterId = response.body.center.id as string;
  centerIds.push(createdCenterId);
  if (!centerId) {
    centerId = createdCenterId;
  }
  return {
    userId: response.body.user.id as string,
    centerId: createdCenterId,
    accessToken: response.body.accessToken as string,
  };
};

const authorized = (member: TestMember) => {
  const authorization = `Bearer ${member.accessToken}`;
  return {
    get: (path: string) => request(app).get(path).set("Authorization", authorization),
    post: (path: string) =>
      request(app).post(path).set("Authorization", authorization),
    patch: (path: string) =>
      request(app).patch(path).set("Authorization", authorization),
    put: (path: string) =>
      request(app).put(path).set("Authorization", authorization),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", authorization),
  };
};

const acceptInvite = async (
  inviteResponse: { body: { inviteLink: string } },
  name: string,
  password = "correct horse battery",
) => {
  const token = new URL(inviteResponse.body.inviteLink as string)
    .searchParams.get("token");
  expect(token).toBeTruthy();
  return request(app).post("/auth/accept-invite").send({
    token,
    name,
    password,
  });
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
  await ownerPrisma.$connect();

  owner = await signup();
  const student = await authorized(owner).post("/students").send({
    name: "Linked child",
    grade: "7",
    phone: "555-0100",
  });
  expect(student.status).toBe(201);
  childId = student.body.student.id as string;
  const secondStudent = await authorized(owner).post("/students").send({
    name: "Second linked child",
    grade: "5",
  });
  expect(secondStudent.status).toBe(201);
  secondChildId = secondStudent.body.student.id as string;
  const unlinkedStudent = await authorized(owner).post("/students").send({
    name: "Another family's child",
  });
  expect(unlinkedStudent.status).toBe(201);
  otherChildId = unlinkedStudent.body.student.id as string;
  const batch = await authorized(owner).post("/batches").send({
    name: "Parent view batch",
    subject: "Mathematics",
    schedule: "Mon-Fri 5pm",
  });
  expect(batch.status).toBe(201);
  batchId = batch.body.batch.id as string;
  expect(
    (
      await authorized(owner)
        .post(`/batches/${batchId}/students`)
        .send({ studentIds: [childId, secondChildId, otherChildId] })
    ).status,
  ).toBe(200);

  const teacherEmail = `parent-teacher-${randomUUID()}@example.test`;
  emails.push(teacherEmail);
  const teacherInvite = await authorized(owner)
    .post("/invites")
    .send({ email: teacherEmail, role: "TEACHER" });
  expect(teacherInvite.status).toBe(201);
  const teacherAccepted = await acceptInvite(teacherInvite, "Parent view teacher");
  expect(teacherAccepted.status).toBe(200);
  teacher = {
    userId: "",
    centerId,
    accessToken: teacherAccepted.body.accessToken as string,
  };
  const teacherUser = await ownerPrisma.user.findUniqueOrThrow({
    where: { email: teacherEmail },
    select: { id: true },
  });
  teacher.userId = teacherUser.id;
  expect(
    (
      await authorized(owner)
        .put(`/batches/${batchId}/teachers`)
        .send({ userIds: [teacherUser.id] })
    ).status,
  ).toBe(200);

  parentEmail = `parent-member-${randomUUID()}@example.test`;
  emails.push(parentEmail);
  const parentInvite = await authorized(teacher)
    .post("/invites")
    .send({ email: parentEmail, role: "PARENT", studentId: childId });
  expect(parentInvite.status).toBe(201);
  const parentAccepted = await acceptInvite(parentInvite, "Child's parent");
  expect(parentAccepted.status).toBe(200);
  const parentUser = await ownerPrisma.user.findUniqueOrThrow({
    where: { email: parentEmail },
    select: { id: true },
  });
  parent = {
    userId: parentUser.id,
    centerId,
    accessToken: parentAccepted.body.accessToken as string,
  };

  const secondChildInvite = await authorized(teacher)
    .post("/invites")
    .send({ email: parentEmail, role: "PARENT", studentId: secondChildId });
  expect(secondChildInvite.status).toBe(200);
  expect(secondChildInvite.body.alreadyMember).toBe(true);
  const otherParentEmail = `parent-other-${randomUUID()}@example.test`;
  emails.push(otherParentEmail);
  const otherParentInvite = await authorized(teacher)
    .post("/invites")
    .send({
      email: otherParentEmail,
      role: "PARENT",
      studentId: otherChildId,
    });
  expect(otherParentInvite.status).toBe(201);
  expect(
    (await acceptInvite(otherParentInvite, "Other child's parent")).status,
  ).toBe(200);

  const businessToday = today();
  const weekStatuses = [
    "PRESENT",
    "ABSENT",
    "LATE",
    "PRESENT",
    "PRESENT",
    "ABSENT",
    "PRESENT",
  ];
  for (let index = 0; index < weekStatuses.length; index += 1) {
    const date = shiftDate(businessToday, index - 6);
    const attendance = await authorized(owner)
      .put(`/batches/${batchId}/attendance`)
      .send({
        date,
        records: [{ studentId: childId, status: weekStatuses[index] }],
      });
    expect(attendance.status).toBe(200);
  }
  const exam = await authorized(owner).post(`/batches/${batchId}/exams`).send({
    name: "Parent view midterm",
    maxMarks: 100,
    date: shiftDate(businessToday, -1),
  });
  expect(exam.status).toBe(201);
  expect(
    (
      await authorized(owner)
        .put(`/exams/${exam.body.exam.id}/results`)
        .send({
          results: [
            { studentId: childId, marks: 80 },
            { studentId: secondChildId, marks: 60 },
          ],
        })
    ).status,
  ).toBe(200);

  const feeCases = [
    { name: "Overdue parent fee", amount: "10000", date: shiftDate(businessToday, -10) },
    { name: "Due today parent fee", amount: "5000", date: businessToday },
    { name: "Waived parent fee", amount: "3000", date: shiftDate(businessToday, -2) },
  ];
  const assignments: Array<{ id: string; date: string }> = [];
  for (const feeCase of feeCases) {
    const plan = await authorized(owner).post("/fee-plans").send({
      batchId,
      name: feeCase.name,
      amountPaise: feeCase.amount,
      frequency: "ONE_TIME",
    });
    expect(plan.status).toBe(201);
    const assignment = await authorized(owner)
      .post(`/students/${childId}/fees`)
      .send({
        feePlanId: plan.body.feePlan.id,
        startDate: feeCase.date,
      });
    expect(assignment.status).toBe(201);
    assignments.push({
      id: assignment.body.studentFee.id as string,
      date: feeCase.date,
    });
  }
  for (const month of new Set(assignments.map(({ date }) => date.slice(0, 7)))) {
    const generated = await authorized(owner)
      .post("/fees/charges/generate")
      .send({ month });
    expect(generated.status).toBe(200);
  }
  const charges = await ownerPrisma.feeCharge.findMany({
    where: {
      centerId,
      studentFeeId: { in: assignments.map(({ id }) => id) },
    },
  });
  const overdueCharge = charges.find(
    ({ dueDate }) => dueDate.toISOString().slice(0, 10) === feeCases[0].date,
  );
  const todayCharge = charges.find(
    ({ dueDate }) => dueDate.toISOString().slice(0, 10) === businessToday,
  );
  const waivedCharge = charges.find(
    ({ dueDate }) => dueDate.toISOString().slice(0, 10) === feeCases[2].date,
  );
  expect(overdueCharge && todayCharge && waivedCharge).toBeTruthy();
  expect(
    (
      await authorized(owner)
        .patch(`/fees/charges/${waivedCharge?.id}/waive`)
        .send({ reason: "Scholarship" })
    ).status,
  ).toBe(200);
  const payment = await authorized(owner).post("/payments").send({
    studentId: childId,
    amountPaise: "4000",
    paidOn: businessToday,
    method: "CASH",
    allocations: [{ chargeId: overdueCharge?.id, amountPaise: "4000" }],
  });
  expect(payment.status).toBe(201);
  firstPaymentId = payment.body.payment.id as string;
  const voidablePayment = await authorized(owner).post("/payments").send({
    studentId: childId,
    amountPaise: "1000",
    paidOn: businessToday,
    method: "UPI",
    allocations: [{ chargeId: todayCharge?.id, amountPaise: "1000" }],
  });
  expect(voidablePayment.status).toBe(201);
  voidedPaymentId = voidablePayment.body.payment.id as string;
  expect(
    (
      await authorized(owner)
        .post(`/payments/${voidablePayment.body.payment.id}/void`)
        .send({ reason: "Test void" })
    ).status,
  ).toBe(200);

  ownerB = await signup();
  centerBId = ownerB.centerId;
  const studentB = await authorized(ownerB).post("/students").send({
    name: "Center B child",
  });
  expect(studentB.status).toBe(201);
  childBId = studentB.body.student.id as string;
  const batchB = await authorized(ownerB).post("/batches").send({
    name: "Center B batch",
  });
  expect(batchB.status).toBe(201);
  batchBId = batchB.body.batch.id as string;
  expect(
    (
      await authorized(ownerB)
        .post(`/batches/${batchBId}/students`)
        .send({ studentIds: [childBId] })
    ).status,
  ).toBe(200);
  const teacherBEmail = `parent-teacher-b-${randomUUID()}@example.test`;
  emails.push(teacherBEmail);
  const teacherBInvite = await authorized(ownerB)
    .post("/invites")
    .send({ email: teacherBEmail, role: "TEACHER" });
  expect(teacherBInvite.status).toBe(201);
  const teacherBAccepted = await acceptInvite(
    teacherBInvite,
    "Center B teacher",
  );
  expect(teacherBAccepted.status).toBe(200);
  const teacherBUser = await ownerPrisma.user.findUniqueOrThrow({
    where: { email: teacherBEmail },
    select: { id: true },
  });
  teacherB = {
    userId: teacherBUser.id,
    centerId: centerBId,
    accessToken: teacherBAccepted.body.accessToken as string,
  };
  expect(
    (
      await authorized(ownerB)
        .put(`/batches/${batchBId}/teachers`)
        .send({ userIds: [teacherBUser.id] })
    ).status,
  ).toBe(200);
  const parentBInvite = await authorized(teacherB)
    .post("/invites")
    .send({
      email: parentEmail,
      role: "PARENT",
      studentId: childBId,
    });
  expect(parentBInvite.status).toBe(201);
  const parentBAccepted = await acceptInvite(
    parentBInvite,
    "Child's parent",
  );
  expect(parentBAccepted.status).toBe(200);
  parentB = {
    userId: parent.userId,
    centerId: centerBId,
    accessToken: parentBAccepted.body.accessToken as string,
  };
}, 30_000);

afterAll(async () => {
  for (const id of centerIds) {
    await ownerPrisma.paymentAllocation.deleteMany({ where: { centerId: id } });
    await ownerPrisma.payment.deleteMany({ where: { centerId: id } });
    await ownerPrisma.feeCharge.deleteMany({ where: { centerId: id } });
    await ownerPrisma.studentFee.deleteMany({ where: { centerId: id } });
    await ownerPrisma.feePlan.deleteMany({ where: { centerId: id } });
    await ownerPrisma.examResult.deleteMany({ where: { centerId: id } });
    await ownerPrisma.attendance.deleteMany({ where: { centerId: id } });
    await ownerPrisma.exam.deleteMany({ where: { centerId: id } });
    await ownerPrisma.batchStudent.deleteMany({ where: { centerId: id } });
    await ownerPrisma.batchTeacher.deleteMany({ where: { centerId: id } });
    await ownerPrisma.parentStudent.deleteMany({ where: { centerId: id } });
    await ownerPrisma.invite.deleteMany({ where: { centerId: id } });
    await ownerPrisma.membership.deleteMany({ where: { centerId: id } });
    await ownerPrisma.batch.deleteMany({ where: { centerId: id } });
    await ownerPrisma.student.deleteMany({ where: { centerId: id } });
    await ownerPrisma.center.deleteMany({ where: { id } });
  }
  if (emails.length > 0) {
    await ownerPrisma.user.deleteMany({ where: { email: { in: emails } } });
  }
  await appPrisma.$disconnect();
  await ownerPrisma.$disconnect();
});

describe("parent children endpoints", () => {
  it("lists only linked children with basic profiles and enrolled batch details", async () => {
    const response = await authorized(parent).get("/parent/children");
    expect(response.status).toBe(200);
    expect(response.body.children).toEqual(
      expect.arrayContaining([
        {
        id: childId,
        name: "Linked child",
        grade: "7",
        batches: [
          {
            name: "Parent view batch",
            subject: "Mathematics",
            schedule: "Mon-Fri 5pm",
          },
        ],
        },
        expect.objectContaining({
          id: secondChildId,
          name: "Second linked child",
        }),
      ]),
    );
    expect(response.body.children).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain("555-0100");
    expect(JSON.stringify(response.body)).not.toContain(parent.userId);
  });

  it("returns a compact overview without staff-only identity fields", async () => {
    const response = await authorized(parent).get(
      `/parent/children/${childId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      student: { name: "Linked child", grade: "7" },
      attendance: { present: 4, absent: 2, late: 1, percentage: 57.1 },
      latestExamResult: {
        examName: "Parent view midterm",
        marks: 80,
        maxMarks: 100,
        percentage: 80,
      },
      fees: {
        totalOutstandingPaise: "11000",
        totalOverduePaise: "6000",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("markedByUserId");
    expect(JSON.stringify(response.body)).not.toContain("recordedByUserId");
  });

  it("returns 404 for a student without a parent link", async () => {
    const otherStudent = await authorized(owner)
      .post("/students")
      .send({ name: "Unlinked child" });
    expect(otherStudent.status).toBe(201);
    const response = await authorized(parent).get(
      `/parent/children/${otherStudent.body.student.id}`,
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns paginated attendance, an Asia/Kolkata default range, and bounded dates", async () => {
    const response = await authorized(parent).get(
      `/parent/children/${childId}/attendance?from=${shiftDate(today(), -6)}&to=${today()}&limit=3`,
    );
    expect(response.status).toBe(200);
    expect(response.body.records).toHaveLength(3);
    expect(response.body).toMatchObject({
      counts: { PRESENT: 4, ABSENT: 2, LATE: 1 },
      percentage: 57.1,
      total: 7,
      from: shiftDate(today(), -6),
      to: today(),
      limit: 3,
      offset: 0,
    });

    const defaultRange = await authorized(parent).get(
      `/parent/children/${childId}/attendance`,
    );
    expect(defaultRange.status).toBe(200);
    expect(defaultRange.body.from).toBe(shiftDate(today(), -29));
    expect(defaultRange.body.to).toBe(today());

    const tooWide = await authorized(parent).get(
      `/parent/children/${childId}/attendance?from=${shiftDate(today(), -366)}&to=${today()}`,
    );
    expect(tooWide.status).toBe(400);
    expect(tooWide.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns only the child's result and an anonymous class average", async () => {
    const response = await authorized(parent).get(
      `/parent/children/${childId}/results`,
    );
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      expect.objectContaining({
        examName: "Parent view midterm",
        batchName: "Parent view batch",
        marks: 80,
        maxMarks: 100,
        percentage: 80,
        classAverage: 70,
      }),
    ]);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(secondChildId);
    expect(serialized).not.toContain("Second linked child");
    expect(serialized).not.toContain('"marks":60');
  });

  it("reuses owner dues calculations including partial, overdue, and waived charges", async () => {
    const parentDues = await authorized(parent).get(
      `/parent/children/${childId}/dues`,
    );
    const ownerDues = await authorized(owner).get(`/students/${childId}/dues`);
    expect(parentDues.status).toBe(200);
    expect(parentDues.body).toEqual(ownerDues.body);
    expect(parentDues.body.totals).toEqual({
      totalChargedPaise: "15000",
      totalPaidPaise: "4000",
      totalOutstandingPaise: "11000",
      totalOverduePaise: "6000",
    });
    expect(parentDues.body.dues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amountPaise: "10000",
          paidPaise: "4000",
          outstandingPaise: "6000",
          status: "OVERDUE",
        }),
        expect.objectContaining({
          amountPaise: "5000",
          paidPaise: "0",
          outstandingPaise: "5000",
          status: "UNPAID",
        }),
        expect.objectContaining({
          amountPaise: "3000",
          paidPaise: "0",
          outstandingPaise: "0",
          status: "WAIVED",
        }),
      ]),
    );
  });

  it("lists only non-voided payments and shapes a private receipt", async () => {
    const listed = await authorized(parent).get(
      `/parent/children/${childId}/payments`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.payments).toEqual([
      expect.objectContaining({
        receiptNumber: "R-000001",
        amountPaise: "4000",
        method: "CASH",
        paidOn: today(),
      }),
    ]);
    expect(
      listed.body.payments.some(
        (payment: { receiptNumber: string }) =>
          payment.receiptNumber === "R-000002",
      ),
    ).toBe(false);

    const receipt = await authorized(parent).get(
      `/parent/children/${childId}/payments/${firstPaymentId}`,
    );
    expect(receipt.status).toBe(200);
    expect(receipt.body.receipt).toMatchObject({
      centerName: "Parent view center",
      receiptNumber: "R-000001",
      studentName: "Linked child",
      amountPaise: "4000",
      method: "CASH",
      paidOn: today(),
      charges: [
        {
          description: expect.stringContaining("Overdue parent fee"),
          amountPaise: "4000",
        },
      ],
    });
    expect(
      responseKeys({ ...listed.body, ...receipt.body }).filter((key) =>
        [
          "recordedByUserId",
          "markedByUserId",
          "voidedByUserId",
          "waivedByUserId",
          "voidReason",
          "waiveReason",
          "idempotencyKey",
          "invitedBy",
          "userId",
          "email",
        ].includes(key),
      ),
    ).toEqual([]);
    expect(voidedPaymentId).not.toBe(firstPaymentId);
  });

  it("returns 404 for every child endpoint when another parent owns the link", async () => {
    for (const path of childPaths(otherChildId, firstPaymentId)) {
      const response = await authorized(parent).get(path);
      expect(response.status, path).toBe(404);
      expect(response.body.error.code, path).toBe("NOT_FOUND");
    }

    const foreignReceipt = await authorized(parent).get(
      `/parent/children/${otherChildId}/payments/${firstPaymentId}`,
    );
    expect(foreignReceipt.status).toBe(404);
    expect(
      (
        await authorized(parent).get(
          `/parent/children/${secondChildId}/payments/${firstPaymentId}`,
        )
      ).status,
    ).toBe(404);
  });

  it("never exposes staff-only fields in any parent response", async () => {
    const responses = await Promise.all([
      authorized(parent).get("/parent/children"),
      authorized(parent).get(`/parent/children/${childId}`),
      authorized(parent).get(`/parent/children/${childId}/attendance`),
      authorized(parent).get(`/parent/children/${childId}/results`),
      authorized(parent).get(`/parent/children/${childId}/dues`),
      authorized(parent).get(`/parent/children/${childId}/payments`),
      authorized(parent).get(
        `/parent/children/${childId}/payments/${firstPaymentId}`,
      ),
    ]);
    expect(responses.map(({ status }) => status)).toEqual(
      Array(responses.length).fill(200),
    );
    const forbiddenKeys = [
      "recordedByUserId",
      "markedByUserId",
      "voidedByUserId",
      "waivedByUserId",
      "voidReason",
      "waiveReason",
      "idempotencyKey",
      "invitedBy",
      "userId",
      "email",
    ];
    const keys = responseKeys(responses.map(({ body }) => body));
    expect(forbiddenKeys.filter((key) => keys.includes(key))).toEqual([]);
  });

  it("uses the selected center for multi-center parents and keeps centers isolated", async () => {
    const centerAChildren = await authorized(parent).get("/parent/children");
    const centerBChildren = await authorized(parentB).get("/parent/children");
    expect(centerAChildren.status).toBe(200);
    expect(centerBChildren.status).toBe(200);
    expect(centerAChildren.body.children.map(({ id }: { id: string }) => id))
      .toEqual(expect.arrayContaining([childId, secondChildId]));
    expect(centerAChildren.body.children.map(({ id }: { id: string }) => id))
      .not.toContain(childBId);
    expect(centerBChildren.body.children).toEqual([
      expect.objectContaining({ id: childBId, name: "Center B child" }),
    ]);
    expect(
      (
        await authorized(parent).get(`/parent/children/${childBId}/dues`)
      ).status,
    ).toBe(404);
    expect(
      (
        await authorized(parentB).get(`/parent/children/${childId}/results`)
      ).status,
    ).toBe(404);
  });

  it("allows only GET routes under /parent", () => {
    const routes = parentRoutes.stack.flatMap((layer) =>
      "route" in layer && layer.route
        ? [Object.keys(layer.route.methods)]
        : [],
    );
    expect(routes.length).toBe(7);
    for (const methods of routes) {
      expect(methods).toEqual(["get"]);
    }
  });

  it("denies staff on parent routes and parents on staff endpoints", async () => {
    for (const member of [owner, teacher]) {
      expect((await authorized(member).get("/parent/children")).status).toBe(
        403,
      );
      expect(
        (
          await authorized(member).get(`/parent/children/${childId}/dues`)
        ).status,
      ).toBe(403);
    }

    const responses = await Promise.all([
      authorized(parent).get("/students"),
      authorized(parent).get(`/students/${childId}`),
      authorized(parent).post("/students").send({ name: "Forbidden" }),
      authorized(parent).patch(`/students/${childId}`).send({ name: "Forbidden" }),
      authorized(parent).delete(`/students/${childId}`),
      authorized(parent).get("/batches"),
      authorized(parent).get(`/batches/${batchId}`),
      authorized(parent).post("/batches").send({ name: "Forbidden" }),
      authorized(parent).patch(`/batches/${batchId}`).send({ name: "Forbidden" }),
      authorized(parent).delete(`/batches/${batchId}`),
      authorized(parent).get(`/batches/${batchId}/teachers`),
      authorized(parent)
        .put(`/batches/${batchId}/teachers`)
        .send({ userIds: [] }),
      authorized(parent).get(`/batches/${batchId}/students`),
      authorized(parent)
        .post(`/batches/${batchId}/students`)
        .send({ studentIds: [childId] }),
      authorized(parent).get(
        `/batches/${batchId}/attendance?date=${today()}`,
      ),
      authorized(parent)
        .put(`/batches/${batchId}/attendance`)
        .send({ date: today(), records: [] }),
      authorized(parent).get(`/batches/${batchId}/exams`),
      authorized(parent).get(`/students/${childId}/attendance?from=${today()}&to=${today()}`),
      authorized(parent).get(`/students/${childId}/results`),
      authorized(parent).post(`/batches/${batchId}/exams`).send({
        name: "Forbidden",
        maxMarks: 10,
        date: today(),
      }),
      authorized(parent).get("/exams/00000000-0000-4000-8000-000000000001"),
      authorized(parent).get("/fee-plans"),
      authorized(parent).get(`/students/${childId}/fees`),
      authorized(parent)
        .post(`/students/${childId}/fees`)
        .send({ feePlanId: "00000000-0000-4000-8000-000000000001", startDate: today() }),
      authorized(parent).get("/payments"),
      authorized(parent).post("/payments").send({
        studentId: childId,
        amountPaise: "1",
        paidOn: today(),
        method: "CASH",
      }),
      authorized(parent).get(`/payments/${firstPaymentId}`),
      authorized(parent)
        .post(`/payments/${firstPaymentId}/void`)
        .send({ reason: "Forbidden" }),
      authorized(parent).get("/fees/dues/summary"),
      authorized(parent).get("/fees/overdue"),
      authorized(parent)
        .post("/fees/charges/generate")
        .send({ month: today().slice(0, 7) }),
      authorized(parent)
        .patch(`/fees/charges/${firstPaymentId}/waive`)
        .send({ reason: "Forbidden" }),
      authorized(parent).get("/invites"),
      authorized(parent).post("/invites").send({ email: "x@example.test", role: "TEACHER" }),
      authorized(parent).delete(`/invites/${firstPaymentId}`),
      authorized(parent).get("/members"),
      authorized(parent).patch(`/members/${owner.userId}`).send({ role: "TEACHER" }),
      authorized(parent).delete(`/members/${owner.userId}`),
    ]);
    expect(responses.map(({ status }) => status)).toEqual(
      Array(responses.length).fill(403),
    );
  });

  it("cuts access immediately when a parent link or membership is removed", async () => {
    await ownerPrisma.parentStudent.deleteMany({
      where: { centerId, userId: parent.userId, studentId: secondChildId },
    });
    for (const path of childPaths(secondChildId, firstPaymentId)) {
      expect((await authorized(parent).get(path)).status, path).toBe(404);
    }
    const childrenAfterUnlink = await authorized(parent).get("/parent/children");
    expect(childrenAfterUnlink.body.children.map(({ id }: { id: string }) => id))
      .toEqual([childId]);

    await ownerPrisma.membership.deleteMany({
      where: { centerId, userId: parent.userId },
    });
    const removedMember = await authorized(parent).get("/parent/children");
    expect([401, 403]).toContain(removedMember.status);
    expect([401, 403]).toContain((await authorized(parent).get("/me")).status);
  });

  it("keeps raw student reads limited to the configured center under RLS", async () => {
    const scoped = await appPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${centerId}, true)
      `;
      return transaction.$queryRaw<Array<{ centerId: string }>>`
        SELECT "centerId" FROM "Student"
      `;
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(new Set(scoped.map(({ centerId: rowCenterId }) => rowCenterId))).toEqual(
      new Set([centerId]),
    );
    const unscoped = await appPrisma.$transaction((transaction) =>
      transaction.$queryRaw<Array<{ centerId: string }>>`
        SELECT "centerId" FROM "Student"
      `,
    );
    expect(unscoped).toEqual([]);
  });
});
