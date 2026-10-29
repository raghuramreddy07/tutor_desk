import { Queue } from "bullmq";
import { redis } from "../lib/redis";

export type GenerateMonthlyChargesJob = {
  centerId: string;
  month: string;
};

export type DetectOverdueJob = {
  centerId: string;
  date: string;
};

export type DailySchedulerJob = Record<string, never>;

export const JOB_QUEUE_NAME =
  process.env.NODE_ENV === "test" ? "tutordesk-jobs-test" : "tutordesk-jobs";

export const jobQueue = new Queue(JOB_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: false,
  },
});

export const closeJobQueue = async (): Promise<void> => {
  await jobQueue.close();
};
