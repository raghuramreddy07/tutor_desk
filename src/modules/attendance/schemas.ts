import { z } from "zod";
import { calendarDateSchema } from "../../lib/calendarDateSchema";

export const batchAttendanceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const studentAttendanceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const upsertAttendanceSchema = z.object({
  date: calendarDateSchema,
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(["PRESENT", "ABSENT", "LATE"]),
      }),
    )
    .max(500)
    .refine(
      (records) => new Set(records.map(({ studentId }) => studentId)).size === records.length,
      "Each student may appear only once",
    ),
});

export const attendanceDateQuerySchema = z.object({
  date: calendarDateSchema,
});

export const studentAttendanceQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  .refine(({ from, to }) => from <= to, "from must not be after to");

export type UpsertAttendanceInput = z.infer<typeof upsertAttendanceSchema>;
