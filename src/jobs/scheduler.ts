import { env } from "../config/env";
import { BUSINESS_TIME_ZONE } from "../lib/dates";
import { jobQueue } from "./queues";

export const registerDailySchedule = async (): Promise<void> => {
  await jobQueue.upsertJobScheduler(
    "tutordesk-daily-center-fanout",
    {
      pattern: env.JOB_SCHEDULE_CRON,
      tz: BUSINESS_TIME_ZONE,
    },
    {
      name: "daily-center-fanout",
      data: {},
    },
  );
};
