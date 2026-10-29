import type { Plan } from "@prisma/client";

export const PLAN_LIMITS = {
  FREE: {
    students: 30,
    teachers: 2,
    batches: 3,
    requestsPerMinute: 60,
  },
  PRO: {
    students: 500,
    teachers: 20,
    batches: null,
    requestsPerMinute: 300,
  },
} as const satisfies Record<
  Plan,
  {
    students: number;
    teachers: number;
    batches: number | null;
    requestsPerMinute: number;
  }
>;

export type PlanResource = "students" | "teachers" | "batches";

export const planResourceLabel: Record<PlanResource, string> = {
  students: "student",
  teachers: "teacher",
  batches: "batch",
};
