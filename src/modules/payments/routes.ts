import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  createPayment,
  getPayment,
  listPayments,
  voidPayment,
} from "./service";
import {
  createPaymentSchema,
  idempotencyHeaderSchema,
  paymentListQuerySchema,
  paymentParamsSchema,
  voidPaymentSchema,
} from "./schemas";

export const paymentRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

paymentRoutes.use(authMiddleware, tenantMiddleware, requireRole("OWNER"));

paymentRoutes.post("/", (async (req, res) => {
  const body = createPaymentSchema.safeParse(req.body);
  const idempotency = idempotencyHeaderSchema.safeParse(
    req.get("Idempotency-Key"),
  );
  if (!body.success || !idempotency.success) {
    throw validationError();
  }
  const result = await createPayment(
    req.auth.centerId,
    req.auth.userId,
    body.data,
    idempotency.data,
  );
  res.status(result.replayed ? 200 : 201).json({ payment: result.payment });
}) satisfies RequestHandler);

paymentRoutes.get("/", (async (req, res) => {
  const parsed = paymentListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(await listPayments(req.auth.centerId, parsed.data));
}) satisfies RequestHandler);

paymentRoutes.get("/:id", (async (req, res) => {
  const parsed = paymentParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json({
    payment: await getPayment(req.auth.centerId, parsed.data.id),
  });
}) satisfies RequestHandler);

paymentRoutes.post("/:id/void", (async (req, res) => {
  const params = paymentParamsSchema.safeParse(req.params);
  const body = voidPaymentSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const payment = await voidPayment(
    req.auth.centerId,
    req.auth.userId,
    params.data.id,
    body.data.reason,
  );
  res.status(200).json({ payment });
}) satisfies RequestHandler);
