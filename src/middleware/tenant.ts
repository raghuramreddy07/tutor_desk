import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { AppError } from "./errors";

export const tenantMiddleware: RequestHandler = async (req, _res, next) => {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_centerId: {
        userId: req.auth.userId,
        centerId: req.auth.centerId,
      },
    },
    select: { role: true },
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
  next();
};
