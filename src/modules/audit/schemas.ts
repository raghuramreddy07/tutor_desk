import { z } from "zod";

const optionalDate = z
  .string()
  .date()
  .optional();

export const auditListQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  actorUserId: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).refine(
  ({ from, to }) => !from || !to || from <= to,
  { message: "from must not be after to" },
);

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
