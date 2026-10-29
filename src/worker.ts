import { Worker } from "bullmq";
import { env } from "./config/env";
import { JOB_QUEUE_NAME } from "./jobs/queues";
import { processJob } from "./jobs/processors";
import { registerDailySchedule } from "./jobs/scheduler";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

const worker = new Worker(JOB_QUEUE_NAME, processJob, {
  connection: redis.duplicate(),
  concurrency: 5,
});

worker.on("failed", (job, error) => {
  console.error("TutorDesk background job failed", {
    jobId: job?.id,
    jobName: job?.name,
    attemptsMade: job?.attemptsMade,
    error,
  });
});

worker.on("error", (error) => {
  console.error("TutorDesk worker error:", error);
});

const start = async (): Promise<void> => {
  await registerDailySchedule();
  console.log(
    `TutorDesk worker started; daily schedule ${env.JOB_SCHEDULE_CRON} (${env.NODE_ENV === "test" ? "test" : "Asia/Kolkata"})`,
  );
};

let closing: Promise<void> | undefined;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  closing ??= (async () => {
    console.log(`${signal} received; closing background worker`);
    await worker.close();
    await redis.quit();
    await prisma.$disconnect();
    console.log("TutorDesk worker shutdown complete");
  })();
  await closing;
};

process.on("SIGINT", (signal) => {
  void shutdown(signal).catch((error: unknown) => {
    console.error("Worker shutdown failed:", error);
    process.exitCode = 1;
  });
});
process.on("SIGTERM", (signal) => {
  void shutdown(signal).catch((error: unknown) => {
    console.error("Worker shutdown failed:", error);
    process.exitCode = 1;
  });
});

void start().catch((error: unknown) => {
  console.error("Could not start TutorDesk worker:", error);
  process.exitCode = 1;
  void shutdown("SIGTERM").catch((shutdownError: unknown) => {
    console.error("Worker cleanup after startup failure failed:", shutdownError);
  });
});
