import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  currentMonthInBusinessTimeZone,
  latestAllowedChargeMonth,
  todayInBusinessTimeZone,
} from "../src/lib/dates";

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
let studentA2Id: string;
let studentA3Id: string;
let studentAPaymentId: string;
let studentBId: string;
let batchAId: string;
let batchBId: string;
const userEmails: string[] = [];
const centerIds: string[] = [];

const authorized = (center: TestCenter) => {
  const token = ["Bearer", center.accessToken].join(" ");
  return {
    get: (path: string) => request(app).get(path).set("Authorization", token),
    post: (path: string) => request(app).post(path).set("Authorization", token),
    patch: (path: string) => request(app).patch(path).set("Authorization", token),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", token),
  };
};

const signup = async (label: string): Promise<TestCenter> => {
  const email = `fees-${label}-${randomUUID()}@example.test`;
  const response = await request(app).post("/auth/signup-center").send({
    name: `Fees ${label}`,
    email,
    password: "correct horse battery",
    centerName: `Fees ${label}`,
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

const createStudent = async (center: TestCenter, name: string) => {
  const response = await authorized(center).post("/students").send({ name });
  expect(response.status).toBe(201);
  return response.body.student.id as string;
};

const createBatch = async (center: TestCenter, name: string) => {
  const response = await authorized(center).post("/batches").send({ name });
  expect(response.status).toBe(201);
  return response.body.batch.id as string;
};

const currentMonthStart = (): string => `${currentMonthInBusinessTimeZone()}-01`;

const shiftCalendarDate = (value: string, days: number): string => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const previousMonth = (month: string): string => {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

const nextMonth = (month: string): string => {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

const lastDayOfMonth = (month: string): string => {
  const firstOfNext = nextMonth(month);
  const [year, value] = firstOfNext.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1, 0)).toISOString().slice(0, 10);
};

const createPlan = async (
  center: TestCenter,
  input: {
    batchId: string;
    name: string;
    amountPaise: string;
    frequency?: "MONTHLY" | "ONE_TIME";
    dueDay?: number;
  },
) => {
  const response = await authorized(center).post("/fee-plans").send({
    batchId: input.batchId,
    name: input.name,
    amountPaise: input.amountPaise,
    frequency: input.frequency ?? "MONTHLY",
    ...(input.frequency === "ONE_TIME" ? {} : { dueDay: input.dueDay ?? 15 }),
  });
  return response;
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
  studentAId = await createStudent(centerA, "Fees A student");
  studentA2Id = await createStudent(centerA, "Fees A discounted student");
  studentA3Id = await createStudent(centerA, "Fees A unenrolled student");
  studentAPaymentId = await createStudent(centerA, "Fees A payment student");
  studentBId = await createStudent(centerB, "Fees B student");
  batchAId = await createBatch(centerA, "Fees A batch");
  batchBId = await createBatch(centerB, "Fees B batch");
  const [enrolledA, enrolledA2, enrolledA3, enrolledB] = await Promise.all([
    authorized(centerA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentAId] }),
    authorized(centerA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentA2Id] }),
    authorized(centerA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentAPaymentId] }),
    authorized(centerB)
      .post(`/batches/${batchBId}/students`)
      .send({ studentIds: [studentBId] }),
  ]);
  expect([
    enrolledA.status,
    enrolledA2.status,
    enrolledB.status,
    enrolledA3.status,
  ]).toEqual([200, 200, 200, 200]);
});

afterAll(async () => {
  if (centerIds.length > 0) {
    await ownerPrisma.paymentAllocation.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.payment.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.feeCharge.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.studentFee.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.feePlan.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.centerCounter.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.auditLog.deleteMany({
      where: { centerId: { in: centerIds } },
    });
    await ownerPrisma.center.deleteMany({ where: { id: { in: centerIds } } });
  }
  if (userEmails.length > 0) {
    await ownerPrisma.user.deleteMany({ where: { email: { in: userEmails } } });
  }
  await Promise.all([appPrisma.$disconnect(), ownerPrisma.$disconnect()]);
});

