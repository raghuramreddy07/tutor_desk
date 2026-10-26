import type { ErrorRequestHandler, RequestHandler } from "express";

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
  _req,
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

  console.error("Unhandled application error:", error);
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    },
  });
};
