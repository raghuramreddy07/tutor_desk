import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { tenantMiddleware } from "../../middleware/tenant";
import { requireRole } from "../../middleware/requireRole";
import {
  createStudent,
  deleteStudent,
  getStudent,
  listStudents,
  updateStudent,
} from "./service";
import {
  createStudentSchema,
  listStudentsQuerySchema,
  studentIdSchema,
  updateStudentSchema,
} from "./schemas";

export const studentRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

studentRoutes.use(
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER", "TEACHER"),
);

studentRoutes.post("/", (async (req, res) => {
  const parsed = createStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }

  const student = await createStudent(req.auth.centerId, parsed.data);
  res.status(201).json({ student });
}) satisfies RequestHandler);

studentRoutes.get("/", (async (req, res) => {
  const parsed = listStudentsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw validationError();
  }

  const result = await listStudents(req.auth.centerId, parsed.data);
  res.status(200).json(result);
}) satisfies RequestHandler);

studentRoutes.get("/:id", (async (req, res) => {
  const parsed = studentIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }

  const student = await getStudent(req.auth.centerId, parsed.data.id);
  res.status(200).json({ student });
}) satisfies RequestHandler);

studentRoutes.patch("/:id", (async (req, res) => {
  const params = studentIdSchema.safeParse(req.params);
  const body = updateStudentSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }

  const student = await updateStudent(
    req.auth.centerId,
    params.data.id,
    body.data,
  );
  res.status(200).json({ student });
}) satisfies RequestHandler);

studentRoutes.delete("/:id", (async (req, res) => {
  const parsed = studentIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }

  await deleteStudent(req.auth.centerId, parsed.data.id);
  res.status(204).end();
}) satisfies RequestHandler);
