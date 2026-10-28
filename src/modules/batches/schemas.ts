import { z } from "zod";

const batchFields = {
  name: z.string().trim().min(1),
  subject: z.string().trim().optional(),
  schedule: z.string().trim().optional(),
};

export const createBatchSchema = z.object(batchFields);

export const updateBatchSchema = z
  .object({
    name: batchFields.name.optional(),
    subject: batchFields.subject,
    schedule: batchFields.schedule,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const batchIdSchema = z.object({ id: z.string().uuid() });

export const batchListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const setBatchTeachersSchema = z.object({
  userIds: z.array(z.string().uuid()).max(200).refine(
    (userIds) => new Set(userIds).size === userIds.length,
    "userIds must be unique",
  ),
});

export const enrollStudentsSchema = z.object({
  studentIds: z.array(z.string().uuid()).max(500),
});

export const batchStudentIdSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().uuid(),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type SetBatchTeachersInput = z.infer<typeof setBatchTeachersSchema>;
export type EnrollStudentsInput = z.infer<typeof enrollStudentsSchema>;
