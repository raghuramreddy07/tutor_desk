import type { RequestHandler } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { AppError } from "./errors";
import {
  authenticatedUserRateLimit,
  enforceRateLimitsOnce,
} from "./rateLimit";
import { updateRequestActor } from "../lib/requestContext";

export const authMiddleware: RequestHandler = async (req, res, next) => {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    return;
  }

  let payload: ReturnType<typeof verifyAccessToken>;
  try {
    payload = verifyAccessToken(match[1]);
  } catch {
    next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    return;
  }

  req.auth = {
    userId: payload.userId,
    centerId: payload.centerId,
    role: payload.role,
  };
  updateRequestActor(req);
  await enforceRateLimitsOnce(
    req,
    res,
    "authenticated-user",
    authenticatedUserRateLimit(req),
  );
  next();
};
