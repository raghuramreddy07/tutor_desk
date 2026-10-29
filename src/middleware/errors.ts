import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../lib/logger";
import { getRequestContext } from "../lib/requestContext";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
};

export const globalErrorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  _next,
) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  const parserError = error as { status?: unknown; type?: unknown };
  if (parserError.status === 413 || parserError.type === "entity.too.large") {
    res.status(413).json({
      error: {
        code: "REQUEST_TOO_LARGE",
        message: "Request body must not exceed 1 MB",
      },
    });
    return;
  }
  if (
    parserError.status === 400 ||
    parserError.type === "entity.parse.failed"
  ) {
    res.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "Request body is invalid",
      },
    });
    return;
  }

  const context = getRequestContext();
  logger.error(
    {
      err: error,
      requestId: context?.requestId,
      centerId: context?.centerId,
      userId: context?.userId,
      role: context?.role,
    },
    "Unhandled application error",
  );
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};
