import { z } from "zod";
import { calendarDateSchema } from "../../lib/calendarDateSchema";

export const parentStudentParamsSchema = z.object({
  studentId: z.string().uuid(),
});

export const parentPaymentParamsSchema = z.object({
  studentId: z.string().uuid(),
  paymentId: z.string().uuid(),
});

export const parentAttendanceQuerySchema = z
  .object({
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || from <= to,
    "from must not be after to",
  );

export const parentPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ParentAttendanceQuery = z.infer<
  typeof parentAttendanceQuerySchema
>;
export type ParentPaginationQuery = z.infer<
  typeof parentPaginationQuerySchema
>;
