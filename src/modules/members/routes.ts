import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import { listMembers, removeMember, updateMember } from "./service";
import {
  memberUserIdSchema,
  updateMemberSchema,
} from "./schemas";

export const memberRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

memberRoutes.use(authMiddleware, tenantMiddleware, requireRole("OWNER"));

memberRoutes.get("/", (async (req, res) => {
  const members = await listMembers(req.auth.centerId);
  res.status(200).json({ members });
}) satisfies RequestHandler);

memberRoutes.patch("/:userId", (async (req, res) => {
  const params = memberUserIdSchema.safeParse(req.params);
  const body = updateMemberSchema.safeParse(req.body);
  if (!params.success || !body.success) {
    throw validationError();
  }

  const member = await updateMember(
    req.auth.centerId,
    params.data.userId,
    body.data,
  );
  res.status(200).json({ member });
}) satisfies RequestHandler);

memberRoutes.delete("/:userId", (async (req, res) => {
  const parsed = memberUserIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }

  await removeMember(req.auth.centerId, parsed.data.userId);
  res.status(204).end();
}) satisfies RequestHandler);
