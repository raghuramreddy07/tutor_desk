import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  getBatchAttendance,
  getStudentAttendance,
  markAttendance,
} from "./service";
import {
  attendanceDateQuerySchema,
  batchAttendanceParamsSchema,
  studentAttendanceParamsSchema,
  studentAttendanceQuerySchema,
  upsertAttendanceSchema,
} from "./schemas";

export const attendanceRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

const actor = (req: Parameters<RequestHandler>[0]) => ({
  centerId: req.auth.centerId,
  userId: req.auth.userId,
  role: req.auth.role,
});

const attendanceMiddleware = [
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER", "TEACHER"),
];

attendanceRoutes.put("/batches/:id/attendance", ...attendanceMiddleware, (async (req, res) => {
  const params = batchAttendanceParamsSchema.safeParse(req.params);
  const body = upsertAttendanceSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const attendance = await markAttendance(actor(req), params.data.id, body.data);
  res.status(200).json({ attendance });
}) satisfies RequestHandler);

attendanceRoutes.get("/batches/:id/attendance", ...attendanceMiddleware, (async (req, res) => {
  const params = batchAttendanceParamsSchema.safeParse(req.params);
  const query = attendanceDateQuerySchema.safeParse(req.query);
  if (!params.success || !query.success) {
    throw validationError();
  }
  const roster = await getBatchAttendance(actor(req), params.data.id, query.data.date);
  res.status(200).json({ roster });
}) satisfies RequestHandler);

attendanceRoutes.get("/students/:id/attendance", ...attendanceMiddleware, (async (req, res) => {
  const params = studentAttendanceParamsSchema.safeParse(req.params);
  const query = studentAttendanceQuerySchema.safeParse(req.query);
  if (!params.success || !query.success) {
    throw validationError();
  }
  const attendance = await getStudentAttendance(
    actor(req),
    params.data.id,
    query.data,
  );
  res.status(200).json({ attendance });
}) satisfies RequestHandler);
