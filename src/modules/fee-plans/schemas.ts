import { z } from "zod";
import { paiseSchema } from "../../lib/money";

const feePlanFields = {
  name: z.string().trim().min(1).max(120),
  amountPaise: paiseSchema,
  frequency: z.enum(["MONTHLY", "ONE_TIME"]),
  dueDay: z.number().int().min(1).max(28).nullable().optional(),
};

export const createFeePlanSchema = z
  .object({
    ...feePlanFields,
    batchId: z.string().uuid(),
  })
  .refine(
    ({ frequency, dueDay }) =>
      (frequency === "MONTHLY" && dueDay !== undefined && dueDay !== null) ||
      (frequency === "ONE_TIME" && (dueDay === undefined || dueDay === null)),
    "Monthly plans require dueDay 1–28; one-time plans do not use dueDay",
  );

export const updateFeePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    amountPaise: paiseSchema.optional(),
    dueDay: z.number().int().min(1).max(28).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined));

export const feePlanParamsSchema = z.object({
  id: z.string().uuid(),
});

export const feePlanListQuerySchema = z.object({
  batchId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateFeePlanInput = z.infer<typeof createFeePlanSchema>;
export type UpdateFeePlanInput = z.infer<typeof updateFeePlanSchema>;
