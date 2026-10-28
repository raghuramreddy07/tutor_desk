import { createHash, randomBytes } from "node:crypto";
import { InviteRole, Prisma, type Role } from "@prisma/client";
import { env } from "../../config/env";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import type { CreateInviteInput } from "./schemas";

const forbidden = (): AppError =>
  new AppError(403, "FORBIDDEN", "You do not have permission to invite this role");

const alreadyMember = (): AppError =>
  new AppError(409, "ALREADY_MEMBER", "This email already belongs to the center");

const pendingInvite = (): AppError =>
  new AppError(409, "INVITE_PENDING", "A pending invite already exists for this email and role");

const studentNotFound = (): AppError =>
  new AppError(404, "NOT_FOUND", "Student not found");

const inviteUrl = (token: string): string =>
  `${env.APP_URL.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;

export const createInvite = async (
  centerId: string,
  invitedByUserId: string,
  inviterRole: Role,
  input: CreateInviteInput,
) => {
  if (
    input.role === "OWNER" ||
    (inviterRole === "OWNER" && input.role !== "TEACHER") ||
    (inviterRole === "TEACHER" && input.role !== "PARENT") ||
    inviterRole === "PARENT"
  ) {
    throw forbidden();
  }
  if (input.role !== "TEACHER" && input.role !== "PARENT") {
    throw forbidden();
  }

  try {
    return await withTenant(centerId, async (transaction) => {
      if (input.role === InviteRole.PARENT) {
        const student = await transaction.student.findFirst({
          where: { id: input.studentId, centerId },
          select: { id: true },
        });
        if (!student) {
          throw studentNotFound();
        }
        if (inviterRole === "TEACHER") {
          const assignedBatchEnrollment = await transaction.batchStudent.findFirst({
            where: {
              centerId,
              studentId: student.id,
              batch: {
                is: {
                  centerId,
                  teachers: {
                    some: { centerId, userId: invitedByUserId },
                  },
                },
              },
            },
            select: { id: true },
          });
          if (!assignedBatchEnrollment) {
            throw studentNotFound();
          }
        }
      }

      const existingUser = await transaction.user.findUnique({
        where: { email: input.email },
        select: {
          id: true,
          memberships: {
            where: { centerId },
            select: { role: true },
          },
        },
      });
      const existingMembership = existingUser?.memberships[0];
      if (existingMembership) {
        if (
          input.role !== InviteRole.PARENT ||
          existingMembership.role !== "PARENT"
        ) {
          throw alreadyMember();
        }

        const parentStudent = await transaction.parentStudent.upsert({
          where: {
            userId_studentId: {
              userId: existingUser.id,
              studentId: input.studentId,
            },
          },
          create: {
            centerId,
            userId: existingUser.id,
            studentId: input.studentId,
          },
          update: {},
        });
        return { alreadyMember: true, parentStudent };
      }

      const now = new Date();
      const duplicate = await transaction.invite.findFirst({
        where: {
          centerId,
          email: input.email,
          role: input.role,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw pendingInvite();
      }

      await transaction.invite.updateMany({
        where: {
          centerId,
          email: input.email,
          role: input.role,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { lte: now },
        },
        data: { revokedAt: now },
      });

      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const invite = await transaction.invite.create({
        data: {
          centerId,
          invitedByUserId,
          email: input.email,
          role: input.role,
          studentId: input.role === InviteRole.PARENT ? input.studentId : null,
          tokenHash,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
        select: {
          id: true,
          centerId: true,
          email: true,
          role: true,
          studentId: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });

      return {
        alreadyMember: false,
        invite,
        inviteLink: inviteUrl(token),
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw pendingInvite();
    }
    throw error;
  }
};

export const listInvites = (
  centerId: string,
  requesterId: string,
  requesterRole: Role,
) =>
  withTenant(centerId, (transaction) =>
    transaction.invite.findMany({
      where: {
        centerId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(requesterRole === "TEACHER"
          ? { invitedByUserId: requesterId }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        centerId: true,
        invitedByUserId: true,
        email: true,
        role: true,
        studentId: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
  );

export const revokeInvite = (
  centerId: string,
  requesterId: string,
  requesterRole: Role,
  id: string,
) =>
  withTenant(centerId, async (transaction) => {
    const result = await transaction.invite.updateMany({
      where: {
        id,
        centerId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(requesterRole === "TEACHER"
          ? { invitedByUserId: requesterId }
          : {}),
      },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new AppError(404, "NOT_FOUND", "Invite not found");
    }
  });
