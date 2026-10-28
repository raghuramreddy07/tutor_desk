import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  createBatch,
  deleteBatch,
  enrollStudents,
  getBatch,
  listBatchStudents,
  listBatchTeachers,
  listBatches,
  setBatchTeachers,
  unenrollStudent,
  updateBatch,
} from "./service";
import {
  batchIdSchema,
  batchListQuerySchema,
  batchStudentIdSchema,
  createBatchSchema,
  enrollStudentsSchema,
  setBatchTeachersSchema,
  updateBatchSchema,
} from "./schemas";

export const batchRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

const actor = (req: Parameters<RequestHandler>[0]) => ({
  centerId: req.auth.centerId,
  userId: req.auth.userId,
  role: req.auth.role,
});

batchRoutes.use(authMiddleware, tenantMiddleware);
batchRoutes.use(requireRole("OWNER", "TEACHER"));

batchRoutes.post("/", requireRole("OWNER"), (async (req, res) => {
  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(201).json({
    batch: await createBatch(req.auth.centerId, parsed.data),
  });
}) satisfies RequestHandler);

batchRoutes.get("/", (async (req, res) => {
  const parsed = batchListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(await listBatches(actor(req), parsed.data));
}) satisfies RequestHandler);

batchRoutes.get("/:id", (async (req, res) => {
  const parsed = batchIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json({ batch: await getBatch(actor(req), parsed.data.id) });
}) satisfies RequestHandler);

batchRoutes.patch("/:id", requireRole("OWNER", "TEACHER"), (async (req, res) => {
  const params = batchIdSchema.safeParse(req.params);
  const body = updateBatchSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  res.status(200).json({
    batch: await updateBatch(actor(req), params.data.id, body.data),
  });
}) satisfies RequestHandler);

batchRoutes.delete("/:id", requireRole("OWNER"), (async (req, res) => {
  const parsed = batchIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  await deleteBatch(req.auth.centerId, parsed.data.id);
  res.status(204).end();
}) satisfies RequestHandler);

batchRoutes.put("/:id/teachers", requireRole("OWNER"), (async (req, res) => {
  const params = batchIdSchema.safeParse(req.params);
  const body = setBatchTeachersSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const teachers = await setBatchTeachers(
    req.auth.centerId,
    params.data.id,
    body.data,
  );
  res.status(200).json({ teachers });
}) satisfies RequestHandler);

batchRoutes.get("/:id/teachers", (async (req, res) => {
  const parsed = batchIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  const teachers = await listBatchTeachers(actor(req), parsed.data.id);
  res.status(200).json({ teachers });
}) satisfies RequestHandler);

batchRoutes.post("/:id/students", requireRole("OWNER", "TEACHER"), (async (req, res) => {
  const params = batchIdSchema.safeParse(req.params);
  const body = enrollStudentsSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const enrollments = await enrollStudents(actor(req), params.data.id, body.data);
  res.status(200).json({ enrollments });
}) satisfies RequestHandler);

batchRoutes.get("/:id/students", requireRole("OWNER", "TEACHER"), (async (req, res) => {
  const parsed = batchIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  const enrollments = await listBatchStudents(actor(req), parsed.data.id);
  res.status(200).json({ enrollments });
}) satisfies RequestHandler);

batchRoutes.delete("/:id/students/:studentId", requireRole("OWNER", "TEACHER"), (async (req, res) => {
  const parsed = batchStudentIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }
  await unenrollStudent(actor(req), parsed.data.id, parsed.data.studentId);
  res.status(204).end();
}) satisfies RequestHandler);
