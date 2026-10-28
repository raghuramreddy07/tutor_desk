import { Router, type RequestHandler } from "express";
import { AppError } from "../../middleware/errors";
import { authMiddleware } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { tenantMiddleware } from "../../middleware/tenant";
import {
  createInvite,
  listInvites,
  revokeInvite,
} from "./service";
import { createInviteSchema, inviteIdSchema } from "./schemas";

export const inviteRoutes = Router();

const validationError = (): AppError =>
  new AppError(400, "VALIDATION_ERROR", "Request data is invalid");

inviteRoutes.use(
  authMiddleware,
  tenantMiddleware,
  requireRole("OWNER", "TEACHER"),
);

inviteRoutes.post("/", (async (req, res) => {
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw validationError();
  }

  const result = await createInvite(
    req.auth.centerId,
    req.auth.userId,
    req.auth.role,
    parsed.data,
  );
  res.status(result.alreadyMember ? 200 : 201).json(result);
}) satisfies RequestHandler);

inviteRoutes.get("/", (async (req, res) => {
  const invites = await listInvites(
    req.auth.centerId,
    req.auth.userId,
    req.auth.role,
  );
  res.status(200).json({ invites });
}) satisfies RequestHandler);

inviteRoutes.delete("/:id", (async (req, res) => {
  const parsed = inviteIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw validationError();
  }

  await revokeInvite(
    req.auth.centerId,
    req.auth.userId,
    req.auth.role,
    parsed.data.id,
  );
  res.status(204).end();
}) satisfies RequestHandler);
