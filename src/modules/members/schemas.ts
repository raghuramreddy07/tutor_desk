import { z } from "zod";

export const memberUserIdSchema = z.object({
  userId: z.string().uuid(),
});

export const updateMemberSchema = z.object({
  role: z.enum(["OWNER", "TEACHER"]),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
