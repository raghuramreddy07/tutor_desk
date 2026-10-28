import { z } from "zod";

const studentFields = {
  name: z.string().trim().min(1),
  grade: z.string().trim().optional(),
  phone: z.string().trim().optional(),
};

export const createStudentSchema = z.object(studentFields);

export const updateStudentSchema = z
  .object({
    name: studentFields.name.optional(),
    grade: studentFields.grade,
    phone: studentFields.phone,
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const studentIdSchema = z.object({
  id: z.string().uuid(),
});

export const listStudentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
