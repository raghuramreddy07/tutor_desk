import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "./errors";
import { centerRateLimit, enforceRateLimitsOnce } from "./rateLimit";
import { PLAN_LIMITS } from "../config/plans";
import { updateRequestActor } from "../lib/requestContext";

export const tenantMiddleware: RequestHandler = async (req, res, next) => {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_centerId: {
        userId: req.auth.userId,
        centerId: req.auth.centerId,
      },
    },
    select: { role: true, center: { select: { plan: true } } },
  });

  if (!membership) {
    next(
      new AppError(
        401,
        "TENANT_ACCESS_REVOKED",
        "Membership for this center is no longer active",
      ),
    );
    return;
  }

  req.auth.role = membership.role;
  updateRequestActor(req);
  await enforceRateLimitsOnce(
    req,
    res,
    "center",
    centerRateLimit(
      req,
      membership.center.plan,
      PLAN_LIMITS[membership.center.plan].requestsPerMinute,
    ),
  );
  next();
};
