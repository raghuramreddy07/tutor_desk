import { Worker } from "bullmq";
import { env } from "./config/env";
import { JOB_QUEUE_NAME } from "./jobs/queues";
import { processJob } from "./jobs/processors";
import { registerDailySchedule } from "./jobs/scheduler";
import { dispatchPendingRunNowRequests } from "./jobs/outbox";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { logger } from "./lib/logger";
import { verifyProductionDatabaseRole } from "./lib/productionDatabaseCheck";

const worker = new Worker(JOB_QUEUE_NAME, processJob, {
  connection: redis.duplicate(),
  concurrency: 5,
});
let outboxPollTimer: NodeJS.Timeout | undefined;

worker.on("failed", (job, error) => {
  logger.error({
    jobId: job?.id ?? null,
    jobName: job?.name ?? "unknown",
    centerId:
      typeof job?.data?.centerId === "string" ? job.data.centerId : null,
    attemptsMade: job?.attemptsMade,
    err: error,
  }, "TutorDesk background job failed");
});

worker.on("error", (error) => {
  logger.error({ err: error }, "TutorDesk worker error");
});

const start = async (): Promise<void> => {
  await verifyProductionDatabaseRole();
  await registerDailySchedule();
  await dispatchPendingRunNowRequests();
  outboxPollTimer = setInterval(() => {
    void dispatchPendingRunNowRequests().catch((error: unknown) => {
      logger.error({ err: error }, "Could not poll the run-now outbox");
    });
  }, 15_000);
  logger.info({
    jobName: "daily-center-fanout",
    schedule: env.JOB_SCHEDULE_CRON,
    timeZone: env.NODE_ENV === "test" ? "test" : "Asia/Kolkata",
  }, "TutorDesk worker started");
};

let closing: Promise<void> | undefined;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  closing ??= (async () => {
    logger.info({ signal }, "Closing background worker");
    if (outboxPollTimer) {
      clearInterval(outboxPollTimer);
    }
    await worker.close();
    await redis.quit();
    await prisma.$disconnect();
    logger.info("TutorDesk worker shutdown complete");
  })();
  await closing;
};

process.on("SIGINT", (signal) => {
  void shutdown(signal).catch((error: unknown) => {
    logger.error({ err: error }, "Worker shutdown failed");
    process.exitCode = 1;
  });
});
process.on("SIGTERM", (signal) => {
  void shutdown(signal).catch((error: unknown) => {
    logger.error({ err: error }, "Worker shutdown failed");
    process.exitCode = 1;
  });
});

void start().catch((error: unknown) => {
  logger.fatal({ err: error }, "Could not start TutorDesk worker");
  process.exitCode = 1;
  void shutdown("SIGTERM").catch((shutdownError: unknown) => {
    logger.error(
      { err: shutdownError },
      "Worker cleanup after startup failure failed",
    );
  });
});
