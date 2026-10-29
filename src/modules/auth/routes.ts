import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import {
  acceptInvite,
  login,
  selectCenter,
  signupCenter,
} from "./service";
import {
  acceptInviteSchema,
  loginSchema,
  selectCenterSchema,
  signupCenterSchema,
} from "./schemas";
import { authenticationRateLimit } from "../../middleware/rateLimit";

export const authRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request body is invalid");

authRoutes.post(
  "/signup-center",
  authenticationRateLimit("signup"),
  (async (req, res) => {
    const parsed = signupCenterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError();
    }
    const result = await signupCenter(parsed.data);
    res.status(201).json(result);
  }) satisfies RequestHandler,
);

authRoutes.post(
  "/login",
  authenticationRateLimit("login"),
  (async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError();
    }
    res.status(200).json(await login(parsed.data));
  }) satisfies RequestHandler,
);

authRoutes.post(
  "/select-center",
  authenticationRateLimit("select-center"),
  (async (req, res) => {
    const parsed = selectCenterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError();
    }
    res.status(200).json(await selectCenter(parsed.data));
  }) satisfies RequestHandler,
);

authRoutes.post(
  "/accept-invite",
  authenticationRateLimit("accept-invite"),
  (async (req, res) => {
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError();
    }
    res.status(200).json(await acceptInvite(parsed.data));
  }) satisfies RequestHandler,
);
