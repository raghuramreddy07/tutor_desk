import type { Job } from "bullmq";
import {
  isoWeekInBusinessTimeZone,
  todayInBusinessTimeZone,
} from "../lib/dates";
import { LogNotificationProvider } from "../lib/notifications/logProvider";
import type { NotificationProvider } from "../lib/notifications/provider";
import { prisma } from "../lib/prisma";
import { withTenant } from "../lib/tenantDb";
import { generateFeeCharges, listOverdueStudents } from "../modules/fees/service";
import type {
  DailySchedulerJob,
  DetectOverdueJob,
  GenerateMonthlyChargesJob,
} from "./queues";
import { jobQueue } from "./queues";

const notificationProvider: NotificationProvider = new LogNotificationProvider();

export const listCenterIdsForJobs = async (): Promise<string[]> => {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM public.list_center_ids()
  `;
  return rows.map(({ id }) => id);
};

const enqueueDailyCenterJobs = async (
  _job: Job<DailySchedulerJob>,
): Promise<{ centers: number }> => {
  const centerIds = await listCenterIdsForJobs();
  const today = todayInBusinessTimeZone();
  const month = today.slice(0, 7);
  const failures: string[] = [];

  for (const centerId of centerIds) {
    try {
      await jobQueue.add(
        "generate-monthly-charges",
        { centerId, month } satisfies GenerateMonthlyChargesJob,
        { jobId: `charges-${centerId}-${month}` },
      );
    } catch (error) {
      console.error("Could not enqueue monthly charge generation", {
        centerId,
        error,
      });
      failures.push(`charges:${centerId}`);
    }

    try {
      await jobQueue.add(
        "detect-overdue-and-remind",
        { centerId, date: today } satisfies DetectOverdueJob,
        { jobId: `overdue-${centerId}-${today}` },
      );
    } catch (error) {
      console.error("Could not enqueue overdue reminders", { centerId, error });
      failures.push(`overdue:${centerId}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Failed to enqueue center tasks: ${failures.join(", ")}`);
  }
  return { centers: centerIds.length };
};

const processMonthlyCharges = async (
  job: Job<GenerateMonthlyChargesJob>,
) =>
  generateFeeCharges(job.data.centerId, job.data.month);

const makeDedupeKey = (
  studentId: string,
  week: string,
  parentUserId: string | null,
): string =>
  parentUserId
    ? `fee-reminder:${studentId}:${week}:${parentUserId}`
    : `fee-reminder:${studentId}:${week}:no-parent`;

const processOverdueReminders = async (job: Job<DetectOverdueJob>) => {
  const { centerId, date } = job.data;
  const week = isoWeekInBusinessTimeZone(date);
  const overdueStudents: Array<{
    studentId: string;
    overduePaise: string;
    oldestOverdueDate: string;
    daysOverdue: number;
  }> = [];
  let offset = 0;
  while (true) {
    const page = await listOverdueStudents(centerId, {
      sort: "amount",
      limit: 100,
      offset,
    });
    overdueStudents.push(...page.students);
    offset += page.students.length;
    if (offset >= page.total || page.students.length === 0) {
      break;
    }
  }

  for (const overdue of overdueStudents) {
    const parentUserIds = await withTenant(centerId, async (transaction) => {
      const links = await transaction.parentStudent.findMany({
        where: {
          centerId,
          studentId: overdue.studentId,
          user: {
            memberships: {
              some: { centerId, role: "PARENT" },
            },
          },
        },
        select: { userId: true },
        orderBy: { userId: "asc" },
      });
      const uniqueIds = [...new Set(links.map(({ userId }) => userId))];
      if (uniqueIds.length === 0) {
        await transaction.notification.createMany({
          data: [{
            centerId,
            studentId: overdue.studentId,
            type: "FEE_REMINDER",
            channel: "LOG",
            status: "SKIPPED",
            payload: { week, overduePaise: overdue.overduePaise },
            dedupeKey: makeDedupeKey(overdue.studentId, week, null),
            skippedReason: "Student has no linked parent membership",
          }],
          skipDuplicates: true,
        });
        return [];
      }

      const dedupeKeys = uniqueIds.map((userId) =>
        makeDedupeKey(overdue.studentId, week, userId),
      );
      await transaction.notification.createMany({
        data: uniqueIds.map((parentUserId, index) => ({
          centerId,
          studentId: overdue.studentId,
          parentUserId,
          type: "FEE_REMINDER" as const,
          channel: "LOG" as const,
          status: "PENDING" as const,
          payload: {
            week,
            overduePaise: overdue.overduePaise,
            oldestOverdueDate: overdue.oldestOverdueDate,
          },
          dedupeKey: dedupeKeys[index]!,
        })),
        skipDuplicates: true,
      });
      return uniqueIds;
    });

    if (parentUserIds.length === 0) {
      continue;
    }
    const dedupeKeys = parentUserIds.map((parentUserId) =>
      makeDedupeKey(overdue.studentId, week, parentUserId),
    );
    const pending = await withTenant(centerId, (transaction) =>
      transaction.notification.findMany({
        where: {
          centerId,
          dedupeKey: { in: dedupeKeys },
          status: { in: ["PENDING", "FAILED"] },
        },
        select: {
          id: true,
          centerId: true,
          studentId: true,
          parentUserId: true,
          payload: true,
          status: true,
        },
      }),
    );
    for (const notification of pending) {
      await withTenant(centerId, (transaction) =>
        transaction.notification.updateMany({
          where: { id: notification.id, centerId, status: "FAILED" },
          data: { status: "PENDING", error: null },
        }),
      );
    }
    const retryable = pending.filter((notification) => notification.status === "PENDING" || notification.status === "FAILED");
    const failures: string[] = [];
    for (const notification of retryable) {
      try {
        await notificationProvider.send({
          notificationId: notification.id,
          centerId,
          studentId: notification.studentId,
          parentUserId: notification.parentUserId,
          payload: notification.payload as Record<string, unknown>,
        });
        await withTenant(centerId, (transaction) =>
          transaction.notification.updateMany({
            where: { id: notification.id, centerId, status: "PENDING" },
            data: { status: "SENT", sentAt: new Date(), error: null },
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Notification provider failed";
        await withTenant(centerId, (transaction) =>
          transaction.notification.updateMany({
            where: { id: notification.id, centerId },
            data: { status: "FAILED", error: message },
          }),
        );
        failures.push(notification.id);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Notification delivery failed for: ${failures.join(", ")}`);
    }
  }
  return { overdueStudents: overdueStudents.length };
};

export const processJob = async (job: Job): Promise<unknown> => {
  switch (job.name) {
    case "daily-center-fanout":
      return enqueueDailyCenterJobs(job as Job<DailySchedulerJob>);
    case "generate-monthly-charges":
      return processMonthlyCharges(job as Job<GenerateMonthlyChargesJob>);
    case "detect-overdue-and-remind":
      return processOverdueReminders(job as Job<DetectOverdueJob>);
    default:
      throw new Error(`Unknown TutorDesk job: ${job.name}`);
  }
};
