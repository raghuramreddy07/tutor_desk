import { randomUUID } from "node:crypto";
import {
  todayInBusinessTimeZone,
} from "../lib/dates";
import type { DetectOverdueJob, GenerateMonthlyChargesJob } from "./queues";
import { jobQueue } from "./queues";

export const enqueueCenterJobs = async (
  centerId: string,
  runId = randomUUID(),
) => {
  const date = todayInBusinessTimeZone();
  const month = date.slice(0, 7);
  const [charges, overdue] = await Promise.all([
    jobQueue.add(
      "generate-monthly-charges",
      { centerId, month } satisfies GenerateMonthlyChargesJob,
      { jobId: `manual-charges-${centerId}-${runId}` },
    ),
    jobQueue.add(
      "detect-overdue-and-remind",
      { centerId, date } satisfies DetectOverdueJob,
      { jobId: `manual-overdue-${centerId}-${runId}` },
    ),
  ]);
  return { chargeJobId: charges.id, overdueJobId: overdue.id };
};
