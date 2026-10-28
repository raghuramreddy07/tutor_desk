import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { AppError } from "./errors";

export const requireRole = (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!roles.includes(req.auth.role)) {
      next(new AppError(403, "FORBIDDEN", "You do not have permission to perform this action"));
      return;
    }

    next();
  };
