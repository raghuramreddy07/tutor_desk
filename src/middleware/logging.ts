import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { logger } from "../lib/logger";
import { getRequestContext } from "../lib/requestContext";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (_req, res) => {
    const requestId = res.getHeader("X-Request-Id");
    return typeof requestId === "string" ? requestId : randomUUID();
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url?.split("?")[0],
      remoteAddress: req.remoteAddress,
    }),
    err: (error) => ({
      type: error.type ?? error.name,
    }),
  },
  customProps: (req) => {
    const context = getRequestContext();
    return {
      requestId: req.id,
      ...(context
        ? {
            centerId: context.centerId,
            userId: context.userId,
            role: context.role,
          }
        : {}),
    };
  },
  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) {
      return "error";
    }
    if (res.statusCode >= 400) {
      return "warn";
    }
    return "info";
  },
});
