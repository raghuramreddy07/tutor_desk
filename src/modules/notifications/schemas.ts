import { z } from "zod";

export const notificationListQuerySchema = z.object({
  status: z.enum(["PENDING", "SENT", "FAILED", "SKIPPED"]).optional(),
  studentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type NotificationListQuery = z.infer<
  typeof notificationListQuerySchema
>;
