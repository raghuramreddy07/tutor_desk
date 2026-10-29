import { jobQueue } from "./queues";
import { todayInBusinessTimeZone } from "../lib/dates";
import { withTenant } from "../lib/tenantDb";
import { recordAudit } from "../lib/audit";
import { listCenterIdsForJobs } from "./processors";
import { logger } from "../lib/logger";

const DISPATCH_LEASE_MS = 60_000;

export const createRunNowRequest = (centerId: string) => {
  const date = todayInBusinessTimeZone();
  const month = date.slice(0, 7);
  return withTenant(centerId, async (transaction) => {
    const request = await transaction.jobOutbox.create({
      data: { centerId, date, month },
      select: { id: true },
    });
    await recordAudit(transaction, {
      centerId,
      action: "job.run_now_triggered",
      entityType: "JobOutbox",
      entityId: request.id,
      metadata: { jobCount: 2 },
    });
    return request;
  });
};

export const dispatchRunNowRequest = async (
  centerId: string,
  requestId: string,
): Promise<{
  status: "PENDING" | "DISPATCHED" | "BUSY";
  jobs?: { chargeJobId: string; overdueJobId: string };
}> => {
  const claimed = await withTenant(centerId, async (transaction) => {
    const rows = await transaction.$queryRaw<
      Array<{ status: "PENDING" | "DISPATCHING" | "DISPATCHED"; updatedAt: Date }>
    >`
      SELECT "status", "updatedAt"
      FROM "JobOutbox"
      WHERE "id" = ${requestId}::uuid
        AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("Run-now outbox request was not found");
    }

    if (row.status === "DISPATCHED") {
      return transaction.jobOutbox.findFirstOrThrow({
        where: { id: requestId, centerId },
        select: { id: true, month: true, date: true, status: true },
      });
    }

    const staleBefore = new Date(Date.now() - DISPATCH_LEASE_MS);
    if (row.status === "DISPATCHING" && row.updatedAt > staleBefore) {
      return undefined;
    }

    return transaction.jobOutbox.update({
      where: { id: requestId },
      data: {
        status: "DISPATCHING",
        attempts: { increment: 1 },
        lastError: null,
      },
      select: { id: true, month: true, date: true, status: true },
    });
  });

  if (!claimed) {
    return { status: "BUSY" };
  }

  const chargeJobId = `manual-charges-${centerId}-${claimed.id}`;
  const overdueJobId = `manual-overdue-${centerId}-${claimed.id}`;
  if (claimed.status === "DISPATCHED") {
    return {
      status: "DISPATCHED",
      jobs: { chargeJobId, overdueJobId },
    };
  }

  try {
    await Promise.all([
      jobQueue.add(
        "generate-monthly-charges",
        { centerId, month: claimed.month },
        { jobId: chargeJobId },
      ),
      jobQueue.add(
        "detect-overdue-and-remind",
        { centerId, date: claimed.date },
        { jobId: overdueJobId },
      ),
    ]);
  } catch (error) {
    await withTenant(centerId, (transaction) =>
      transaction.jobOutbox.updateMany({
        where: { id: requestId, centerId, status: "DISPATCHING" },
        data: { status: "PENDING", lastError: "Queue dispatch failed" },
      }),
    );
    logger.error({
      centerId,
      requestId,
      jobId: requestId,
      jobName: "run-now-dispatch",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "Could not dispatch a run-now outbox request");
    return { status: "PENDING" };
  }

  await withTenant(centerId, async (transaction) => {
    await transaction.jobOutbox.updateMany({
      where: { id: requestId, centerId, status: "DISPATCHING" },
      data: { status: "DISPATCHED", dispatchedAt: new Date(), lastError: null },
    });
  });
  return {
    status: "DISPATCHED",
    jobs: { chargeJobId, overdueJobId },
  };
};

export const dispatchPendingRunNowRequests = async (): Promise<void> => {
  const centerIds = await listCenterIdsForJobs();
  for (const centerId of centerIds) {
    try {
      const pending = await withTenant(centerId, (transaction) =>
        transaction.jobOutbox.findMany({
          where: {
            centerId,
            OR: [
              { status: "PENDING" },
              {
                status: "DISPATCHING",
                updatedAt: { lt: new Date(Date.now() - DISPATCH_LEASE_MS) },
              },
            ],
          },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: 100,
        }),
      );
      for (const request of pending) {
        await dispatchRunNowRequest(centerId, request.id);
      }
    } catch (error) {
      logger.error({
        centerId,
        jobId: "outbox-poll",
        jobName: "outbox-poll",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, "Could not dispatch the run-now outbox for a center");
    }
  }
};
