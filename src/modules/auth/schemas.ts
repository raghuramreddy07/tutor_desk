import { z } from "zod";

export const signupCenterSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(8),
  centerName: z.string().trim().min(1),
  phone: z.string().trim().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});

export const selectCenterSchema = z.object({
  selectionToken: z.string().min(1),
  centerId: z.string().uuid(),
});

export const acceptInviteSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  name: z.string().trim().min(1).optional(),
  password: z.string().min(8),
});

export type SignupCenterInput = z.infer<typeof signupCenterSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SelectCenterInput = z.infer<typeof selectCenterSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
