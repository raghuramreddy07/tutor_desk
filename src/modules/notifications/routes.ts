import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import { listNotifications } from "./service";
import { notificationListQuerySchema } from "./schemas";

export const notificationRoutes = Router();

notificationRoutes.use(
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER"),
);

notificationRoutes.get("/", (async (req, res) => {
  const parsed = notificationListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Query data is invalid");
  }
  res
    .status(200)
    .json(await listNotifications(req.auth.centerId, parsed.data));
}) satisfies RequestHandler);
