import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  getParentChildOverview,
  getParentPaymentReceipt,
  getParentStudentDues,
  listParentAttendance,
  listParentChildren,
  listParentPayments,
  listParentResults,
} from "./service";
import {
  parentAttendanceQuerySchema,
  parentPaginationQuerySchema,
  parentPaymentParamsSchema,
  parentStudentParamsSchema,
} from "./schemas";

export const parentRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

parentRoutes.use(authMiddleware, tenantMiddleware, requireRole("PARENT"));

parentRoutes.get("/children", (async (req, res) => {
  res
    .status(200)
    .json(await listParentChildren(req.auth.centerId, req.auth.userId));
}) satisfies RequestHandler);

parentRoutes.get("/children/:studentId", (async (req, res) => {
  const parsed = parentStudentParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(
    await getParentChildOverview(
      req.auth.centerId,
      req.auth.userId,
      parsed.data.studentId,
    ),
  );
}) satisfies RequestHandler);

parentRoutes.get("/children/:studentId/attendance", (async (req, res) => {
  const params = parentStudentParamsSchema.safeParse(req.params);
  const query = parentAttendanceQuerySchema.safeParse(req.query);
  if (!params.success || !query.success) {
    throw validationError();
  }
  res.status(200).json(
    await listParentAttendance(
      req.auth.centerId,
      req.auth.userId,
      params.data.studentId,
      query.data,
    ),
  );
}) satisfies RequestHandler);

parentRoutes.get("/children/:studentId/results", (async (req, res) => {
  const parsed = parentStudentParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(
    await listParentResults(
      req.auth.centerId,
      req.auth.userId,
      parsed.data.studentId,
    ),
  );
}) satisfies RequestHandler);

parentRoutes.get("/children/:studentId/dues", (async (req, res) => {
  const parsed = parentStudentParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(
    await getParentStudentDues(
      req.auth.centerId,
      req.auth.userId,
      parsed.data.studentId,
    ),
  );
}) satisfies RequestHandler);

parentRoutes.get("/children/:studentId/payments", (async (req, res) => {
  const params = parentStudentParamsSchema.safeParse(req.params);
  const query = parentPaginationQuerySchema.safeParse(req.query);
  if (!params.success || !query.success) {
    throw validationError();
  }
  res.status(200).json(
    await listParentPayments(
      req.auth.centerId,
      req.auth.userId,
      params.data.studentId,
      query.data,
    ),
  );
}) satisfies RequestHandler);

parentRoutes.get(
  "/children/:studentId/payments/:paymentId",
  (async (req, res) => {
    const parsed = parentPaymentParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      throw validationError();
    }
    res.status(200).json(
      await getParentPaymentReceipt(
        req.auth.centerId,
        req.auth.userId,
        parsed.data.studentId,
        parsed.data.paymentId,
      ),
    );
  }) satisfies RequestHandler,
);
