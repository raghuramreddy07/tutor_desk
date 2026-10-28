import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  createExam,
  deleteExam,
  getExam,
  getExamResults,
  getStudentResults,
  listBatchExams,
  updateExam,
  upsertExamResults,
} from "./service";
import {
  batchExamParamsSchema,
  createExamSchema,
  examParamsSchema,
  studentResultsParamsSchema,
  updateExamSchema,
  upsertExamResultsSchema,
} from "./schemas";

export const examRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

const actor = (req: Parameters<RequestHandler>[0]) => ({
  centerId: req.auth.centerId,
  userId: req.auth.userId,
  role: req.auth.role,
});

const examMiddleware = [
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER", "TEACHER"),
];

examRoutes.post("/batches/:id/exams", ...examMiddleware, (async (req, res) => {
  const params = batchExamParamsSchema.safeParse(req.params);
  const body = createExamSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const exam = await createExam(actor(req), params.data.id, body.data);
  res.status(201).json({ exam });
}) satisfies RequestHandler);

examRoutes.get("/batches/:id/exams", ...examMiddleware, (async (req, res) => {
  const params = batchExamParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw validationError();
  }
  const exams = await listBatchExams(actor(req), params.data.id);
  res.status(200).json({ exams });
}) satisfies RequestHandler);

examRoutes.get("/exams/:id", ...examMiddleware, (async (req, res) => {
  const params = examParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw validationError();
  }
  res.status(200).json(await getExam(actor(req), params.data.id));
}) satisfies RequestHandler);

examRoutes.patch("/exams/:id", ...examMiddleware, (async (req, res) => {
  const params = examParamsSchema.safeParse(req.params);
  const body = updateExamSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const exam = await updateExam(actor(req), params.data.id, body.data);
  res.status(200).json({ exam });
}) satisfies RequestHandler);

examRoutes.delete("/exams/:id", ...examMiddleware, (async (req, res) => {
  const params = examParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw validationError();
  }
  await deleteExam(actor(req), params.data.id);
  res.status(204).end();
}) satisfies RequestHandler);

examRoutes.put("/exams/:id/results", ...examMiddleware, (async (req, res) => {
  const params = examParamsSchema.safeParse(req.params);
  const body = upsertExamResultsSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }
  const roster = await upsertExamResults(actor(req), params.data.id, body.data);
  res.status(200).json(roster);
}) satisfies RequestHandler);

examRoutes.get("/exams/:id/results", ...examMiddleware, (async (req, res) => {
  const params = examParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw validationError();
  }
  const roster = await getExamResults(actor(req), params.data.id);
  res.status(200).json(roster);
}) satisfies RequestHandler);

examRoutes.get("/students/:id/results", ...examMiddleware, (async (req, res) => {
  const params = studentResultsParamsSchema.safeParse(req.params);
  if (!params.success) {
    throw validationError();
  }
  const results = await getStudentResults(actor(req), params.data.id);
  res.status(200).json({ results });
}) satisfies RequestHandler);
