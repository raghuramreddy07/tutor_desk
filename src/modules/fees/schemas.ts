import { z } from "zod";
import { calendarDateSchema } from "../../lib/calendarDateSchema";
import { optionalPaiseSchema } from "../../lib/money";

export const studentFeeParamsSchema = z.object({
  id: z.string().uuid(),
});

export const studentFeeAssignmentParamsSchema = z.object({
  id: z.string().uuid(),
  studentFeeId: z.string().uuid(),
});

export const createStudentFeeSchema = z
  .object({
    feePlanId: z.string().uuid(),
    customAmountPaise: optionalPaiseSchema,
    startDate: calendarDateSchema,
    endDate: calendarDateSchema.optional(),
  })
  .refine(
    ({ startDate, endDate }) => endDate === undefined || endDate >= startDate,
    "endDate must not be before startDate",
  );

export const updateStudentFeeSchema = z
  .object({
    customAmountPaise: optionalPaiseSchema,
    endDate: calendarDateSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const generateChargesSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must use YYYY-MM"),
});

export const feeChargeParamsSchema = z.object({
  id: z.string().uuid(),
});

export const waiveFeeChargeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const studentDuesParamsSchema = z.object({
  id: z.string().uuid(),
});

export const feeDuesSummaryQuerySchema = z.object({
  batchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const overdueQuerySchema = z.object({
  sort: z.enum(["amount", "age"]).default("amount"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateStudentFeeInput = z.infer<typeof createStudentFeeSchema>;
export type UpdateStudentFeeInput = z.infer<typeof updateStudentFeeSchema>;
export type FeeDuesSummaryQuery = z.infer<typeof feeDuesSummaryQuerySchema>;
export type OverdueQuery = z.infer<typeof overdueQuerySchema>;
