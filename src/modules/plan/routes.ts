import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import { getPlan, updatePlan } from "./service";
import { updatePlanSchema } from "./schemas";
import { env } from "../../config/env";

export const planRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

planRoutes.use(authMiddleware, tenantMiddleware, requireRole("OWNER"));

planRoutes.get("/", (async (req, res) => {
  res.status(200).json(await getPlan(req.auth.centerId));
}) satisfies RequestHandler);

planRoutes.patch("/", (async (req, res) => {
  if (!env.ALLOW_SELF_SERVICE_PLAN_CHANGE) {
    throw new AppError(404, "NOT_FOUND", "Route not found");
  }
  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  res
    .status(200)
    .json(await updatePlan(req.auth.centerId, parsed.data.plan));
}) satisfies RequestHandler);
