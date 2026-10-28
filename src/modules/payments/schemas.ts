import { z } from "zod";
import { calendarDateSchema } from "../../lib/calendarDateSchema";
import { paiseSchema } from "../../lib/money";

export const createPaymentSchema = z.object({
  studentId: z.string().uuid(),
  amountPaise: paiseSchema,
  paidOn: calendarDateSchema,
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"]),
  reference: z.string().trim().max(200).optional(),
  allocations: z
    .array(
      z.object({
        chargeId: z.string().uuid(),
        amountPaise: paiseSchema,
      }),
    )
    .max(500)
    .refine(
      (allocations) =>
        new Set(allocations.map(({ chargeId }) => chargeId)).size ===
        allocations.length,
      "A charge may appear only once",
    )
    .optional(),
});

export const paymentListQuerySchema = z
  .object({
    studentId: z.string().uuid().optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
    method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "OTHER"]).optional(),
    includeVoided: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || from <= to,
    "from must not be after to",
  );

export const paymentParamsSchema = z.object({
  id: z.string().uuid(),
});

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const idempotencyHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional();

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
