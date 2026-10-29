import { Router, type RequestHandler } from "express";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import { enqueueCenterJobs } from "../../jobs/enqueueCenterJobs";
import { createRateLimitMiddleware } from "../../middleware/rateLimit";

export const jobRoutes = Router();

const runNowRateLimit = createRateLimitMiddleware((req) => [
  {
    name: "expensive-run-now-user",
    identity: req.auth.userId,
    limit: 5,
    windowMs: 60_000,
  },
  {
    name: "expensive-run-now-center",
    identity: req.auth.centerId,
    limit: 5,
    windowMs: 60_000,
  },
]);

jobRoutes.post(
  "/run-now",
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER"),
  runNowRateLimit,
  (async (req, res) => {
    const jobs = await enqueueCenterJobs(req.auth.centerId);
    res.status(202).json({ jobs });
  }) satisfies RequestHandler,
);
