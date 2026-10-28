import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  createFeePlan,
  deleteFeePlan,
  getFeePlan,
  listFeePlans,
  updateFeePlan,
} from "./service";
import {
  createFeePlanSchema,
  feePlanListQuerySchema,
  feePlanParamsSchema,
  updateFeePlanSchema,
} from "./schemas";

export const feePlanRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

feePlanRoutes.use(authMiddleware, tenantMiddleware, requireRole("OWNER"));

feePlanRoutes.post("/", (async (req, res) => {
  const parsed = createFeePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  const feePlan = await createFeePlan(req.auth.centerId, parsed.data);
  res.status(201).json({ feePlan });
}) satisfies RequestHandler);

feePlanRoutes.get("/", (async (req, res) => {
  const parsed = feePlanListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(await listFeePlans(req.auth.centerId, parsed.data));
}) satisfies RequestHandler);

feePlanRoutes.get("/:id", (async (req, res) => {
  const parsed = feePlanParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json({
    feePlan: await getFeePlan(req.auth.centerId, parsed.data.id),
  });
}) satisfies RequestHandler);

feePlanRoutes.patch("/:id", (async (req, res) => {
  const params = feePlanParamsSchema.safeParse(req.params);
  const body = updateFeePlanSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  res.status(200).json({
    feePlan: await updateFeePlan(
      req.auth.centerId,
      params.data.id,
      body.data,
    ),
  });
}) satisfies RequestHandler);

feePlanRoutes.delete("/:id", (async (req, res) => {
  const parsed = feePlanParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  await deleteFeePlan(req.auth.centerId, parsed.data.id);
  res.status(204).end();
}) satisfies RequestHandler);