describe("fee plans, assignments, and charge generation", () => {
  it("creates and paginates plans while rejecting invalid and cross-center batches", async () => {
    const created = await createPlan(centerA, {
      batchId: batchAId,
      name: "Monthly tuition",
      amountPaise: "125000",
    });
    expect(created.status).toBe(201);
    expect(created.body.feePlan).toMatchObject({
      centerId: centerA.centerId,
      batchId: batchAId,
      name: "Monthly tuition",
      amountPaise: "125000",
      frequency: "MONTHLY",
      dueDay: 15,
    });
    const planId = created.body.feePlan.id as string;

    expect(
      (
        await authorized(centerA).get(
          `/fee-plans/${planId}?centerId=${centerB.centerId}`,
        )
      ).status,
    ).toBe(200);
    const listed = await authorized(centerA).get("/fee-plans?limit=1&offset=0");
    expect(listed.status).toBe(200);
    expect(listed.body.plans).toHaveLength(1);
    expect(listed.body.total).toBe(1);
    expect(
      (
        await authorized(centerA)
          .post("/fee-plans")
          .send({ batchId: batchBId, name: "Foreign batch", amountPaise: "100", frequency: "MONTHLY", dueDay: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await authorized(centerA)
          .post("/fee-plans")
          .send({ batchId: batchAId, name: "Bad amount", amountPaise: 1.5, frequency: "MONTHLY", dueDay: 1 })
      ).status,
    ).toBe(400);

    const changed = await authorized(centerA)
      .patch(`/fee-plans/${planId}`)
      .send({ amountPaise: "150000" });
    expect(changed.status).toBe(200);
    expect(changed.body.feePlan.amountPaise).toBe("150000");

    const duplicatePlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Assigned plan",
      amountPaise: "99000",
    });
    expect(duplicatePlan.status).toBe(201);
    const assigned = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({
        feePlanId: duplicatePlan.body.feePlan.id,
        startDate: currentMonthStart(),
      });
    expect(assigned.status).toBe(201);
    const deleteAssigned = await authorized(centerA).delete(
      `/fee-plans/${duplicatePlan.body.feePlan.id}`,
    );
    expect(deleteAssigned.status).toBe(409);
    expect(deleteAssigned.body.error.code).toBe("FEE_PLAN_ASSIGNED");
    const deactivated = await authorized(centerA)
      .patch(`/fee-plans/${duplicatePlan.body.feePlan.id}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const removablePlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Removable audit plan",
      amountPaise: "1000",
    });
    const removedPlan = await authorized(centerA).delete(
      `/fee-plans/${removablePlan.body.feePlan.id}`,
    );
    expect(removedPlan.status).toBe(204);
    expect(
      await ownerPrisma.auditLog.count({
        where: {
          centerId: centerA.centerId,
          action: { in: ["fee_plan.created", "fee_plan.changed", "fee_plan.deleted"] },
        },
      }),
    ).toBeGreaterThanOrEqual(4);
  });

  it("assigns fees only to enrolled students and rejects overlapping assignments", async () => {
    const plan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Assignment test",
      amountPaise: "50000",
    });
    expect(plan.status).toBe(201);
    const planId = plan.body.feePlan.id as string;

    const notEnrolled = await authorized(centerA)
      .post(`/students/${studentA3Id}/fees`)
      .send({ feePlanId: planId, startDate: currentMonthStart() });
    expect(notEnrolled.status).toBe(422);
    expect(notEnrolled.body.error.code).toBe("STUDENT_NOT_ENROLLED");

    const crossCenterPlan = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({ feePlanId: randomUUID(), startDate: currentMonthStart() });
    expect(crossCenterPlan.status).toBe(404);
    const crossCenterStudent = await authorized(centerA)
      .post(`/students/${studentBId}/fees`)
      .send({ feePlanId: planId, startDate: currentMonthStart() });
    expect(crossCenterStudent.status).toBe(404);

    const assignment = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({
        feePlanId: planId,
        customAmountPaise: "45000",
        startDate: currentMonthStart(),
      });
    expect(assignment.status).toBe(201);
    expect(assignment.body.studentFee).toMatchObject({
      studentId: studentAId,
      feePlanId: planId,
      customAmountPaise: "45000",
    });

    const overlap = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({ feePlanId: planId, startDate: currentMonthStart() });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe("FEE_ALREADY_ASSIGNED");

    const listed = await authorized(centerA).get(`/students/${studentAId}/fees`);
    expect(listed.status).toBe(200);
    expect(listed.body.studentFees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feePlanId: planId,
          customAmountPaise: "45000",
          feePlan: expect.objectContaining({ amountPaise: "50000" }),
        }),
      ]),
    );

    const changed = await authorized(centerA)
      .patch(`/students/${studentAId}/fees/${assignment.body.studentFee.id}`)
      .send({ customAmountPaise: null });
    expect(changed.status).toBe(200);
    expect(changed.body.studentFee.customAmountPaise).toBeNull();

    const removed = await authorized(centerA).delete(
      `/students/${studentAId}/fees/${assignment.body.studentFee.id}`,
    );
    expect(removed.status).toBe(200);
    expect(removed.body.removed).toBe(true);
    const assignmentAuditActions = await ownerPrisma.auditLog.findMany({
      where: {
        centerId: centerA.centerId,
        entityId: assignment.body.studentFee.id,
      },
      select: { action: true },
    });
    expect(assignmentAuditActions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(["fee_assignment.changed", "fee_assignment.ended"]),
    );

    await authorized(centerA)
      .patch(`/fee-plans/${planId}`)
      .send({ isActive: false });
  });

  it("generates idempotent monthly and one-time charges with price snapshots", async () => {
    const monthlyPlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Snapshot plan",
      amountPaise: "125000",
    });
    expect(monthlyPlan.status).toBe(201);
    const monthlyPlanId = monthlyPlan.body.feePlan.id as string;
    const assignmentA = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({
        feePlanId: monthlyPlanId,
        startDate: currentMonthStart(),
        endDate: lastDayOfMonth(currentMonthInBusinessTimeZone()),
      });
    const assignmentA2 = await authorized(centerA)
      .post(`/students/${studentA2Id}/fees`)
      .send({
        feePlanId: monthlyPlanId,
        customAmountPaise: "100000",
        startDate: currentMonthStart(),
        endDate: lastDayOfMonth(currentMonthInBusinessTimeZone()),
      });
    expect([assignmentA.status, assignmentA2.status]).toEqual([201, 201]);

    const oncePlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "One-time registration",
      amountPaise: "25000",
      frequency: "ONE_TIME",
    });
    expect(oncePlan.status).toBe(201);
    const oneTimeAssignment = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({
        feePlanId: oncePlan.body.feePlan.id,
        startDate: currentMonthStart(),
      });
    expect(oneTimeAssignment.status).toBe(201);

    const month = currentMonthInBusinessTimeZone();
    const firstRun = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month });
    expect(firstRun.status).toBe(200);
    expect(firstRun.body).toEqual({
      month,
      created: 3,
      alreadyExisted: 0,
    });

    const amountsBefore = await ownerPrisma.feeCharge.findMany({
      where: {
        centerId: centerA.centerId,
        studentFeeId: {
          in: [
            assignmentA.body.studentFee.id as string,
            assignmentA2.body.studentFee.id as string,
            oneTimeAssignment.body.studentFee.id as string,
          ],
        },
      },
      orderBy: [{ studentId: "asc" }, { periodStart: "asc" }],
    });
    expect(amountsBefore.map(({ amountPaise }) => amountPaise.toString()).sort()).toEqual(
      ["100000", "125000", "25000"].sort(),
    );

    const priceChange = await authorized(centerA)
      .patch(`/fee-plans/${monthlyPlanId}`)
      .send({ amountPaise: "150000" });
    expect(priceChange.status).toBe(200);
    const secondRun = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month });
    expect(secondRun.status).toBe(200);
    expect(secondRun.body).toEqual({
      month,
      created: 0,
      alreadyExisted: 3,
    });
    const unchanged = await ownerPrisma.feeCharge.findMany({
      where: {
        centerId: centerA.centerId,
        studentFeeId: {
          in: [
            assignmentA.body.studentFee.id as string,
            assignmentA2.body.studentFee.id as string,
          ],
        },
      },
    });
    expect(unchanged.map(({ amountPaise }) => amountPaise.toString()).sort()).toEqual(
      ["100000", "125000"].sort(),
    );
    const ended = await authorized(centerA).delete(
      `/students/${studentA2Id}/fees/${assignmentA2.body.studentFee.id}`,
    );
    expect(ended.status).toBe(200);
    expect(ended.body.removed).toBe(false);
    expect(ended.body.endDate).toBeTypeOf("string");

    const invalidFuture = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month: nextMonth(latestAllowedChargeMonth()) });
    expect(invalidFuture.status).toBe(400);
    expect(invalidFuture.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("respects assignment date windows and supports waiving and restoring charges", async () => {
    const plan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Window plan",
      amountPaise: "70000",
    });
    expect(plan.status).toBe(201);
    const afterMonth = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({
        feePlanId: plan.body.feePlan.id,
        startDate: nextMonth(currentMonthInBusinessTimeZone()),
      });
    expect(afterMonth.status).toBe(201);

    const outside = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month: currentMonthInBusinessTimeZone() });
    expect(outside.status).toBe(200);
    expect(outside.body.created).toBe(0);

    const generated = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month: latestAllowedChargeMonth() });
    expect(generated.status).toBe(200);
    expect(generated.body.created).toBe(1);
    const charge = await ownerPrisma.feeCharge.findFirstOrThrow({
      where: {
        centerId: centerA.centerId,
        studentFeeId: afterMonth.body.studentFee.id,
      },
    });
    const waived = await authorized(centerA)
      .patch(`/fees/charges/${charge.id}/waive`)
      .send({ reason: "Scholarship approved" });
    expect(waived.status).toBe(200);
    expect(waived.body.charge.amountPaise).toBe("70000");
    expect(waived.body.charge.waiveReason).toBe("Scholarship approved");
    const unwaived = await authorized(centerA)
      .post(`/fees/charges/${charge.id}/unwaive`)
      .send({});
    expect(unwaived.status).toBe(200);
    expect(unwaived.body.charge.waivedAt).toBeNull();
    expect(
      await ownerPrisma.auditLog.count({
        where: {
          centerId: centerA.centerId,
          entityId: charge.id,
          action: { in: ["charge.waived", "charge.unwaived"] },
        },
      }),
    ).toBe(2);
    expect(
      await ownerPrisma.auditLog.count({
        where: { centerId: centerA.centerId, action: "charges.generated" },
      }),
    ).toBeGreaterThan(0);
  });

  it("limits deletion of students with financial history and protects center isolation", async () => {
    const plan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Student history plan",
      amountPaise: "85000",
    });
    expect(plan.status).toBe(201);
    const assignment = await authorized(centerA)
      .post(`/students/${studentAId}/fees`)
      .send({ feePlanId: plan.body.feePlan.id, startDate: currentMonthStart() });
    expect(assignment.status).toBe(201);
    const deletedStudent = await authorized(centerA).delete(
      `/students/${studentA2Id}`,
    );
    expect(deletedStudent.status).toBe(409);
    expect(deletedStudent.body.error.code).toBe("STUDENT_HAS_FINANCIAL_HISTORY");

    const otherCenterAssignment = await authorized(centerA)
      .get(`/students/${studentBId}/fees`);
    expect(otherCenterAssignment.status).toBe(404);
  });

  it("records exact paise, allocates oldest charges first, supports replay and voiding", async () => {
    const monthlyPlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Payment monthly fixture",
      amountPaise: "40000",
      dueDay: 28,
    });
    const oneTimePlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Payment one-time fixture",
      amountPaise: "20000",
      frequency: "ONE_TIME",
    });
    expect([monthlyPlan.status, oneTimePlan.status]).toEqual([201, 201]);
    const monthlyAssignment = await authorized(centerA)
      .post(`/students/${studentAPaymentId}/fees`)
      .send({
        feePlanId: monthlyPlan.body.feePlan.id,
        startDate: currentMonthStart(),
      });
    const oneTimeAssignment = await authorized(centerA)
      .post(`/students/${studentAPaymentId}/fees`)
      .send({
        feePlanId: oneTimePlan.body.feePlan.id,
        startDate: currentMonthStart(),
      });
    expect([monthlyAssignment.status, oneTimeAssignment.status]).toEqual([
      201, 201,
    ]);

    const month = currentMonthInBusinessTimeZone();
    const generated = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month });
    expect(generated.status).toBe(200);
    const monthlyCharge = await ownerPrisma.feeCharge.findFirstOrThrow({
      where: {
        centerId: centerA.centerId,
        studentFeeId: monthlyAssignment.body.studentFee.id,
      },
    });
    const oneTimeCharge = await ownerPrisma.feeCharge.findFirstOrThrow({
      where: {
        centerId: centerA.centerId,
        studentFeeId: oneTimeAssignment.body.studentFee.id,
      },
    });

    const first = await authorized(centerA).post("/payments").send({
      studentId: studentAPaymentId,
      amountPaise: "30000",
      paidOn: todayInBusinessTimeZone(),
      method: "CASH",
    });
    expect(first.status).toBe(201);
    expect(first.body.payment).toMatchObject({
      amountPaise: "30000",
      receiptNumber: "R-000001",
      student: { id: studentAPaymentId },
      center: { id: centerA.centerId },
    });
    expect(first.body.payment.allocations).toEqual([
      expect.objectContaining({
        chargeId: oneTimeCharge.id,
        amountPaise: "20000",
      }),
      expect.objectContaining({
        chargeId: monthlyCharge.id,
        amountPaise: "10000",
      }),
    ]);

    const partial = await authorized(centerA).post("/payments").send({
      studentId: studentAPaymentId,
      amountPaise: "5000",
      paidOn: todayInBusinessTimeZone(),
      method: "UPI",
      reference: "upi-test-reference",
      allocations: [{ chargeId: monthlyCharge.id, amountPaise: "5000" }],
    });
    expect(partial.status).toBe(201);
    expect(partial.body.payment.receiptNumber).toBe("R-000002");
    expect(partial.body.payment.allocations[0].amountPaise).toBe("5000");

    const mismatch = await authorized(centerA).post("/payments").send({
      studentId: studentAPaymentId,
      amountPaise: "5000",
      paidOn: todayInBusinessTimeZone(),
      method: "CARD",
      allocations: [{ chargeId: monthlyCharge.id, amountPaise: "4999" }],
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe("ALLOCATION_TOTAL_MISMATCH");

    const overallocated = await authorized(centerA).post("/payments").send({
      studentId: studentAPaymentId,
      amountPaise: "25001",
      paidOn: todayInBusinessTimeZone(),
      method: "CARD",
      allocations: [{ chargeId: monthlyCharge.id, amountPaise: "25001" }],
    });
    expect(overallocated.status).toBe(422);
    expect(overallocated.body.error.code).toBe("ALLOCATION_EXCEEDS_OUTSTANDING");

    const advance = await authorized(centerA).post("/payments").send({
      studentId: studentAPaymentId,
      amountPaise: "999999999",
      paidOn: todayInBusinessTimeZone(),
      method: "CASH",
    });
    expect(advance.status).toBe(422);
    expect(advance.body.error.code).toBe("PAYMENT_EXCEEDS_OUTSTANDING");
    expect(advance.body.error.message).toContain("paise");

    const future = new Date(`${todayInBusinessTimeZone()}T00:00:00.000Z`);
    future.setUTCDate(future.getUTCDate() + 1);
    const futurePayment = await authorized(centerA).post("/payments").send({
      studentId: studentAPaymentId,
      amountPaise: "1",
      paidOn: future.toISOString().slice(0, 10),
      method: "OTHER",
    });
    expect(futurePayment.status).toBe(400);

    const idempotentInput = {
      studentId: studentAPaymentId,
      amountPaise: "1",
      paidOn: todayInBusinessTimeZone(),
      method: "BANK_TRANSFER",
    };
    const idempotencyKey = `fees-idem-${randomUUID()}`;
    const initialReplay = await authorized(centerA)
      .post("/payments")
      .set("Idempotency-Key", idempotencyKey)
      .send(idempotentInput);
    expect(initialReplay.status).toBe(201);
    const replay = await authorized(centerA)
      .post("/payments")
      .set("Idempotency-Key", idempotencyKey)
      .send(idempotentInput);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(initialReplay.body);

    const details = await authorized(centerA).get(
      `/payments/${first.body.payment.id}`,
    );
    expect(details.status).toBe(200);
    expect(details.body.payment).toMatchObject({
      center: { name: `Fees A` },
      student: { id: studentAPaymentId, name: "Fees A payment student" },
      receiptNumber: "R-000001",
      amountPaise: "30000",
    });
    const listed = await authorized(centerA).get(
      `/payments?studentId=${studentAPaymentId}&method=UPI`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.payments).toHaveLength(1);
    expect(listed.body.payments[0].amountPaise).toBe("5000");

    const voided = await authorized(centerA)
      .post(`/payments/${first.body.payment.id}/void`)
      .send({ reason: "Payment entered in error" });
    expect(voided.status).toBe(200);
    expect(voided.body.payment.voidReason).toBe("Payment entered in error");
    expect(
      await ownerPrisma.auditLog.count({
        where: {
          centerId: centerA.centerId,
          entityId: first.body.payment.id,
          action: { in: ["payment.recorded", "payment.voided"] },
        },
      }),
    ).toBe(2);
    const doubleVoid = await authorized(centerA)
      .post(`/payments/${first.body.payment.id}/void`)
      .send({ reason: "Repeated void attempt" });
    expect(doubleVoid.status).toBe(409);
    expect(doubleVoid.body.error.code).toBe("PAYMENT_ALREADY_VOIDED");
    expect(
      (await authorized(centerA).get(
        `/payments?includeVoided=true&studentId=${studentAPaymentId}`,
      )).body.payments.some(
        (payment: { id: string }) => payment.id === first.body.payment.id,
      ),
    ).toBe(true);

    const deletePayment = await authorized(centerA).delete(
      `/payments/${partial.body.payment.id}`,
    );
    expect(deletePayment.status).toBe(404);
    const patchPayment = await authorized(centerA)
      .patch(`/payments/${partial.body.payment.id}`)
      .send({ amountPaise: "1" });
    expect(patchPayment.status).toBe(404);

    const privileges = await appPrisma.$queryRaw<
      Array<{ role: string; paymentDelete: boolean; allocationDelete: boolean }>
    >`
      SELECT current_user AS role,
             has_table_privilege(current_user, 'public."Payment"', 'DELETE') AS "paymentDelete",
             has_table_privilege(current_user, 'public."PaymentAllocation"', 'DELETE') AS "allocationDelete"
    `;
    expect(privileges[0]).toMatchObject({
      role: "tutordesk_app",
      paymentDelete: false,
      allocationDelete: false,
    });
  });

  it("serializes concurrent payments and generates unique per-center receipts", async () => {
    const concurrentPlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Concurrent receipt plan",
      amountPaise: "1000",
      dueDay: 28,
    });
    const concurrentAssignment = await authorized(centerA)
      .post(`/students/${studentAPaymentId}/fees`)
      .send({
        feePlanId: concurrentPlan.body.feePlan.id,
        startDate: currentMonthStart(),
      });
    expect(concurrentAssignment.status).toBe(201);
    const month = currentMonthInBusinessTimeZone();
    const generated = await authorized(centerA)
      .post("/fees/charges/generate")
      .send({ month });
    expect(generated.status).toBe(200);
    const concurrentCharge = await ownerPrisma.feeCharge.findFirstOrThrow({
      where: {
        centerId: centerA.centerId,
        studentFeeId: concurrentAssignment.body.studentFee.id,
      },
    });

    const tenPayments = await Promise.all(
      Array.from({ length: 10 }, () =>
        authorized(centerA).post("/payments").send({
          studentId: studentAPaymentId,
          amountPaise: "1",
          paidOn: todayInBusinessTimeZone(),
          method: "CASH",
        }),
      ),
    );
    expect(tenPayments.every(({ status }) => status === 201)).toBe(true);
    const tenReceipts = tenPayments.map(
      ({ body }) => body.payment.receiptNumber as string,
    );
    expect(new Set(tenReceipts).size).toBe(10);

    const competing = await Promise.all([
      authorized(centerA).post("/payments").send({
        studentId: studentAPaymentId,
        amountPaise: "800",
        paidOn: todayInBusinessTimeZone(),
        method: "UPI",
        allocations: [{ chargeId: concurrentCharge.id, amountPaise: "800" }],
      }),
      authorized(centerA).post("/payments").send({
        studentId: studentAPaymentId,
        amountPaise: "800",
        paidOn: todayInBusinessTimeZone(),
        method: "UPI",
        allocations: [{ chargeId: concurrentCharge.id, amountPaise: "800" }],
      }),
    ]);
    expect(competing.map(({ status }) => status).sort()).toEqual([201, 422]);

    const centerBPlan = await createPlan(centerB, {
      batchId: batchBId,
      name: "Center B receipt plan",
      amountPaise: "5000",
      frequency: "ONE_TIME",
    });
    const centerBAssignment = await authorized(centerB)
      .post(`/students/${studentBId}/fees`)
      .send({
        feePlanId: centerBPlan.body.feePlan.id,
        startDate: currentMonthStart(),
      });
    expect(centerBAssignment.status).toBe(201);
    const centerBGeneration = await authorized(centerB)
      .post("/fees/charges/generate")
      .send({ month: currentMonthInBusinessTimeZone() });
    expect(centerBGeneration.status).toBe(200);
    const centerBCharge = await ownerPrisma.feeCharge.findFirstOrThrow({
      where: { centerId: centerB.centerId, studentFeeId: centerBAssignment.body.studentFee.id },
    });
    const centerBPayment = await authorized(centerB).post("/payments").send({
      studentId: studentBId,
      amountPaise: "5000",
      paidOn: todayInBusinessTimeZone(),
      method: "UPI",
      allocations: [{ chargeId: centerBCharge.id, amountPaise: "5000" }],
    });
    expect(centerBPayment.status).toBe(201);
    expect(centerBPayment.body.payment.receiptNumber).toBe("R-000001");
    expect(
      (
        await authorized(centerA).get(
          `/payments/${centerBPayment.body.payment.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await authorized(centerA)
          .post(`/payments/${centerBPayment.body.payment.id}/void`)
          .send({ reason: "Cross-center probe" })
      ).status,
    ).toBe(404);
    expect(
      (
        await authorized(centerA).post("/payments").send({
          studentId: studentBId,
          amountPaise: "1",
          paidOn: todayInBusinessTimeZone(),
          method: "CASH",
        })
      ).status,
    ).toBe(404);

    const receiptsA = await ownerPrisma.payment.findMany({
      where: { centerId: centerA.centerId },
      select: { receiptNumber: true },
      orderBy: { receiptNumber: "asc" },
    });
    expect(receiptsA.map(({ receiptNumber }) => receiptNumber)).toEqual(
      receiptsA.map((_, index) => `R-${String(index + 1).padStart(6, "0")}`),
    );
  });

  it("computes student dues, batch summaries, and overdue days in paise", async () => {
    const studentName = `Dues student ${randomUUID()}`;
    const studentId = await createStudent(centerA, studentName);
    const enrolled = await authorized(centerA)
      .post(`/batches/${batchAId}/students`)
      .send({ studentIds: [studentId] });
    expect(enrolled.status).toBe(200);

    const today = todayInBusinessTimeZone();
    const overdueDate = shiftCalendarDate(today, -3);
    const overduePlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Overdue one-time fee",
      amountPaise: "10000",
      frequency: "ONE_TIME",
    });
    expect(overduePlan.status).toBe(201);
    const overdueAssignment = await authorized(centerA)
      .post(`/students/${studentId}/fees`)
      .send({
        feePlanId: overduePlan.body.feePlan.id,
        startDate: overdueDate,
      });
    expect(overdueAssignment.status).toBe(201);

    const todayPlan = await createPlan(centerA, {
      batchId: batchAId,
      name: "Due today one-time fee",
      amountPaise: "5000",
      frequency: "ONE_TIME",
    });
    expect(todayPlan.status).toBe(201);
    const todayAssignment = await authorized(centerA)
      .post(`/students/${studentId}/fees`)
      .send({
        feePlanId: todayPlan.body.feePlan.id,
        startDate: today,
      });
    expect(todayAssignment.status).toBe(201);

    for (const month of new Set([overdueDate.slice(0, 7), today.slice(0, 7)])) {
      const generated = await authorized(centerA)
        .post("/fees/charges/generate")
        .send({ month });
      expect(generated.status).toBe(200);
    }

    const overdueCharge = await ownerPrisma.feeCharge.findFirstOrThrow({
      where: {
        centerId: centerA.centerId,
        studentFeeId: overdueAssignment.body.studentFee.id,
      },
    });
    const partialPayment = await authorized(centerA).post("/payments").send({
      studentId,
      amountPaise: "4000",
      paidOn: today,
      method: "CASH",
      allocations: [{ chargeId: overdueCharge.id, amountPaise: "4000" }],
    });
    expect(partialPayment.status).toBe(201);

    const dues = await authorized(centerA).get(`/students/${studentId}/dues`);
    expect(dues.status).toBe(200);
    expect(dues.body.dues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chargeId: overdueCharge.id,
          dueDate: overdueDate,
          amountPaise: "10000",
          paidPaise: "4000",
          outstandingPaise: "6000",
          status: "OVERDUE",
        }),
        expect.objectContaining({
          dueDate: today,
          amountPaise: "5000",
          paidPaise: "0",
          outstandingPaise: "5000",
          status: "UNPAID",
        }),
      ]),
    );
    expect(dues.body.totals).toEqual({
      totalChargedPaise: "15000",
      totalPaidPaise: "4000",
      totalOutstandingPaise: "11000",
      totalOverduePaise: "6000",
    });

    const batchSummary = await authorized(centerA).get(
      `/fees/dues/summary?batchId=${batchAId}`,
    );
    expect(batchSummary.status).toBe(200);
    expect(batchSummary.body.batches).toHaveLength(1);
    expect(batchSummary.body.students).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId,
          studentName,
          totalChargedPaise: "15000",
          totalPaidPaise: "4000",
          totalOutstandingPaise: "11000",
          totalOverduePaise: "6000",
        }),
      ]),
    );

    const overdue = await authorized(centerA).get("/fees/overdue?sort=age");
    expect(overdue.status).toBe(200);
    expect(overdue.body.students).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId,
          studentName,
          overduePaise: "6000",
          oldestOverdueDate: overdueDate,
          daysOverdue: 3,
        }),
      ]),
    );
    expect(todayInBusinessTimeZone(new Date("2026-10-28T18:29:59.000Z"))).toBe(
      "2026-10-28",
    );
    expect(todayInBusinessTimeZone(new Date("2026-10-28T18:30:00.000Z"))).toBe(
      "2026-10-29",
    );

    expect(
      (await authorized(centerA).get(`/students/${studentBId}/dues`)).status,
    ).toBe(404);
    expect(
      (
        await authorized(centerA).get(
          `/fees/dues/summary?batchId=${batchBId}`,
        )
      ).status,
    ).toBe(404);
  });

  it("denies teachers and parents access to fee and payment endpoints", async () => {
    const teacherEmail = `fees-teacher-${randomUUID()}@example.test`;
    userEmails.push(teacherEmail);
    const teacherInvite = await authorized(centerA)
      .post("/invites")
      .send({ email: teacherEmail, role: "TEACHER" });
    expect(teacherInvite.status).toBe(201);
    const teacherToken = new URL(
      teacherInvite.body.inviteLink as string,
    ).searchParams.get("token");
    expect(teacherToken).toBeTruthy();
    const teacherAccepted = await request(app)
      .post("/auth/accept-invite")
      .send({
        token: teacherToken,
        name: "Fee test teacher",
        password: "correct horse battery",
      });
    expect(teacherAccepted.status).toBe(200);
    const teacher: TestCenter = {
      ...centerA,
      accessToken: teacherAccepted.body.accessToken as string,
    };
    const teacherUser = await ownerPrisma.user.findUniqueOrThrow({
      where: { email: teacherEmail },
      select: { id: true },
    });
    const assignedTeacher = await request(app)
      .put(`/batches/${batchAId}/teachers`)
      .set("Authorization", `Bearer ${centerA.accessToken}`)
      .send({ userIds: [teacherUser.id] });
    expect(assignedTeacher.status).toBe(200);

    const parentEmail = `fees-parent-${randomUUID()}@example.test`;
    userEmails.push(parentEmail);
    const parentInvite = await authorized(teacher)
      .post("/invites")
      .send({
        email: parentEmail,
        role: "PARENT",
        studentId: studentAPaymentId,
      });
    expect(parentInvite.status).toBe(201);
    const parentToken = new URL(
      parentInvite.body.inviteLink as string,
    ).searchParams.get("token");
    expect(parentToken).toBeTruthy();
    const parentAccepted = await request(app)
      .post("/auth/accept-invite")
      .send({
        token: parentToken,
        name: "Fee test parent",
        password: "correct horse battery",
      });
    expect(parentAccepted.status).toBe(200);
    const parent: TestCenter = {
      ...centerA,
      accessToken: parentAccepted.body.accessToken as string,
    };

    for (const member of [teacher, parent]) {
      expect((await authorized(member).get("/fee-plans")).status).toBe(403);
      expect(
        (await authorized(member).get(`/students/${studentAPaymentId}/fees`))
          .status,
      ).toBe(403);
      expect(
        (
          await authorized(member)
            .post("/fees/charges/generate")
            .send({ month: currentMonthInBusinessTimeZone() })
        ).status,
      ).toBe(403);
      expect((await authorized(member).get("/payments")).status).toBe(403);
      expect((await authorized(member).get("/fees/dues/summary")).status).toBe(
        403,
      );
      expect((await authorized(member).get("/fees/overdue")).status).toBe(403);
      expect(
        (await authorized(member).get(`/students/${studentAPaymentId}/dues`))
          .status,
      ).toBe(403);
    }
  });

  it("enforces fail-closed RLS on every fee and payment table", async () => {
    const tableNames = [
      "FeePlan",
      "StudentFee",
      "FeeCharge",
      "Payment",
      "PaymentAllocation",
      "CenterCounter",
    ] as const;
    const rlsState = await appPrisma.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`
      SELECT c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'FeePlan', 'StudentFee', 'FeeCharge',
          'Payment', 'PaymentAllocation', 'CenterCounter'
        )
    `;
    expect(rlsState).toHaveLength(tableNames.length);
    expect(
      rlsState.every(
        ({ relrowsecurity, relforcerowsecurity }) =>
          relrowsecurity && relforcerowsecurity,
      ),
    ).toBe(true);

    for (const tableName of tableNames) {
      const withTenant = await appPrisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT set_config('app.current_center', ${centerA.centerId}, true)
        `;
        return transaction.$queryRaw<Array<{ centerId: string }>>(
          Prisma.raw(`SELECT "centerId" FROM "public"."${tableName}"`),
        );
      });
      expect(withTenant.length).toBeGreaterThan(0);
      expect(new Set(withTenant.map(({ centerId }) => centerId))).toEqual(
        new Set([centerA.centerId]),
      );

      const withoutTenant = await appPrisma.$transaction((transaction) =>
        transaction.$queryRaw<Array<{ centerId: string }>>(
          Prisma.raw(`SELECT "centerId" FROM "public"."${tableName}"`),
        ),
      );
      expect(withoutTenant).toEqual([]);
    }
  });
});
