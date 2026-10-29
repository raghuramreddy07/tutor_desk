import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@prisma/client";
import type { Request, RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export type RequestContext = {
  requestId: string;
  ip?: string;
  userId?: string;
  centerId?: string;
  role?: Role;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

const isSafeRequestId = (value: string): boolean =>
  value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get("X-Request-Id");
  const context: RequestContext = {
    requestId:
      incoming && isSafeRequestId(incoming) ? incoming : randomUUID(),
    ip: req.ip,
  };
  res.setHeader("X-Request-Id", context.requestId);
  requestContext.run(context, next);
};

export const updateRequestActor = (req: Request): void => {
  const context = requestContext.getStore();
  if (!context || !req.auth) {
    return;
  }
  context.userId = req.auth.userId;
  context.centerId = req.auth.centerId;
  context.role = req.auth.role;
};

export const getRequestContext = (): RequestContext | undefined =>
  requestContext.getStore();
