import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { withInviteToken } from "../../lib/tenantDb";
import { assertWithinPlanLimit } from "../../lib/planLimits";
import { recordAudit } from "../../lib/audit";
import {
  createAccessToken,
  createSelectionToken,
  verifySelectionToken,
} from "../../lib/jwt";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../../lib/password";
import { AppError } from "../../middleware/errors";
import type {
  AcceptInviteInput,
  LoginInput,
  SelectCenterInput,
  SignupCenterInput,
} from "./schemas";

const invalidCredentials = (): AppError =>
  new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

const invalidInvite = (): AppError =>
  new AppError(400, "INVALID_INVITE", "Invite is invalid or expired");

export const signupCenter = async (input: SignupCenterInput) => {
  const passwordHash = await hashPassword(input.password);

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          passwordHash,
        },
        select: { id: true, name: true, email: true, phone: true },
      });
      const center = await transaction.center.create({
        data: { name: input.centerName },
        select: { id: true, name: true, plan: true },
      });
      await transaction.membership.create({
        data: {
          userId: user.id,
          centerId: center.id,
          role: "OWNER",
        },
      });
      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${center.id}, true)
      `;
      await recordAudit(transaction, {
        centerId: center.id,
        actorUserId: user.id,
        actorRole: "OWNER",
        action: "signup-center",
        entityType: "Center",
        entityId: center.id,
        metadata: { created: ["center", "owner_membership"] },
      });

      return { user, center };
    });

    return {
      ...result,
      accessToken: createAccessToken({
        userId: result.user.id,
        centerId: result.center.id,
        role: "OWNER",
      }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
    }
    throw error;
  }
};

export const login = async (input: LoginInput) => {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      passwordHash: true,
      memberships: {
        select: {
          role: true,
          center: { select: { id: true, name: true } },
        },
      },
    },
  });
  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (user.memberships.length === 0) {
    throw new AppError(403, "NO_CENTER", "This account is not a member of any center");
  }

  if (user.memberships.length === 1) {
    const [membership] = user.memberships;
    return {
      accessToken: createAccessToken({
        userId: user.id,
        centerId: membership.center.id,
        role: membership.role,
      }),
      center: membership.center,
      role: membership.role,
    };
  }

  return {
    centers: user.memberships.map(({ center, role }) => ({
      ...center,
      role,
    })),
    selectionToken: createSelectionToken(user.id),
  };
};

export const selectCenter = async (input: SelectCenterInput) => {
  let selection: ReturnType<typeof verifySelectionToken>;
  try {
    selection = verifySelectionToken(input.selectionToken);
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Invalid selection token");
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_centerId: {
        userId: selection.userId,
        centerId: input.centerId,
      },
    },
    select: {
      center: { select: { id: true, name: true } },
      role: true,
    },
  });

  if (!membership) {
    throw new AppError(403, "NOT_A_MEMBER", "You are not a member of this center");
  }

  return {
    accessToken: createAccessToken({
      userId: selection.userId,
      centerId: input.centerId,
      role: membership.role,
    }),
  };
};

export const acceptInvite = async (input: AcceptInviteInput) => {
  const tokenHash = createHash("sha256").update(input.token).digest("hex");

  try {
    const accepted = await withInviteToken(tokenHash, async (transaction) => {
      const invite = await transaction.invite.findUnique({
        where: { tokenHash },
      });

      if (!invite) {
        throw invalidInvite();
      }

      await transaction.$queryRaw`
        SELECT set_config('app.current_center', ${invite.centerId}, true)
      `;

      const lockedInvites = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Invite"
        WHERE "id" = ${invite.id}::uuid
          AND "centerId" = ${invite.centerId}::uuid
        FOR UPDATE
      `;
      if (lockedInvites.length === 0) {
        throw invalidInvite();
      }

      const currentInvite = await transaction.invite.findFirst({
        where: { id: invite.id, centerId: invite.centerId },
      });
      const now = new Date();
      if (
        !currentInvite ||
        currentInvite.acceptedAt ||
        currentInvite.revokedAt ||
        currentInvite.expiresAt <= now
      ) {
        throw invalidInvite();
      }

      if (currentInvite.role === "TEACHER") {
        await assertWithinPlanLimit(
          transaction,
          currentInvite.centerId,
          "teachers",
          { excludedInviteId: currentInvite.id },
        );
      }

      const existingUser = await transaction.user.findUnique({
        where: { email: currentInvite.email },
      });
      let userId: string;
      if (existingUser) {
        if (!(await verifyPassword(input.password, existingUser.passwordHash))) {
          throw invalidCredentials();
        }
        userId = existingUser.id;
      } else {
        if (!input.name) {
          await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
          throw invalidCredentials();
        }
        const passwordHash = await hashPassword(input.password);
        const user = await transaction.user.create({
          data: {
            name: input.name,
            email: currentInvite.email,
            passwordHash,
          },
          select: { id: true },
        });
        userId = user.id;
      }

      const claimed = await transaction.invite.updateMany({
        where: {
          id: currentInvite.id,
          centerId: currentInvite.centerId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1) {
        throw invalidInvite();
      }

      await transaction.membership.create({
        data: {
          userId,
          centerId: currentInvite.centerId,
          role: currentInvite.role,
        },
      });

      if (currentInvite.role === "PARENT") {
        if (!currentInvite.studentId) {
          throw invalidInvite();
        }
        await transaction.parentStudent.create({
          data: {
            centerId: currentInvite.centerId,
            userId,
            studentId: currentInvite.studentId,
          },
        });
      }

      const center = await transaction.center.findUniqueOrThrow({
        where: { id: currentInvite.centerId },
        select: { id: true, name: true },
      });
      await recordAudit(transaction, {
        centerId: currentInvite.centerId,
        actorUserId: userId,
        actorRole: currentInvite.role,
        action: "invite.accepted",
        entityType: "Invite",
        entityId: currentInvite.id,
        metadata: { role: currentInvite.role },
      });

      return {
        userId,
        center,
        role: currentInvite.role,
      };
    });

    return {
      center: accepted.center,
      role: accepted.role,
      accessToken: createAccessToken({
        userId: accepted.userId,
        centerId: accepted.center.id,
        role: accepted.role,
      }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(409, "ALREADY_MEMBER", "This user is already a member of the center");
    }
    throw error;
  }
};
