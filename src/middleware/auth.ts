import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { AppError } from "./errors";

export const authMiddleware: RequestHandler = (req, _res, next) => {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    return;
  }

  try {
    const payload = verifyAccessToken(match[1]);
    req.auth = {
      userId: payload.userId,
      centerId: payload.centerId,
      role: payload.role,
    };
    next();
  } catch {
    next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
  }
};
