import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import {
  login,
  selectCenter,
  signupCenter,
} from "./service";
import {
  loginSchema,
  selectCenterSchema,
  signupCenterSchema,
} from "./schemas";

export const authRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request body is invalid");

authRoutes.post("/signup-center", (async (req, res) => {
  const parsed = signupCenterSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  const result = await signupCenter(parsed.data);
  res.status(201).json(result);
}) satisfies RequestHandler);

authRoutes.post("/login", (async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(await login(parsed.data));
}) satisfies RequestHandler);

authRoutes.post("/select-center", (async (req, res) => {
  const parsed = selectCenterSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }
  res.status(200).json(await selectCenter(parsed.data));
}) satisfies RequestHandler);
