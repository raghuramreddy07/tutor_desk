import { z } from "zod";

const email = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());

export const createInviteSchema = z.discriminatedUnion("role", [
  z.object({
    email,
    role: z.literal("OWNER"),
    studentId: z.string().uuid().optional(),
  }),
  z.object({
    email,
    role: z.literal("TEACHER"),
    studentId: z.never().optional(),
  }),
  z.object({
    email,
    role: z.literal("PARENT"),
    studentId: z.string().uuid(),
  }),
]);

export const inviteIdSchema = z.object({
  id: z.string().uuid(),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
