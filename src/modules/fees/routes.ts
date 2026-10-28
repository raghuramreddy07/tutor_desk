import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  createStudentFee,
  deleteStudentFee,
  generateFeeCharges,
  getFeeDuesSummary,
  getStudentDues,
  listOverdueStudents,
  listStudentFees,
  updateStudentFee,
  unwaiveFeeCharge,
  waiveFeeCharge,
} from "./service";
import {
  createStudentFeeSchema,
  feeDuesSummaryQuerySchema,
  feeChargeParamsSchema,
  generateChargesSchema,
  overdueQuerySchema,
  studentFeeAssignmentParamsSchema,
  studentFeeParamsSchema,
  studentDuesParamsSchema,
  updateStudentFeeSchema,
  waiveFeeChargeSchema,
} from "./schemas";

export const studentFeeRoutes = Router();
export const feeRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

const ownerMiddleware = [
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER"),
];

studentFeeRoutes.post(
  "/:id/fees",
  ...ownerMiddleware,
  (async (req, res) => {
    const params = studentFeeParamsSchema.safeParse(req.params);
    const body = createStudentFeeSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      throw validationError();
    }
    const studentFee = await createStudentFee(
      req.auth.centerId,
      params.data.id,
      body.data,
    );
    res.status(201).json({ studentFee });
  }) satisfies RequestHandler,
);

studentFeeRoutes.get("/:id/fees", ...ownerMiddleware, (async (req, res) => {
  const parsed = studentFeeParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  const studentFees = await listStudentFees(req.auth.centerId, parsed.data.id);
  res.status(200).json({ studentFees });
}) satisfies RequestHandler);

studentFeeRoutes.get("/:id/dues", ...ownerMiddleware, (async (req, res) => {
  const parsed = studentDuesParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res
    .status(200)
    .json(await getStudentDues(req.auth.centerId, parsed.data.id));
}) satisfies RequestHandler);

studentFeeRoutes.patch(
  "/:id/fees/:studentFeeId",
  ...ownerMiddleware,
  (async (req, res) => {
    const params = studentFeeAssignmentParamsSchema.safeParse(req.params);
    const body = updateStudentFeeSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      throw validationError();
    }
    const studentFee = await updateStudentFee(
      req.auth.centerId,
      params.data.id,
      params.data.studentFeeId,
      body.data,
    );
    res.status(200).json({ studentFee });
  }) satisfies RequestHandler,
);

studentFeeRoutes.delete(
  "/:id/fees/:studentFeeId",
  ...ownerMiddleware,
  (async (req, res) => {
    const params = studentFeeAssignmentParamsSchema.safeParse(req.params);
    if (!params.success) {
      throw validationError();
    }
    const result = await deleteStudentFee(
      req.auth.centerId,
      params.data.id,
      params.data.studentFeeId,
    );
    res.status(200).json(result);
  }) satisfies RequestHandler,
);

feeRoutes.use(...ownerMiddleware);

feeRoutes.get("/dues/summary", (async (req, res) => {
  const parsed = feeDuesSummaryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw validationError();
  }
  res
    .status(200)
    .json(await getFeeDuesSummary(req.auth.centerId, parsed.data));
}) satisfies RequestHandler);

feeRoutes.get("/overdue", (async (req, res) => {
  const parsed = overdueQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw validationError();
  }
  res
    .status(200)
    .json(await listOverdueStudents(req.auth.centerId, parsed.data));
}) satisfies RequestHandler);

feeRoutes.post("/charges/generate", (async (req, res) => {
  const parsed = generateChargesSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(await generateFeeCharges(req.auth.centerId, parsed.data.month));
}) satisfies RequestHandler);

feeRoutes.patch("/charges/:id/waive", (async (req, res) => {
  const params = feeChargeParamsSchema.safeParse(req.params);
  const body = waiveFeeChargeSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const charge = await waiveFeeCharge(
    req.auth.centerId,
    req.auth.userId,
    params.data.id,
    body.data.reason,
  );
  res.status(200).json({ charge });
}) satisfies RequestHandler);

feeRoutes.post("/charges/:id/unwaive", (async (req, res) => {
  const params = feeChargeParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw validationError();
  }
  const charge = await unwaiveFeeCharge(req.auth.centerId, params.data.id);
  res.status(200).json({ charge });
}) satisfies RequestHandler);
