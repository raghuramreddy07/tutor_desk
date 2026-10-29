import { Router, type RequestHandler } from "express";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import { AppError } from "../../middleware/errors";
import { listAuditLogs } from "./service";
import { auditListQuerySchema } from "./schemas";

export const auditRoutes = Router();

auditRoutes.use(authMiddleware, tenantMiddleware, requireRole("OWNER"));

auditRoutes.get("/", (async (req, res) => {
  const parsed = auditListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Query parameters are invalid");
  }
  res.status(200).json(await listAuditLogs(req.auth.centerId, parsed.data));
}) satisfies RequestHandler);
