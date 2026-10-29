import type { Prisma } from "@prisma/client";
import { AppError } from "../../middleware/errors";
import { withTenant } from "../../lib/tenantDb";
import type { UpdateMemberInput } from "./schemas";
import { recordAudit } from "../../lib/audit";

const memberNotFound = (): AppError =>
  new AppError(404, "NOT_FOUND", "Member not found");

const lastOwner = (): AppError =>
  new AppError(409, "LAST_OWNER", "The last owner cannot be removed or demoted");

const lockOwners = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
) => {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "Membership"
    WHERE "centerId" = ${centerId}::uuid
      AND "role" = 'OWNER'::"Role"
    ORDER BY "id"
    FOR UPDATE
  `;
};

export const listMembers = (centerId: string) =>
  withTenant(centerId, async (transaction) => {
    const memberships = await transaction.membership.findMany({
      where: { centerId },
      orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
      select: {
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
    });

    return memberships.map(({ userId, role, user }) => ({
      userId,
      name: user.name,
      email: user.email,
      role,
    }));
  });

export const updateMember = (
  centerId: string,
  userId: string,
  input: UpdateMemberInput,
) =>
  withTenant(centerId, async (transaction) => {
    await lockOwners(transaction, centerId);

    const membership = await transaction.membership.findUnique({
      where: { userId_centerId: { userId, centerId } },
    });
    if (!membership) {
      throw memberNotFound();
    }

    if (membership.role === "PARENT") {
      throw new AppError(
        409,
        "ROLE_CHANGE_NOT_ALLOWED",
        "Parent roles cannot be changed through this endpoint",
      );
    }

    if (membership.role === "OWNER" && input.role === "TEACHER") {
      const ownerCount = await transaction.membership.count({
        where: { centerId, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        throw lastOwner();
      }
    }

    await transaction.membership.update({
      where: { userId_centerId: { userId, centerId } },
      data: { role: input.role },
    });
    await recordAudit(transaction, {
      centerId,
      action: "member.role_changed",
      entityType: "Membership",
      entityId: userId,
      metadata: {
        fromRole: membership.role,
        toRole: input.role,
      },
    });

    return transaction.membership.findUniqueOrThrow({
      where: { userId_centerId: { userId, centerId } },
      select: { userId: true, role: true },
    });
  });

export const removeMember = (centerId: string, userId: string) =>
  withTenant(centerId, async (transaction) => {
    await lockOwners(transaction, centerId);

    const membership = await transaction.membership.findUnique({
      where: { userId_centerId: { userId, centerId } },
    });
    if (!membership) {
      throw memberNotFound();
    }

    if (membership.role === "OWNER") {
      const ownerCount = await transaction.membership.count({
        where: { centerId, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        throw lastOwner();
      }
    }

    await transaction.parentStudent.deleteMany({
      where: { centerId, userId },
    });
    await transaction.membership.delete({
      where: { userId_centerId: { userId, centerId } },
    });
    await recordAudit(transaction, {
      centerId,
      action: "member.removed",
      entityType: "Membership",
      entityId: userId,
      metadata: { removedRole: membership.role },
    });
  });
