import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { Express } from "express";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listCenterIdsForJobs, processJob } from "../src/jobs/processors";
import { jobQueue } from "../src/jobs/queues";
import { registerDailySchedule } from "../src/jobs/scheduler";
import { todayInBusinessTimeZone } from "../src/lib/dates";

type TestCenter = {
  userId: string;
  centerId: string;
  accessToken: string;
};

let app: Express;
let appPrisma: typeof import("../src/lib/prisma").prisma;
let ownerPrisma: PrismaClient;
let freeCenter: TestCenter;
let otherCenter: TestCenter;
let jobStudentId: string;
let unlinkedStudentId: string;
let jobCenterBatchId: string;
let parentUserId: string;
const emails: string[] = [];
const centerIds: string[] = [];
const queuedJobIds: string[] = [];

const signup = async (): Promise<TestCenter> => {
  const email = `plans-${randomUUID()}@example.test`;
  const response = await request(app).post("/auth/signup-center").send({
    name: "Plan test owner",
    email,
    password: "correct horse battery",
    centerName: "Plan test center",
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
  const authorization = `Bearer ${center.accessToken}`;
  return {
    get: (path: string) => request(app).get(path).set("Authorization", authorization),
    post: (path: string) =>
      request(app).post(path).set("Authorization", authorization),
    patch: (path: string) =>
      request(app).patch(path).set("Authorization", authorization),
  };
};

beforeAll(async () => {
  process.env.NODE_ENV = "test";
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
  await ownerPrisma.$connect();
  freeCenter = await signup();
  otherCenter = await signup();
}, 30_000);

afterAll(async () => {
  await jobQueue.removeJobScheduler("tutordesk-daily-center-fanout");
  for (const id of queuedJobIds) {
    const job = await jobQueue.getJob(id);
    if (job) {
      await job.remove();
    }
  }
  await ownerPrisma.auditLog.deleteMany({
    where: { centerId: { in: centerIds } },
  });
  await ownerPrisma.jobOutbox.deleteMany({
    where: { centerId: { in: centerIds } },
  });
  for (const centerId of centerIds) {
    await ownerPrisma.center.deleteMany({ where: { id: centerId } });
  }
  if (emails.length > 0) {
    await ownerPrisma.user.deleteMany({ where: { email: { in: emails } } });
  }
  await jobQueue.close();
  await appPrisma.$disconnect();
  await ownerPrisma.$disconnect();
});

describe("plan limits", () => {
  it("reports plan limits and enforces a serialized final student slot", async () => {
    const plan = await authorized(freeCenter).get("/plan");
    expect(plan.status).toBe(200);
    expect(plan.body).toEqual({
      plan: "FREE",
      limits: {
        students: 30,
        teachers: 2,
        batches: 3,
        requestsPerMinute: 60,
      },
      usage: { students: 0, teachers: 0, batches: 0 },
    });

    await ownerPrisma.student.createMany({
      data: Array.from({ length: 29 }, (_, index) => ({
        centerId: freeCenter.centerId,
        name: `Seed student ${index}`,
      })),
    });
    const createStudent = () =>
      authorized(freeCenter).post("/students").send({ name: "Last slot" });
    const race = await Promise.all([createStudent(), createStudent()]);
    expect(race.map(({ status }) => status).sort()).toEqual([201, 402]);
    expect(
      race.find(({ status }) => status === 402)?.body.error.code,
    ).toBe("PLAN_LIMIT_REACHED");

    const blocked = await createStudent();
    expect(blocked.status).toBe(402);
    const centerAPlan = await authorized(freeCenter).get("/plan");
    const centerBPlan = await authorized(otherCenter).get("/plan");
    expect(centerAPlan.body.usage.students).toBe(30);
    expect(centerBPlan.body.usage.students).toBe(0);
  });

  it("enforces teacher and batch limits, counting pending teacher invites", async () => {
    const teacherInvites = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        (async () => {
          const email = `pending-teacher-${index}-${randomUUID()}@example.test`;
          emails.push(email);
          return authorized(freeCenter)
            .post("/invites")
            .send({ email, role: "TEACHER" });
        })(),
      ),
    );
    expect(teacherInvites.map(({ status }) => status).sort()).toEqual([
      201, 201, 402,
    ]);
    const planWithTeachers = await authorized(freeCenter).get("/plan");
    expect(planWithTeachers.body.usage.teachers).toBe(2);
    const pending = teacherInvites.find(({ status }) => status === 201);
    const token = new URL(pending?.body.inviteLink as string)
      .searchParams.get("token");
    const accepted = await request(app).post("/auth/accept-invite").send({
      token,
      name: "Capacity checked teacher",
      password: "correct horse battery",
    });
    expect(accepted.status).toBe(200);
    expect((await authorized(freeCenter).get("/plan")).body.usage.teachers).toBe(
      2,
    );
    const teacherPlanAccess = await request(app)
      .get("/plan")
      .set("Authorization", `Bearer ${accepted.body.accessToken as string}`);
    expect(teacherPlanAccess.status).toBe(403);

    const batchResponses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        authorized(freeCenter)
          .post("/batches")
          .send({ name: `Limited batch ${index}` }),
      ),
    );
    expect(batchResponses.map(({ status }) => status).sort()).toEqual([
      201, 201, 201, 402,
    ]);
    const planWithBatches = await authorized(freeCenter).get("/plan");
    expect(planWithBatches.body.usage.batches).toBe(3);
  });

  it("allows PRO capacity, rejects an over-limit downgrade, and deletes no data", async () => {
    const upgrade = await authorized(freeCenter)
      .patch("/plan")
      .send({ plan: "PRO" });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body.plan).toBe("PRO");
    expect(upgrade.body.limits).toMatchObject({
      students: 500,
      teachers: 20,
      batches: null,
    });

    const additionalStudents = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        authorized(freeCenter)
          .post("/students")
          .send({ name: `PRO student ${index}` }),
      ),
    );
    expect(additionalStudents.map(({ status }) => status)).toEqual([201, 201]);

    const downgrade = await authorized(freeCenter)
      .patch("/plan")
      .send({ plan: "FREE" });
    expect(downgrade.status).toBe(409);
    expect(downgrade.body.error.code).toBe("PLAN_LIMIT_REACHED");
    expect(downgrade.body.error.message).toContain("students: 32/30");
    expect(
      await ownerPrisma.student.count({
        where: { centerId: freeCenter.centerId },
      }),
    ).toBe(32);
    expect((await authorized(freeCenter).get("/plan")).body.plan).toBe("PRO");

    const ownerOnly = await authorized(otherCenter)
      .post("/invites")
      .send({
        email: `another-teacher-${randomUUID()}@example.test`,
        role: "TEACHER",
      });
    expect(ownerOnly.status).toBe(201);
    expect((await authorized(otherCenter).patch("/plan").send({ plan: "PRO" })).status).toBe(200);
    expect((await authorized(otherCenter).patch("/plan").send({ plan: "FREE" })).status).toBe(200);
  });

  it("uses a minimal ID-only center listing function under the app role", async () => {
    const centers = await listCenterIdsForJobs();
    expect(centers).toEqual(
      expect.arrayContaining([freeCenter.centerId, otherCenter.centerId]),
    );
    const rows = await appPrisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM public.list_center_ids()
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => Object.keys(row).join(",") === "id")).toBe(true);
    const functionAccess = await appPrisma.$queryRaw<
      Array<{ canExecute: boolean; currentUser: string }>
    >`
      SELECT has_function_privilege(current_user, 'public.list_center_ids()', 'EXECUTE') AS "canExecute",
             current_user AS "currentUser"
    `;
    expect(functionAccess[0]).toEqual({
      canExecute: true,
      currentUser: "tutordesk_app",
    });
  });

  it("registers exactly one stable daily scheduler when initialized twice", async () => {
    await registerDailySchedule();
    await registerDailySchedule();
    const schedulers = await jobQueue.getJobSchedulers();
    expect(
      schedulers.filter(
        ({ key }) => key === "tutordesk-daily-center-fanout",
      ),
    ).toHaveLength(1);
    const scheduler = schedulers.find(
      ({ key }) => key === "tutordesk-daily-center-fanout",
    );
    expect(scheduler?.tz).toBe("Asia/Kolkata");
  });

  it("generates monthly charges idempotently and remits overdue parents per center", async () => {
    const currentMonth = todayInBusinessTimeZone().slice(0, 7);
    const dueDate = todayInBusinessTimeZone();
    const student = await ownerPrisma.student.create({
      data: { centerId: otherCenter.centerId, name: "Job linked child" },
      select: { id: true },
    });
    jobStudentId = student.id;
    const unlinked = await ownerPrisma.student.create({
      data: { centerId: otherCenter.centerId, name: "Job unlinked child" },
      select: { id: true },
    });
    unlinkedStudentId = unlinked.id;
    const batch = await ownerPrisma.batch.create({
      data: { centerId: otherCenter.centerId, name: "Job batch" },
      select: { id: true },
    });
    jobCenterBatchId = batch.id;
    const parentEmail = `job-parent-${randomUUID()}@example.test`;
    emails.push(parentEmail);
    const parentUser = await ownerPrisma.user.create({
      data: {
        name: "Job parent",
        email: parentEmail,
        passwordHash: "unused-test-hash",
        memberships: {
          create: {
            centerId: otherCenter.centerId,
            role: "PARENT",
          },
        },
      },
      select: { id: true },
    });
    parentUserId = parentUser.id;
    await ownerPrisma.parentStudent.create({
      data: {
        centerId: otherCenter.centerId,
        userId: parentUserId,
        studentId: jobStudentId,
      },
    });
    const plan = await ownerPrisma.feePlan.create({
      data: {
        centerId: otherCenter.centerId,
        batchId: jobCenterBatchId,
        name: "Worker monthly fee",
        amountPaise: 12000n,
        frequency: "MONTHLY",
        dueDay: 1,
      },
      select: { id: true },
    });
    const assignment = await ownerPrisma.studentFee.create({
      data: {
        centerId: otherCenter.centerId,
        studentId: jobStudentId,
        feePlanId: plan.id,
        startDate: new Date(`${currentMonth}-01T00:00:00.000Z`),
      },
      select: { id: true },
    });
    const job = {
      name: "generate-monthly-charges",
      data: { centerId: otherCenter.centerId, month: currentMonth },
    } as Job;
    const first = await processJob(job);
    const second = await processJob(job);
    expect(first).toMatchObject({ created: 1, alreadyExisted: 0 });
    expect(second).toMatchObject({ created: 0, alreadyExisted: 1 });
    expect(
      await ownerPrisma.feeCharge.count({
        where: {
          centerId: otherCenter.centerId,
          studentFeeId: assignment.id,
        },
      }),
    ).toBe(1);

    const pastDue = new Date(`${dueDate}T00:00:00.000Z`);
    pastDue.setUTCDate(pastDue.getUTCDate() - 3);
    for (const studentId of [jobStudentId, unlinkedStudentId]) {
      const studentFee = await ownerPrisma.studentFee.create({
        data: {
          centerId: otherCenter.centerId,
          studentId,
          feePlanId: plan.id,
          startDate: pastDue,
        },
        select: { id: true },
      });
      await ownerPrisma.feeCharge.create({
        data: {
          centerId: otherCenter.centerId,
          studentId,
          studentFeeId: studentFee.id,
          periodStart: pastDue,
          dueDate: pastDue,
          amountPaise: 5000n,
          description: "Overdue test fee",
        },
      });
    }
    const overdueJob = {
      name: "detect-overdue-and-remind",
      data: { centerId: otherCenter.centerId, date: dueDate },
    } as Job;
    await processJob(overdueJob);
    await processJob(overdueJob);
    const notifications = await ownerPrisma.notification.findMany({
      where: { centerId: otherCenter.centerId },
      orderBy: { studentId: "asc" },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: jobStudentId,
          parentUserId,
          status: "SENT",
          channel: "LOG",
        }),
        expect.objectContaining({
          studentId: unlinkedStudentId,
          parentUserId: null,
          status: "SKIPPED",
          skippedReason: "Student has no linked parent membership",
        }),
      ]),
    );
    expect(
      await ownerPrisma.notification.count({
        where: { centerId: freeCenter.centerId },
      }),
    ).toBe(0);
    for (const notification of notifications) {
      expect(Object.keys(notification.payload as object).sort()).toEqual(
        notification.status === "SKIPPED"
          ? ["overduePaise", "week"]
          : ["oldestOverdueDate", "overduePaise", "week"],
      );
      expect(JSON.stringify(notification.payload)).not.toContain(parentEmail);
      expect(notification.dedupeKey).toContain("fee-reminder:");
    }
  });

  it("keeps Notification tenant RLS enabled, forced, and fail closed", async () => {
    const rows = await appPrisma.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'public."Notification"'::regclass
    `;
    expect(rows).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
    ]);

    const scoped = await appPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${otherCenter.centerId}, true)
      `;
      return transaction.notification.findMany({
        select: { centerId: true },
      });
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(new Set(scoped.map(({ centerId }) => centerId))).toEqual(
      new Set([otherCenter.centerId]),
    );
    const unscoped = await appPrisma.$transaction((transaction) =>
      transaction.notification.findMany({ select: { id: true } }),
    );
    expect(unscoped).toEqual([]);
  });

  it("lists notifications and queues only the caller center for run-now", async () => {
    const app = await import("../src/app");
    const runNow = await authorized(otherCenter).post("/jobs/run-now").send({});
    expect(runNow.status).toBe(202);
    expect(runNow.body.status).toBe("DISPATCHED");
    const { chargeJobId, overdueJobId } = runNow.body.jobs as {
      chargeJobId: string;
      overdueJobId: string;
    };
    expect(
      await ownerPrisma.auditLog.count({
        where: {
          centerId: otherCenter.centerId,
          action: "job.run_now_triggered",
        },
      }),
    ).toBe(1);
    expect(
      await ownerPrisma.jobOutbox.count({
        where: {
          centerId: otherCenter.centerId,
          id: runNow.body.runId,
          status: "DISPATCHED",
          dispatchedAt: { not: null },
        },
      }),
    ).toBe(1);
    queuedJobIds.push(chargeJobId, overdueJobId);
    for (const jobId of [chargeJobId, overdueJobId]) {
      const job = await jobQueue.getJob(jobId);
      expect(job?.data).toMatchObject({ centerId: otherCenter.centerId });
      expect(Object.keys(job?.data as object).sort()).toEqual(
        job?.name === "generate-monthly-charges"
          ? ["centerId", "month"]
          : ["centerId", "date"],
      );
      expect(JSON.stringify(job?.data)).not.toContain("Job parent");
    }
    const listed = await authorized(otherCenter).get(
      "/notifications?status=SKIPPED",
    );
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    const foreign = await authorized(freeCenter).get("/notifications");
    expect(foreign.body.total).toBe(0);
    expect(app.app).toBeTruthy();
  });

  it("keeps a run-now outbox request pending until Redis dispatch succeeds", async () => {
    const queue = await import("../src/jobs/queues");
    const outbox = await import("../src/jobs/outbox");
    const addSpy = vi.spyOn(queue.jobQueue, "add").mockRejectedValue(
      new Error("temporary Redis failure"),
    );
    const pending = await authorized(otherCenter).post("/jobs/run-now").send({});
    expect(pending.status).toBe(202);
    expect(pending.body.status).toBe("PENDING");
    expect(pending.body.jobs).toBeNull();
    expect(
      await ownerPrisma.auditLog.count({
        where: {
          centerId: otherCenter.centerId,
          entityId: pending.body.runId,
          action: "job.run_now_triggered",
        },
      }),
    ).toBe(1);
    addSpy.mockRestore();

    const retried = await outbox.dispatchRunNowRequest(
      otherCenter.centerId,
      pending.body.runId as string,
    );
    expect(retried.status).toBe("DISPATCHED");
    expect(retried.jobs).toBeDefined();
    queuedJobIds.push(
      retried.jobs!.chargeJobId,
      retried.jobs!.overdueJobId,
    );
    expect(
      await ownerPrisma.jobOutbox.findUniqueOrThrow({
        where: { id: pending.body.runId as string },
        select: { status: true, dispatchedAt: true },
      }),
    ).toMatchObject({
      status: "DISPATCHED",
      dispatchedAt: expect.any(Date),
    });
  });
});
