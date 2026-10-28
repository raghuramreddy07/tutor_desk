import { z } from "zod";
import { calendarDateSchema } from "../../lib/calendarDateSchema";

const positiveMaxMarksSchema = z.number().int().min(1).max(2_147_483_647);

export const batchExamParamsSchema = z.object({
  id: z.string().uuid(),
});

export const examParamsSchema = z.object({
  id: z.string().uuid(),
});

export const studentResultsParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createExamSchema = z.object({
  name: z.string().trim().min(1),
  maxMarks: positiveMaxMarksSchema,
  date: calendarDateSchema,
});

export const updateExamSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    maxMarks: positiveMaxMarksSchema.optional(),
    date: calendarDateSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const upsertExamResultsSchema = z.object({
  results: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        marks: z.number().int().min(0).max(2_147_483_647),
      }),
    )
    .max(500)
    .refine(
      (results) => new Set(results.map(({ studentId }) => studentId)).size === results.length,
      "Each student may appear only once",
    ),
});

export type CreateExamInput = z.infer<typeof createExamSchema>;
export type UpdateExamInput = z.infer<typeof updateExamSchema>;
export type UpsertExamResultsInput = z.infer<typeof upsertExamResultsSchema>;
